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
  /**
   * Org activa de la sesión que pide facturar (getActiveSession() en el
   * caller). El SELECT del pago corre con service_role (BYPASSRLS), así que
   * SIN este scope un `pagoId` ajeno adivinado/filtrado emitiría una factura
   * real contra el CUIT de OTRA organización (IDOR cross-tenant — hallazgo
   * high de auditoría). Nunca derivar este valor de input del cliente.
   */
  organizationId: string;
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

  // OJO schema: `pago` NO tiene organization_id propio — su tenant es el del
  // turno (pago.turno_id → turno.organization_id; así están escritas sus
  // policies RLS en M09). No seleccionar/filtrar pago.organization_id acá:
  // PostgREST devuelve 42703 y el path muere en "no encontrado".
  const { data: pago, error: pagoError } = await service
    .from("pago")
    .select("id, turno_id, monto_cents, estado, pagado_ts, factura_afip_numero")
    .eq("id", input.pagoId)
    .maybeSingle();
  if (pagoError) return err("db_error", "Error consultando el pago.", pagoError.message);
  if (!pago) return err("not_found", "Pago no encontrado.");

  // Scope de organización obligatorio ANTES de cualquier check de estado: el
  // client es service_role (BYPASSRLS), este `.eq("organization_id", ...)`
  // sobre el turno reemplaza a la RLS acá. Un pagoId de otra org devuelve el
  // MISMO not_found que un id inexistente — no se filtra ni la existencia ni
  // el estado del pago de otro tenant.
  const { data: turno, error: turnoError } = await service
    .from("turno")
    .select("paciente_id, organization_id")
    .eq("id", pago.turno_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (turnoError) return err("db_error", "Error consultando el turno.", turnoError.message);
  if (!turno) return err("not_found", "Pago no encontrado.");

  if (pago.estado !== "PAGADO") return err("validation", "Solo se factura pagos en estado PAGADO.");
  if (pago.factura_afip_numero) {
    return err("conflict", `Ya tiene factura emitida: ${pago.factura_afip_numero}.`);
  }

  const { data: org } = await service
    .from("organization")
    .select("id, cuit, punto_venta_afip, condicion_iva, certificado_arca_cifrado, razon_social")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (!org) return err("not_found", "Organization no encontrada.");
  if (!org.cuit) return err("validation", "Falta CUIT en organization.");
  if (!org.punto_venta_afip) return err("validation", "Falta punto_venta_afip.");

  const config = configFromOrg(org);
  if (!config) return err("validation", "Falta certificado AFIP o config incompleta.");

  // Levantar identidad del paciente para DocTipo/DocNro.
  // OJO schema: paciente_identidad NO tiene paciente_id ni dni/cuit_cifrado —
  // se llega vía paciente.identidad_id, y el documento vive en tipo_doc
  // (enum DNI/LE/LC/CI/PASAPORTE, sin CUIT) + numero_doc_cifrado. Solo DNI
  // mapea a un DocTipo AFIP que manejamos (96); el resto factura como
  // Consumidor Final (99). Ambos fetches con scope de organización.
  const { data: paciente } = await service
    .from("paciente")
    .select("identidad_id")
    .eq("id", turno.paciente_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  let docTipo: 96 | 99 = 99;                      // 99 = Consumidor Final
  let docNumero = "0";
  if (paciente?.identidad_id) {
    const { data: ident } = await service
      .from("paciente_identidad")
      .select("tipo_doc, numero_doc_cifrado")
      .eq("id", paciente.identidad_id)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (ident?.tipo_doc === "DNI" && ident.numero_doc_cifrado) {
      // Fallo de descifrado fatal a propósito (NO tryDecrypt → null): ante un
      // ciphertext corrupto preferimos abortar la emisión antes que facturar
      // con una identidad fiscal incorrecta (Consumidor Final silencioso).
      // Abortamos con err() para no tirar una excepción fuera del Result.
      let dni: string | null;
      try {
        dni = decryptColumn(ident.numero_doc_cifrado);
      } catch {
        return err(
          "db_error",
          "No se pudo descifrar el documento del paciente; se aborta la emisión para no facturar con datos incorrectos.",
        );
      }
      if (dni) {
        docTipo = 96;
        docNumero = dni;
      }
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
