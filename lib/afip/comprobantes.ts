/**
 * Folio · helpers de alto nivel para emitir comprobantes AFIP.
 *
 * Acá vive la lógica que arma el `ComprobanteRequest` a partir de un Pago +
 * Organization + Paciente, dispara `solicitarCAE`, guarda el resultado en
 * `pago.factura_afip_numero` y opcionalmente sube el PDF a Storage.
 */

import { decryptColumn } from "@/lib/crypto";
import { err, ok, type Result } from "@/lib/db/errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

import { configFromOrg, solicitarCAE, type ComprobanteRequest, type ComprobanteResponse } from "./wsfev1";

export interface EmitirInput {
  pagoId: string;
}

/**
 * Emite una factura para un pago PAGADO. Idempotente: si el pago ya tiene
 * `factura_afip_numero`, retorna ok con el dato existente.
 *
 * Asume MONOTRIBUTO → Factura C (no discrimina IVA).
 * RESPONSABLE_INSCRIPTO → Factura A (con IVA 21%). EXENTO → Factura C.
 */
export async function emitirFacturaParaPago(input: EmitirInput): Promise<Result<ComprobanteResponse>> {
  const service = createSupabaseServiceClient();

  const { data: pago } = await service
    .from("pago")
    .select("id, organization_id, turno_id, monto_cents, estado, pagado_ts, factura_afip_numero")
    .eq("id", input.pagoId)
    .maybeSingle();
  if (!pago) return err("not_found", "Pago no encontrado.");
  if (pago.estado !== "PAGADO") return err("validation", "Solo se factura pagos en estado PAGADO.");
  if (pago.factura_afip_numero) {
    return err("conflict", `Ya tiene factura emitida: ${pago.factura_afip_numero}.`);
  }

  const { data: org } = await service
    .from("organization")
    .select("id, cuit, punto_venta_afip, condicion_iva, certificado_arca_cifrado, razon_social")
    .eq("id", pago.organization_id)
    .maybeSingle();
  if (!org) return err("not_found", "Organization no encontrada.");
  if (!org.cuit) return err("validation", "Falta CUIT en organization.");
  if (!org.punto_venta_afip) return err("validation", "Falta punto_venta_afip.");

  const config = configFromOrg(org);
  if (!config) return err("validation", "Falta certificado AFIP o config incompleta.");

  // Levantar paciente para DocTipo/DocNro
  const { data: turno } = await service
    .from("turno")
    .select("paciente_id")
    .eq("id", pago.turno_id)
    .maybeSingle();
  if (!turno) return err("not_found", "Turno asociado al pago no encontrado.");

  const { data: ident } = await service
    .from("paciente_identidad")
    .select("dni_cifrado, cuit_cifrado")
    .eq("paciente_id", turno.paciente_id)
    .maybeSingle();

  let docTipo: 80 | 96 | 99 = 99;                 // 99 = Consumidor Final
  let docNumero = "0";
  if (ident) {
    const cuit = decryptColumn(ident.cuit_cifrado);
    const dni = decryptColumn(ident.dni_cifrado);
    if (cuit) {
      docTipo = 80;
      docNumero = cuit;
    } else if (dni) {
      docTipo = 96;
      docNumero = dni;
    }
  }

  const importeTotal = pago.monto_cents / 100;
  const isFacturaA = config.condicionIva === "RESPONSABLE_INSCRIPTO";

  let importeNeto: number;
  let importeIva: number;
  let tipoComprobante: 1 | 6 | 11;
  if (isFacturaA) {
    // Factura A: discrimina IVA 21% sobre el neto
    importeNeto = +(importeTotal / 1.21).toFixed(2);
    importeIva = +(importeTotal - importeNeto).toFixed(2);
    tipoComprobante = 1;
  } else {
    // Factura C (Monotributo/Exento): no discrimina IVA
    importeNeto = importeTotal;
    importeIva = 0;
    tipoComprobante = 11;
  }

  const req: ComprobanteRequest = {
    tipoComprobante,
    fechaEmision: pago.pagado_ts ? new Date(pago.pagado_ts) : new Date(),
    importeNeto,
    importeIva,
    importeTotal,
    conceptoTipo: 2,                              // 2 = Servicios
    docTipo,
    docNumero,
    monedaId: "PES",
    cotizacion: 1,
  };

  let result: ComprobanteResponse;
  try {
    result = await solicitarCAE(config, req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "Error llamando a AFIP.", msg);
  }

  if (result.resultado !== "A") {
    const obs = (result.observaciones ?? []).map((o) => `${o.code}: ${o.msg}`).join("; ");
    return err("db_error", `AFIP rechazó el comprobante: ${obs || "sin detalle"}.`);
  }

  // Guardar CAE en pago
  const numeroLegible = `${String(config.puntoVenta).padStart(5, "0")}-${String(result.numero).padStart(8, "0")} CAE ${result.cae}`;
  await service
    .from("pago")
    .update({ factura_afip_numero: numeroLegible })
    .eq("id", pago.id);

  return ok(result);
}
