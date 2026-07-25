/**
 * Folio · importador de pacientes desde CSV — lógica PURA (sin DB, sin crypto).
 *
 * Este módulo es compartido por el cliente (preview del wizard) y el server
 * action (parseo canónico antes de insertar): por eso NO importa `server-only`
 * ni `lib/crypto`. Todo lo que toca la base o los blind indexes vive en
 * `app/(app)/configuracion/importar-pacientes/actions.ts`.
 *
 * Decisiones del parser (planillas reales de consultorios AR):
 *   - Separador `,` o `;` (Excel es-AR exporta con `;`) — se autodetecta
 *     contando ocurrencias FUERA de comillas en la primera línea.
 *   - Comillas dobles con escape `""`, saltos de línea embebidos en campos
 *     entre comillas, CRLF/LF, BOM UTF-8 inicial.
 *   - Filas completamente vacías se descartan.
 *
 * Testeado en tests/unit/import-pacientes-csv.test.ts.
 */

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Techo de filas por importación (sin contar el encabezado). */
export const MAX_FILAS_IMPORT = 500;

/**
 * Techo del texto CSV aceptado (~0.8 MB): holgado para 500 filas de pacientes
 * (~100 KB reales) y por debajo del bodySizeLimit default de 1 MB de los
 * Server Actions de Next — sin esto, un archivo grande moriría en el
 * transporte con un error opaco en vez de este mensaje claro.
 */
export const MAX_CSV_CHARS = 800_000;

export type CampoImport =
  | "nombre"
  | "apellido"
  | "dni"
  | "telefono"
  | "email"
  | "fechaNacimiento"
  | "obraSocial"
  | "nroAfiliado";

export const CAMPOS_IMPORT: readonly CampoImport[] = [
  "nombre",
  "apellido",
  "dni",
  "telefono",
  "email",
  "fechaNacimiento",
  // F7a (M89) · cobertura: obra social en claro; el nº de afiliado se cifra
  // en el server action (acá es solo texto — este módulo no importa crypto).
  "obraSocial",
  "nroAfiliado",
];

export const CAMPOS_OBLIGATORIOS: readonly CampoImport[] = ["nombre", "apellido", "telefono"];

export const CAMPO_LABELS: Record<CampoImport, string> = {
  nombre: "Nombre",
  apellido: "Apellido",
  dni: "DNI",
  telefono: "Teléfono",
  email: "Email",
  fechaNacimiento: "Fecha de nacimiento",
  obraSocial: "Obra social",
  nroAfiliado: "Nº de afiliado",
};

/** Índice de columna del CSV por campo destino; ausente = columna ignorada. */
export type MapeoColumnas = Partial<Record<CampoImport, number>>;

// ─── Parser CSV ─────────────────────────────────────────────────────────────

export type SeparadorCsv = "," | ";";

/**
 * Autodetecta el separador contando `;` vs `,` fuera de comillas en la primera
 * línea no vacía. Empate o cero → `,` (default RFC 4180).
 */
export function detectarSeparador(text: string): SeparadorCsv {
  const sinBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let comas = 0;
  let puntoYComas = 0;
  let enComillas = false;
  for (let i = 0; i < sinBom.length; i++) {
    const ch = sinBom[i];
    if (ch === '"') enComillas = !enComillas;
    else if (!enComillas) {
      if (ch === "\n") {
        // Solo cuenta la primera línea con contenido.
        if (comas > 0 || puntoYComas > 0) break;
      } else if (ch === ",") comas++;
      else if (ch === ";") puntoYComas++;
    }
  }
  return puntoYComas > comas ? ";" : ",";
}

export interface CsvParseado {
  headers: string[];
  filas: string[][];
  separador: SeparadorCsv;
}

/**
 * State machine RFC-4180-ish: comillas de apertura solo al inicio de campo,
 * `""` dentro de comillas = comilla literal, newline dentro de comillas es
 * parte del valor. La primera fila son los encabezados (trim aplicado).
 */
export function parseCsv(text: string): CsvParseado {
  const sinBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const separador = detectarSeparador(sinBom);

  const registros: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;

  const cerrarCampo = () => {
    fila.push(campo);
    campo = "";
  };
  const cerrarFila = () => {
    cerrarCampo();
    // Fila completamente vacía (ej. línea en blanco al final) → descartar.
    if (fila.some((c) => c.trim() !== "")) registros.push(fila);
    fila = [];
  };

  for (let i = 0; i < sinBom.length; i++) {
    const ch = sinBom[i];
    if (enComillas) {
      if (ch === '"') {
        if (sinBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += ch;
      }
    } else if (ch === '"' && campo === "") {
      enComillas = true;
    } else if (ch === separador) {
      cerrarCampo();
    } else if (ch === "\n") {
      cerrarFila();
    } else if (ch !== "\r") {
      campo += ch;
    }
  }
  if (campo !== "" || fila.length > 0) cerrarFila();

  const headers = (registros[0] ?? []).map((h) => h.trim());
  return { headers, filas: registros.slice(1), separador };
}

// ─── Propuesta de mapeo de columnas ─────────────────────────────────────────

/** Sinónimos por campo, ya normalizados (minúsculas, sin tildes). */
const SINONIMOS: Record<CampoImport, string[]> = {
  // "nombre completo" / "paciente" matchean nombre; el usuario ajusta si su
  // planilla tiene nombre+apellido juntos (MVP: no partimos el campo).
  nombre: ["nombre", "nombres", "first name", "nombre completo", "paciente"],
  apellido: ["apellido", "apellidos", "last name", "surname"],
  dni: ["dni", "documento", "nro documento", "numero documento", "nro doc", "num doc", "doc", "document"],
  telefono: ["telefono", "tel", "celular", "cel", "movil", "whatsapp", "phone", "nro telefono", "numero telefono"],
  email: ["email", "e-mail", "mail", "correo", "correo electronico"],
  fechaNacimiento: [
    "fecha de nacimiento",
    "fecha nacimiento",
    "fecha nac",
    "f nac",
    "fec nac",
    "nacimiento",
    "fnac",
    "birthdate",
    "fecha de nac",
  ],
  // F7a · cobertura. OJO: sin sinónimos cortos tipo "os" — la pasada 2 matchea
  // por substring y "os" está adentro de media planilla ("datos", "apellidos").
  obraSocial: [
    "obra social",
    "obrasocial",
    "obra soc",
    "cobertura",
    "prepaga",
    "mutual",
  ],
  // El "º"/"°" no se normaliza con NFD (no descompone) — se listan las
  // variantes con ordinal y con grado; "afiliado" como substring cubre el resto.
  nroAfiliado: [
    "nro afiliado",
    "numero afiliado",
    "nro de afiliado",
    "numero de afiliado",
    "nº afiliado",
    "n° afiliado",
    "nº de afiliado",
    "n° de afiliado",
    "num afiliado",
    "afiliado",
    "credencial",
    "nro credencial",
    "numero credencial",
  ],
};

function normalizarHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[._/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Propone un mapeo columna → campo por matching de sinónimos (exacto primero,
 * substring después). Cada columna se asigna a lo sumo a un campo.
 */
export function proponerMapeo(headers: string[]): MapeoColumnas {
  const normalizados = headers.map(normalizarHeader);
  const mapeo: MapeoColumnas = {};
  const usadas = new Set<number>();

  // Pasada 1: match exacto de sinónimo.
  for (const campo of CAMPOS_IMPORT) {
    const idx = normalizados.findIndex((h, i) => !usadas.has(i) && SINONIMOS[campo].includes(h));
    if (idx >= 0) {
      mapeo[campo] = idx;
      usadas.add(idx);
    }
  }
  // Pasada 2: el header CONTIENE un sinónimo ("telefono celular", "dni paciente").
  for (const campo of CAMPOS_IMPORT) {
    if (mapeo[campo] !== undefined) continue;
    const idx = normalizados.findIndex(
      (h, i) => !usadas.has(i) && SINONIMOS[campo].some((s) => h.includes(s)),
    );
    if (idx >= 0) {
      mapeo[campo] = idx;
      usadas.add(idx);
    }
  }
  return mapeo;
}

// ─── Normalización y validación por fila ────────────────────────────────────

/**
 * DD/MM/YYYY (o D/M/YYYY, también con "-" o ".") y YYYY-MM-DD → ISO
 * `YYYY-MM-DD`. Valida calendario real (31/02 → null) y rango sano
 * (1900..año actual). Devuelve null si no parsea.
 */
export function parseFechaNacimiento(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;

  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  }

  if (y < 1900 || y > new Date().getFullYear()) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Valida calendario real: Date.UTC normaliza (31/02 → 02/03) y lo detectamos.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;

  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Clave de dedupe de teléfono — MISMA normalización que `blindIndexPhone`
 * (lib/crypto.ts): solo dígitos, mínimo 8, últimos 10. Así "+54 9 351 555 1234"
 * y "(351) 555-1234" colapsan a la misma clave, y el server obtiene el mismo
 * resultado al hashear. Devuelve null si no es un teléfono dedupeable.
 */
export function claveTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digitos = raw.replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return digitos.slice(-10);
}

/**
 * Clave de dedupe de DNI — misma normalización que `blindIndex` (lower/trim)
 * más el colapso de puntos/espacios típicos de planilla ("12.345.678" ≡
 * "12345678"). El server hashea ESTE valor normalizado.
 */
export function claveDni(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const limpio = normalizarDni(raw);
  if (!limpio) return null;
  return limpio.toLowerCase();
}

/**
 * "12.345.678" / "12 345 678" → "12345678". Documentos alfanuméricos
 * (pasaportes) se conservan trim-eados. Devuelve "" si queda vacío.
 */
function normalizarDni(raw: string): string {
  const s = raw.trim();
  const sinSeparadores = s.replace(/[.\s]/g, "");
  return /^\d+$/.test(sinSeparadores) ? sinSeparadores : s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FilaNormalizada {
  nombre: string;
  apellido: string;
  dni: string | null;
  telefono: string;
  email: string | null;
  fechaNacimiento: string | null;
  /** F7a (M89) · obra social/prepaga en claro. null = sin dato. */
  obraSocial: string | null;
  /** F7a (M89) · nº de afiliado — el action lo CIFRA antes del INSERT. */
  nroAfiliado: string | null;
}

export type FilaResultado =
  /** `fila` es el número de fila del ARCHIVO (1-based, contando el encabezado). */
  | { fila: number; ok: true; data: FilaNormalizada }
  | { fila: number; ok: false; motivo: string };

/**
 * Valida y normaliza una fila cruda según el mapeo. Los motivos de error son
 * es-AR, accionables y SIN valores de la fila (no filtrar PII en resultados
 * que el server podría loguear).
 */
export function normalizarFila(
  celdas: string[],
  mapeo: MapeoColumnas,
  numeroFila: number,
): FilaResultado {
  const valor = (campo: CampoImport): string => {
    const idx = mapeo[campo];
    if (idx === undefined || idx < 0) return "";
    return (celdas[idx] ?? "").trim();
  };

  const nombre = valor("nombre");
  const apellido = valor("apellido");
  const telefonoRaw = valor("telefono");
  const dniRaw = valor("dni");
  const emailRaw = valor("email");
  const fechaRaw = valor("fechaNacimiento");
  const obraSocialRaw = valor("obraSocial");
  const nroAfiliadoRaw = valor("nroAfiliado");

  const errores: string[] = [];
  if (nombre === "") errores.push("falta el nombre");
  else if (nombre.length > 80) errores.push("nombre demasiado largo (máx. 80)");
  if (apellido === "") errores.push("falta el apellido");
  else if (apellido.length > 80) errores.push("apellido demasiado largo (máx. 80)");

  if (telefonoRaw === "") errores.push("falta el teléfono");
  else if (claveTelefono(telefonoRaw) === null) {
    errores.push("teléfono inválido (mínimo 8 dígitos)");
  } else if (telefonoRaw.length > 30) errores.push("teléfono demasiado largo (máx. 30)");

  let dni: string | null = null;
  if (dniRaw !== "") {
    dni = normalizarDni(dniRaw);
    if (dni.length < 5 || dni.length > 20) {
      errores.push("DNI inválido (entre 5 y 20 caracteres)");
      dni = null;
    }
  }

  let email: string | null = null;
  if (emailRaw !== "") {
    if (!EMAIL_RE.test(emailRaw) || emailRaw.length > 120) errores.push("email inválido");
    else email = emailRaw;
  }

  let fechaNacimiento: string | null = null;
  if (fechaRaw !== "") {
    fechaNacimiento = parseFechaNacimiento(fechaRaw);
    if (fechaNacimiento === null) {
      errores.push("fecha de nacimiento inválida (usá DD/MM/AAAA o AAAA-MM-DD)");
    }
  }

  // F7a · cobertura: opcionales, solo límite de longitud (los mismos topes que
  // el alta manual — M89: nombre ≤120, afiliado ≤40).
  let obraSocial: string | null = null;
  if (obraSocialRaw !== "") {
    if (obraSocialRaw.length > 120) errores.push("obra social demasiado larga (máx. 120)");
    else obraSocial = obraSocialRaw;
  }

  let nroAfiliado: string | null = null;
  if (nroAfiliadoRaw !== "") {
    if (nroAfiliadoRaw.length > 40) errores.push("nº de afiliado demasiado largo (máx. 40)");
    else nroAfiliado = nroAfiliadoRaw;
  }

  if (errores.length > 0) {
    return { fila: numeroFila, ok: false, motivo: errores.join(" · ") };
  }
  return {
    fila: numeroFila,
    ok: true,
    data: { nombre, apellido, dni, telefono: telefonoRaw, email, fechaNacimiento, obraSocial, nroAfiliado },
  };
}

/** Normaliza todas las filas. `fila` = número real en el archivo (encabezado = 1). */
export function normalizarFilas(filas: string[][], mapeo: MapeoColumnas): FilaResultado[] {
  return filas.map((celdas, i) => normalizarFila(celdas, mapeo, i + 2));
}

// ─── Decisión de dedupe ─────────────────────────────────────────────────────

export type DedupeDecision =
  | "importar"
  | "duplicado_dni"
  | "duplicado_telefono"
  | "duplicado_en_archivo";

export interface DedupeSets {
  dni: Set<string>;
  telefono: Set<string>;
}

/**
 * Decide qué hacer con una fila dado lo que ya existe en la org y lo visto en
 * el archivo. Las claves son opacas (el server pasa blind-index hashes; el
 * cliente, claves normalizadas) — la decisión es idéntica en ambos lados.
 *
 * Prioridad: existente por DNI > existente por teléfono > duplicado dentro del
 * archivo. Cuando decide "importar", registra las claves en `vistos` (mutación
 * intencional: el caller itera en orden y la primera aparición gana).
 */
export function decidirDedupe(
  claves: { dni: string | null; telefono: string | null },
  existentes: DedupeSets,
  vistos: DedupeSets,
): DedupeDecision {
  if (claves.dni && existentes.dni.has(claves.dni)) return "duplicado_dni";
  if (claves.telefono && existentes.telefono.has(claves.telefono)) return "duplicado_telefono";
  if (
    (claves.dni && vistos.dni.has(claves.dni)) ||
    (claves.telefono && vistos.telefono.has(claves.telefono))
  ) {
    return "duplicado_en_archivo";
  }
  if (claves.dni) vistos.dni.add(claves.dni);
  if (claves.telefono) vistos.telefono.add(claves.telefono);
  return "importar";
}

// ─── Resultado del import (shape compartido server → cliente) ───────────────

export interface ImportResumen {
  total: number;
  importados: number;
  duplicadosDni: number;
  duplicadosTelefono: number;
  duplicadosEnArchivo: number;
  /** Errores por fila: número de fila del archivo + motivo (sin PII). */
  errores: Array<{ fila: number; motivo: string }>;
}
