/**
 * Folio · consentimientos · helpers puros (sin I/O, sin React, sin server-only).
 *
 * Compartidos por la card de la ficha, el modal de firma y las Server Actions.
 * Al ser puros se testean con node:test (tests/unit/consentimientos-helpers.test.ts)
 * sin mockear red ni DB.
 *
 * Contratos espejados de la DB (verificados a mano contra supabase/migrations/):
 *   - M04: enum tipo_consentimiento (GENERAL | FOTOS | DIVULGACION_CIENTIFICA |
 *     TELEMEDICINA | TRATAMIENTO_MENOR) y tabla plantilla_consentimiento
 *     (organization_id NULL = global, versionado inmutable vía reemplazado_por).
 *   - M07: CHECK consentimiento_path_format sobre firma_storage_path:
 *     '^consentimientos-firmados/[a-f0-9-]+/[a-f0-9-]+/[a-zA-Z0-9_.-]+$'
 *     (mismo regex que el zod createSchema de lib/db/consentimientos.ts).
 *   - M06: tutor_legal con vigencia_desde/vigencia_hasta opcionales.
 */

// ─── Tipos de consentimiento (enum M04) ─────────────────────────────────────

export const TIPOS_CONSENTIMIENTO = [
  "GENERAL",
  "FOTOS",
  "DIVULGACION_CIENTIFICA",
  "TELEMEDICINA",
  "TRATAMIENTO_MENOR",
] as const;

export type TipoConsentimiento = (typeof TIPOS_CONSENTIMIENTO)[number];

export const TIPO_CONSENTIMIENTO_LABEL: Record<TipoConsentimiento, string> = {
  GENERAL: "Tratamiento general",
  FOTOS: "Registro fotográfico",
  DIVULGACION_CIENTIFICA: "Divulgación científica",
  TELEMEDICINA: "Telemedicina",
  TRATAMIENTO_MENOR: "Tratamiento de menor",
};

/** Label humano de un tipo; tipos desconocidos (enum futuro) se muestran tal cual. */
export function tipoConsentimientoLabel(tipo: string): string {
  return (TIPO_CONSENTIMIENTO_LABEL as Record<string, string>)[tipo] ?? tipo;
}

// ─── Path de la firma en Storage (CHECK M07) ────────────────────────────────

/**
 * Espejo exacto del CHECK `consentimiento_path_format` (M07) y del regex del
 * zod createSchema en lib/db/consentimientos.ts. Si esto divergiera, el INSERT
 * fallaría con 23514 — el unit test lo fija.
 */
export const FIRMA_PATH_REGEX =
  /^consentimientos-firmados\/[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Construye el path canónico de la firma:
 * `consentimientos-firmados/{org}/{paciente}/{uuid}.png`.
 *
 * Lanza si algún id no es un uuid lowercase — el path se arma SIEMPRE
 * server-side con ids de la sesión activa, nunca con strings del cliente;
 * un input inválido acá es un bug, no un caso de usuario.
 */
export function buildFirmaStoragePath(input: {
  organizationId: string;
  pacienteId: string;
  archivoUuid: string;
}): string {
  const { organizationId, pacienteId, archivoUuid } = input;
  for (const [campo, valor] of Object.entries({ organizationId, pacienteId, archivoUuid })) {
    if (!UUID_REGEX.test(valor)) {
      throw new Error(`buildFirmaStoragePath: ${campo} no es un uuid válido`);
    }
  }
  const path = `consentimientos-firmados/${organizationId}/${pacienteId}/${archivoUuid}.png`;
  // Cinturón y tiradores: el resultado debe pasar el CHECK de M07 sí o sí.
  if (!FIRMA_PATH_REGEX.test(path)) {
    throw new Error("buildFirmaStoragePath: el path generado no matchea el CHECK de M07");
  }
  return path;
}

/** true si el path pasa el CHECK de M07 (y el zod del writer). */
export function esFirmaPathValido(path: string): boolean {
  return FIRMA_PATH_REGEX.test(path);
}

/**
 * El objeto en Storage vive SIN el prefijo del bucket (storage.objects.name
 * es `{org}/{paciente}/{file}` — ver M27). Inversa parcial de
 * buildFirmaStoragePath para el upload.
 */
export function pathSinBucket(firmaStoragePath: string): string {
  return firmaStoragePath.replace(/^consentimientos-firmados\//, "");
}

// ─── Selección de plantilla vigente ─────────────────────────────────────────

export interface PlantillaConsentimientoRow {
  id: string;
  organization_id: string | null;
  tipo: string;
  version: number;
  titulo: string | null;
  texto_markdown: string;
}

export interface PlantillaVigente {
  id: string;
  tipo: string;
  version: number;
  titulo: string;
  textoMarkdown: string;
  esCustomDeOrg: boolean;
}

/**
 * De todas las plantillas visibles (globales + custom de la org, ya filtradas
 * por `reemplazado_por IS NULL` en la query) elige UNA por tipo:
 *   1. custom de la org le gana a la global del mismo tipo (M04: la custom es
 *      la "variación local" del consultorio);
 *   2. a igual origen, gana la versión más alta.
 * Devuelve en el orden del enum (GENERAL primero); tipos fuera del enum van
 * al final en orden alfabético.
 */
export function elegirPlantillasVigentes(
  rows: PlantillaConsentimientoRow[],
): PlantillaVigente[] {
  const porTipo = new Map<string, PlantillaConsentimientoRow>();
  for (const row of rows) {
    const actual = porTipo.get(row.tipo);
    if (!actual || gana(row, actual)) porTipo.set(row.tipo, row);
  }

  const ordenEnum = new Map<string, number>(TIPOS_CONSENTIMIENTO.map((t, i) => [t, i]));
  const elegidas = Array.from(porTipo.values()).sort((a, b) => {
    const ia = ordenEnum.get(a.tipo) ?? Number.MAX_SAFE_INTEGER;
    const ib = ordenEnum.get(b.tipo) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.tipo.localeCompare(b.tipo);
  });

  return elegidas.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    version: p.version,
    titulo: p.titulo ?? tipoConsentimientoLabel(p.tipo),
    textoMarkdown: p.texto_markdown,
    esCustomDeOrg: p.organization_id !== null,
  }));
}

function gana(candidata: PlantillaConsentimientoRow, actual: PlantillaConsentimientoRow): boolean {
  const candidataCustom = candidata.organization_id !== null;
  const actualCustom = actual.organization_id !== null;
  if (candidataCustom !== actualCustom) return candidataCustom;
  return candidata.version > actual.version;
}

// ─── Fila de consentimiento → item serializable para la card ────────────────

/** Shape mínimo de la fila que devuelve listConsentimientosPaciente (lib/db). */
export interface ConsentimientoRowInput {
  id: string;
  tipo: string;
  firmado_en: string;
  firmado_por_tutor_id: string | null;
  revocado_en: string | null;
  revocado_motivo: string | null;
  plantilla?: { titulo: string | null; tipo: string; version: number | string } | null;
}

/**
 * Item plano que viaja de la Server Action a la card. Sin storage paths ni
 * ids de plantilla: la UI pide el signed URL por consentimientoId.
 */
export interface ConsentimientoListItem {
  id: string;
  tipo: string;
  titulo: string;
  version: number | null;
  firmadoEn: string;
  firmadoPorTutor: boolean;
  revocadoEn: string | null;
  revocadoMotivo: string | null;
  vigente: boolean;
}

export function mapConsentimientoRow(row: ConsentimientoRowInput): ConsentimientoListItem {
  const versionCruda = row.plantilla?.version;
  const version =
    typeof versionCruda === "number"
      ? versionCruda
      : typeof versionCruda === "string" && versionCruda.trim() !== ""
        ? Number.parseInt(versionCruda, 10)
        : null;
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.plantilla?.titulo ?? tipoConsentimientoLabel(row.tipo),
    version: version != null && Number.isFinite(version) ? version : null,
    firmadoEn: row.firmado_en,
    firmadoPorTutor: row.firmado_por_tutor_id !== null,
    revocadoEn: row.revocado_en,
    revocadoMotivo: row.revocado_motivo,
    vigente: row.revocado_en === null,
  };
}

// ─── Decisión de firmante (tutor legal, Ley 26.061) ─────────────────────────

export interface TutorOption {
  id: string;
  nombre: string;
  vinculo: string;
  esPrincipal: boolean;
}

/**
 * true si el tutor está vigente HOY según sus fechas de designación (M06:
 * ambas opcionales — sin fechas se considera vigente). `hoy` en formato
 * YYYY-MM-DD; las fechas de la DB son `date` así que la comparación
 * lexicográfica es correcta.
 */
export function tutorVigente(
  tutor: { vigenciaDesde: string | null; vigenciaHasta: string | null },
  hoy: string,
): boolean {
  if (tutor.vigenciaDesde && hoy < tutor.vigenciaDesde) return false;
  if (tutor.vigenciaHasta && hoy > tutor.vigenciaHasta) return false;
  return true;
}

/**
 * Preselección del firmante: para TRATAMIENTO_MENOR el firmante natural es el
 * tutor principal (o el primero disponible). Para el resto de los tipos el
 * default es que firme el paciente (null) aunque haya tutores cargados.
 */
export function defaultTutorId(tipo: string, tutores: TutorOption[]): string | null {
  if (tipo !== "TRATAMIENTO_MENOR" || tutores.length === 0) return null;
  return (tutores.find((t) => t.esPrincipal) ?? tutores[0]).id;
}

/**
 * true si el tipo exige seleccionar tutor y hay tutores para elegir
 * (TRATAMIENTO_MENOR firma el representante legal — Ley 26.061 art. 24).
 * Sin tutores cargados NO se bloquea la firma (el schema M07 permite
 * firmado_por_tutor_id NULL); la UI muestra la advertencia.
 */
export function tutorRequerido(tipo: string, cantidadTutores: number): boolean {
  return tipo === "TRATAMIENTO_MENOR" && cantidadTutores > 0;
}

// ─── Markdown legal → bloques renderizables ─────────────────────────────────
//
// Las plantillas (M68 seed) usan un subset chico de markdown: #/##/### títulos,
// **negrita** inline, listas - / 1., checkboxes [ ], separador --- y párrafos.
// Parseamos a tokens y el componente los rinde como React elements — NUNCA
// dangerouslySetInnerHTML (el texto puede venir de plantillas custom de la org).

export interface ConsentInline {
  bold: boolean;
  text: string;
}

export type ConsentBlock =
  | { kind: "heading"; nivel: 1 | 2 | 3; text: string }
  | { kind: "parrafo"; inlines: ConsentInline[] }
  | { kind: "lista"; ordenada: boolean; items: ConsentInline[][] }
  | { kind: "checkbox"; text: string }
  | { kind: "hr" };

/** Parte una línea en segmentos normal/negrita según pares de `**`. */
export function parseInlineBold(text: string): ConsentInline[] {
  const out: ConsentInline[] = [];
  const partes = text.split("**");
  // Índices impares están "adentro" de un par de **. Si la cantidad de ** es
  // impar, el último segmento queda sin cerrar → se trata como texto normal
  // con los asteriscos visibles (fail-safe, no se come contenido).
  const balanceado = partes.length % 2 === 1;
  partes.forEach((parte, i) => {
    if (parte === "") return;
    const esBold = balanceado ? i % 2 === 1 : false;
    const texto = balanceado ? parte : i === 0 ? parte : `**${parte}`;
    if (!balanceado && i > 0 && out.length > 0 && !out[out.length - 1].bold) {
      out[out.length - 1] = { bold: false, text: out[out.length - 1].text + texto };
      return;
    }
    out.push({ bold: esBold, text: texto });
  });
  return out;
}

const RE_HEADING = /^(#{1,3})\s+(.*)$/;
const RE_UL_ITEM = /^-\s+(.*)$/;
const RE_OL_ITEM = /^\d+\.\s+(.*)$/;
const RE_CHECKBOX = /^\[( |x|X)\]\s*(.*)$/;
const RE_HR = /^-{3,}$/;

/**
 * Markdown de plantilla → lista de bloques. Toda línea desconocida cae a
 * párrafo (nunca se pierde texto legal). Líneas contiguas de texto se juntan
 * en un párrafo; la línea en blanco separa bloques.
 */
export function parseConsentMarkdown(markdown: string): ConsentBlock[] {
  const bloques: ConsentBlock[] = [];
  const lineas = markdown.replace(/\r\n/g, "\n").split("\n");

  let parrafoActual: string[] = [];
  let listaActual: { ordenada: boolean; items: string[] } | null = null;

  const cerrarParrafo = () => {
    if (parrafoActual.length > 0) {
      bloques.push({ kind: "parrafo", inlines: parseInlineBold(parrafoActual.join(" ")) });
      parrafoActual = [];
    }
  };
  const cerrarLista = () => {
    if (listaActual) {
      bloques.push({
        kind: "lista",
        ordenada: listaActual.ordenada,
        items: listaActual.items.map(parseInlineBold),
      });
      listaActual = null;
    }
  };

  for (const cruda of lineas) {
    const linea = cruda.trim();

    if (linea === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }

    const heading = RE_HEADING.exec(linea);
    if (heading) {
      cerrarParrafo();
      cerrarLista();
      bloques.push({
        kind: "heading",
        nivel: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    if (RE_HR.test(linea)) {
      cerrarParrafo();
      cerrarLista();
      bloques.push({ kind: "hr" });
      continue;
    }

    const checkbox = RE_CHECKBOX.exec(linea);
    if (checkbox) {
      cerrarParrafo();
      cerrarLista();
      bloques.push({ kind: "checkbox", text: checkbox[2] });
      continue;
    }

    const ul = RE_UL_ITEM.exec(linea);
    const ol = ul ? null : RE_OL_ITEM.exec(linea);
    if (ul || ol) {
      cerrarParrafo();
      const ordenada = Boolean(ol);
      if (!listaActual || listaActual.ordenada !== ordenada) {
        cerrarLista();
        listaActual = { ordenada, items: [] };
      }
      listaActual.items.push((ul ?? ol)![1]);
      continue;
    }

    cerrarLista();
    parrafoActual.push(linea);
  }

  cerrarParrafo();
  cerrarLista();
  return bloques;
}
