/**
 * Folio · AFIP WSFEv1 (Facturación electrónica AR).
 *
 * Cliente mínimo para solicitar CAE (Código de Autorización Electrónica) sobre
 * comprobantes individuales (Factura A/B/C, Nota de Crédito/Débito).
 *
 * Flujo:
 *   1. WSAA (Web Service de Autenticación y Autorización) entrega un TA
 *      (Ticket de Acceso) firmado válido ~12h.
 *   2. Con el TA + CUIT del emisor, llamamos WSFEv1.FECAESolicitar y
 *      obtenemos { CAE, CAEFchVto, Nro, Resultado }.
 *
 * En MVP corremos contra el **endpoint de homologación** (testing) hasta que
 * el usuario apruebe el certificado de producción. Las URLs:
 *   - WSAA homo: https://wsaahomo.afip.gov.ar/ws/services/LoginCms
 *   - WSAA prod: https://wsaa.afip.gov.ar/ws/services/LoginCms
 *   - WSFE homo: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
 *   - WSFE prod: https://servicios1.afip.gov.ar/wsfev1/service.asmx
 *
 * El certificado X.509 + private key viven en `organization.certificado_arca_cifrado`
 * (PEM concatenado: cert + privkey, AES-256-GCM app-side cifrado).
 *
 * NOTA: la implementación completa de WSAA requiere SignedCMS (PKCS7) sobre el
 * LoginTicketRequest. node-forge lo soporta. Este módulo expone la interfaz
 * que consume `comprobantes.ts`; la implementación real del firmado CMS queda
 * detrás de `signLoginTicketRequest` (TODO[F11]).
 */

import { decryptColumn } from "@/lib/crypto";

export type AfipEnv = "homologacion" | "produccion";

export interface AfipConfig {
  cuit: string;                                   // 11 digitos sin guiones
  puntoVenta: number;
  condicionIva: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";
  env: AfipEnv;
  certificadoPem: string;                         // cert + privkey concatenados
}

export interface ComprobanteRequest {
  tipoComprobante: 1 | 6 | 11;                    // 1=Factura A, 6=Factura B, 11=Factura C
  numero?: number;                                // si null, se autonumera (1 + último emitido)
  fechaEmision: Date;
  importeNeto: number;                            // ARS (en pesos, no centavos)
  importeIva?: number;                            // ARS
  importeTotal: number;                           // ARS = neto + iva
  conceptoTipo: 1 | 2 | 3;                        // 1=Productos, 2=Servicios, 3=ProductosYServicios
  docTipo: 80 | 86 | 96 | 99;                     // 80=CUIT, 86=CUIL, 96=DNI, 99=Consumidor Final
  docNumero: string;                              // CUIT/DNI/etc.
  monedaId: "PES" | "DOL";
  cotizacion: number;                             // 1 si PES
}

export interface ComprobanteResponse {
  cae: string;
  caeVencimiento: string;                         // YYYY-MM-DD
  numero: number;
  resultado: "A" | "R" | "P";                     // Aprobado/Rechazado/Parcial
  observaciones?: Array<{ code: string; msg: string }>;
}

const URLS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

const SERVICE_NAME = "wsfe";

interface AuthTicket {
  token: string;
  sign: string;
  expirationTime: string;
}

const ticketCache = new Map<string, AuthTicket>();

/**
 * Obtiene un TA de WSAA. Cachea por CUIT durante la validez del ticket
 * (~12h). Si el ticket está expirado o falta <30min, pide uno nuevo.
 */
export async function getAuthTicket(config: AfipConfig): Promise<AuthTicket> {
  const cacheKey = `${config.env}:${config.cuit}`;
  const cached = ticketCache.get(cacheKey);
  if (cached && new Date(cached.expirationTime).getTime() - Date.now() > 30 * 60_000) {
    return cached;
  }

  const cms = await signLoginTicketRequest(config.certificadoPem, SERVICE_NAME);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <soapenv:Header/>
      <soapenv:Body>
        <wsaa:loginCms>
          <wsaa:in0>${cms}</wsaa:in0>
        </wsaa:loginCms>
      </soapenv:Body>
    </soapenv:Envelope>`;

  const res = await fetch(URLS[config.env].wsaa, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
      "SOAPAction": "loginCms",
    },
    body: soapBody,
  });

  if (!res.ok) throw new Error(`WSAA HTTP ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  const tokenMatch = xml.match(/<token>([\s\S]*?)<\/token>/);
  const signMatch = xml.match(/<sign>([\s\S]*?)<\/sign>/);
  const expMatch = xml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/);
  if (!tokenMatch || !signMatch || !expMatch) {
    throw new Error(`WSAA respuesta inválida: ${xml.slice(0, 500)}`);
  }

  const ticket: AuthTicket = {
    token: tokenMatch[1],
    sign: signMatch[1],
    expirationTime: expMatch[1],
  };
  ticketCache.set(cacheKey, ticket);
  return ticket;
}

/**
 * Firma un LoginTicketRequest XML con el certificado en formato CMS/PKCS7
 * y devuelve el blob base64 listo para enviar al WSAA.
 *
 * Implementación: node-forge soporta pkcs7.createSignedData. Es 30-40 LOC.
 * En F11 cuando tengamos cert de prod, implementamos.
 */
async function signLoginTicketRequest(_pem: string, _service: string): Promise<string> {
  // TODO[F11]: implementar con node-forge
  throw new Error("signLoginTicketRequest no implementado (F11). Configurar cert + node-forge.");
}

/**
 * Solicita CAE para un comprobante individual. Asume que ya hay TA cacheado
 * (lo obtiene si no).
 */
export async function solicitarCAE(
  config: AfipConfig,
  comprobante: ComprobanteRequest,
): Promise<ComprobanteResponse> {
  const ticket = await getAuthTicket(config);
  const numero = comprobante.numero ?? (await getUltimoNumeroEmitido(config, comprobante.tipoComprobante)) + 1;

  const fecha = comprobante.fechaEmision.toISOString().slice(0, 10).replace(/-/g, "");
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
      <soapenv:Body>
        <ar:FECAESolicitar>
          <ar:Auth>
            <ar:Token>${ticket.token}</ar:Token>
            <ar:Sign>${ticket.sign}</ar:Sign>
            <ar:Cuit>${config.cuit}</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEReq>
            <ar:FeCabReq>
              <ar:CantReg>1</ar:CantReg>
              <ar:PtoVta>${config.puntoVenta}</ar:PtoVta>
              <ar:CbteTipo>${comprobante.tipoComprobante}</ar:CbteTipo>
            </ar:FeCabReq>
            <ar:FeDetReq>
              <ar:FECAEDetRequest>
                <ar:Concepto>${comprobante.conceptoTipo}</ar:Concepto>
                <ar:DocTipo>${comprobante.docTipo}</ar:DocTipo>
                <ar:DocNro>${comprobante.docNumero}</ar:DocNro>
                <ar:CbteDesde>${numero}</ar:CbteDesde>
                <ar:CbteHasta>${numero}</ar:CbteHasta>
                <ar:CbteFch>${fecha}</ar:CbteFch>
                <ar:ImpTotal>${comprobante.importeTotal.toFixed(2)}</ar:ImpTotal>
                <ar:ImpNeto>${comprobante.importeNeto.toFixed(2)}</ar:ImpNeto>
                <ar:ImpIVA>${(comprobante.importeIva ?? 0).toFixed(2)}</ar:ImpIVA>
                <ar:ImpTotConc>0</ar:ImpTotConc>
                <ar:ImpOpEx>0</ar:ImpOpEx>
                <ar:ImpTrib>0</ar:ImpTrib>
                <ar:MonId>${comprobante.monedaId}</ar:MonId>
                <ar:MonCotiz>${comprobante.cotizacion}</ar:MonCotiz>
              </ar:FECAEDetRequest>
            </ar:FeDetReq>
          </ar:FeCAEReq>
        </ar:FECAESolicitar>
      </soapenv:Body>
    </soapenv:Envelope>`;

  const res = await fetch(URLS[config.env].wsfe, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
      "SOAPAction": "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
    },
    body: soapBody,
  });

  if (!res.ok) throw new Error(`WSFE HTTP ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  const caeMatch = xml.match(/<CAE>([\s\S]*?)<\/CAE>/);
  const vtoMatch = xml.match(/<CAEFchVto>([\s\S]*?)<\/CAEFchVto>/);
  const resMatch = xml.match(/<Resultado>([\s\S]*?)<\/Resultado>/);
  if (!caeMatch || !vtoMatch || !resMatch) {
    throw new Error(`WSFE respuesta inválida: ${xml.slice(0, 1000)}`);
  }

  return {
    cae: caeMatch[1],
    caeVencimiento: `${vtoMatch[1].slice(0, 4)}-${vtoMatch[1].slice(4, 6)}-${vtoMatch[1].slice(6, 8)}`,
    numero,
    resultado: resMatch[1] as "A" | "R" | "P",
    observaciones: extractObservaciones(xml),
  };
}

async function getUltimoNumeroEmitido(_config: AfipConfig, _tipoComprobante: number): Promise<number> {
  // FECompUltimoAutorizado. Implementación similar a solicitarCAE. F11.
  throw new Error("getUltimoNumeroEmitido no implementado (F11). Pasar numero explícito por ahora.");
}

function extractObservaciones(xml: string): Array<{ code: string; msg: string }> {
  const re = /<Obs>[\s\S]*?<Code>([\s\S]*?)<\/Code>[\s\S]*?<Msg>([\s\S]*?)<\/Msg>[\s\S]*?<\/Obs>/g;
  const out: Array<{ code: string; msg: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ code: m[1], msg: m[2] });
  return out;
}

/**
 * Construye AfipConfig a partir de los campos de organization.
 * `certificado_arca_cifrado` es el PEM concatenado (cert + privkey).
 */
export function configFromOrg(org: {
  cuit: string | null;
  punto_venta_afip: number | null;
  condicion_iva: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";
  certificado_arca_cifrado: Buffer | null;
}): AfipConfig | null {
  if (!org.cuit || !org.punto_venta_afip || !org.certificado_arca_cifrado) return null;
  const pem = decryptColumn(org.certificado_arca_cifrado);
  if (!pem) return null;
  return {
    cuit: org.cuit,
    puntoVenta: org.punto_venta_afip,
    condicionIva: org.condicion_iva,
    env: (process.env.AFIP_ENV as AfipEnv) === "produccion" ? "produccion" : "homologacion",
    certificadoPem: pem,
  };
}
