/**
 * Folio · núcleo del timeline de modificaciones de la historia clínica.
 *
 * El pedido del quiropráctico era "quiero ver quién tocó qué y cuándo". La
 * infraestructura ya existía (`audit_log` con before/after, `sesion_enmienda`)
 * pero no había ninguna UI que la mostrara.
 *
 * ─── La regla que hace que esto sea seguro ─────────────────────────────────
 * El timeline muestra **qué campos cambiaron, nunca sus valores**.
 *
 * No es una limitación técnica: el payload de `audit_log` trae la fila entera
 * (`before`/`after`), y los campos clínicos son `bytea` cifrado —ilegibles a
 * propósito—, pero los que NO están cifrados sí se leerían. Mostrar "Subjetivo
 * (S)" es exactamente la información que el profesional necesita para saber que
 * alguien tocó su nota; mostrar el texto sería reconstruir la historia clínica
 * en una pantalla que no es la ficha, y por un camino que no pasa por la RLS de
 * la ficha.
 *
 * Módulo PURO: sin DB, sin React. Las invariantes de "qué se muestra" se fijan
 * en tests, no en una revisión visual.
 */

/** Un evento del audit, ya normalizado. */
export interface EventoAuditCrudo {
  id: string;
  /** ISO. */
  ts: string;
  /** `sesion.update`, `nota_clinica.insert`, … */
  action: string;
  resourceType: string;
  resourceId: string;
  actorId: string | null;
  /** Nombre para mostrar del actor, si se pudo resolver. */
  actorNombre: string | null;
  /** Payload del audit. NUNCA sale de este módulo: sólo se derivan labels. */
  payload: unknown;
}

export interface EventoTimeline {
  id: string;
  ts: string;
  actorId: string | null;
  actorNombre: string | null;
  /** Frase en es-AR: "Editó la nota de la sesión", "Anotó en la ficha", … */
  titulo: string;
  /** Labels de los campos tocados. Nunca valores. */
  campos: string[];
  /** Cuántos eventos se colapsaron en éste (ráfaga de autosave). */
  agrupados: number;
}

/**
 * Columna → nombre humano.
 *
 * Lo que NO está acá no se muestra: un campo nuevo aparece como su nombre
 * técnico o no aparece, pero nunca como su contenido.
 */
const LABEL_COLUMNA: Record<string, string> = {
  soap_s_cifrado: "Subjetivo (S)",
  soap_o_cifrado: "Objetivo (O)",
  soap_a_cifrado: "Análisis (A)",
  soap_p_cifrado: "Plan (P)",
  notas_cifrado: "Notas de la sesión",
  tool_data_cifrado: "Herramienta de la especialidad",
  eva_antes: "EVA antes",
  eva_despues: "EVA después",
  locked_at: "Cierre de la sesión",
  texto_cifrado: "Texto de la nota",
  nombre_cifrado: "Nombre",
  apellido_cifrado: "Apellido",
  telefono_cifrado: "Teléfono",
  email_cifrado: "Email",
  caja_fuerte_profesional: "Caja fuerte",
  profesional_principal_id: "Profesional asignado",
};

/**
 * Campos que cambian solos y sólo generan ruido. `updated_at` lo mueve un
 * trigger en cada UPDATE; `vertebras_json` es el espejo legacy de la
 * herramienta, así que aparecería duplicado junto a `tool_data_cifrado`.
 */
const COLUMNAS_IGNORADAS = new Set(["updated_at", "vertebras_json", "id", "created_at"]);

/** Acción del audit → frase en es-AR. */
const TITULO_ACCION: Record<string, string> = {
  "sesion.insert": "Escribió la nota de la visita",
  "sesion.update": "Editó la nota de la visita",
  "nota_clinica.insert": "Anotó en la ficha",
  "sesion_enmienda.insert": "Agregó una enmienda",
  "paciente.update": "Editó los datos del paciente",
  "paciente_identidad.update": "Editó los datos de contacto",
  "paciente_identidad.insert": "Cargó los datos del paciente",
};

/**
 * Campos que cambiaron en un evento de audit, como LABELS.
 *
 * Sólo mira las claves del diff. Si el payload no tiene la forma
 * `{before, after}` (un insert, por ejemplo), devuelve `[]`: preferimos no
 * decir nada antes que inventar.
 */
export function diffCamposAudit(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object") return [];
  const p = payload as { before?: unknown; after?: unknown };
  if (p.before === null || typeof p.before !== "object") return [];
  if (p.after === null || typeof p.after !== "object") return [];

  const before = p.before as Record<string, unknown>;
  const after = p.after as Record<string, unknown>;

  const cambiados: string[] = [];
  for (const clave of Object.keys(after)) {
    if (COLUMNAS_IGNORADAS.has(clave)) continue;
    // Comparación por serialización: los valores son opacos (bytea en base64,
    // jsonb) y acá sólo interesa "¿es distinto?", nunca el contenido.
    if (JSON.stringify(before[clave]) === JSON.stringify(after[clave])) continue;
    cambiados.push(LABEL_COLUMNA[clave] ?? clave);
  }
  return cambiados;
}

/** Título humano de un evento. Cae al `action` crudo si no lo conocemos. */
export function clasificarEvento(action: string): string {
  return TITULO_ACCION[action] ?? action;
}

export function aEventoTimeline(e: EventoAuditCrudo): EventoTimeline {
  return {
    id: e.id,
    ts: e.ts,
    actorId: e.actorId,
    actorNombre: e.actorNombre,
    titulo: clasificarEvento(e.action),
    campos: diffCamposAudit(e.payload),
    agrupados: 1,
  };
}

/** Ventana de agrupación de una ráfaga de autosave. */
export const VENTANA_AGRUPACION_MS = 30 * 60 * 1000;

/**
 * Colapsa ráfagas del MISMO actor sobre el MISMO recurso y acción dentro de una
 * ventana de 30 minutos.
 *
 * Sin esto el feature nace inusable: el autosave de la ficha escribe cada pocos
 * segundos mientras el profesional tipea, así que una consulta de veinte minutos
 * genera decenas de "Editó la nota de la visita" idénticos y el evento que
 * importa —el de ayer, de otro profesional— queda enterrado.
 *
 * Los eventos tienen que venir en orden DESC por ts. El grupo conserva el
 * evento MÁS RECIENTE (es el estado en el que quedó) y suma los campos de todos
 * los colapsados: si en la ráfaga se tocó el SOAP y la herramienta, las dos
 * cosas figuran.
 */
export function agruparEventos(
  eventos: EventoTimeline[],
  claveRecurso: (e: EventoTimeline) => string,
  ventanaMs: number = VENTANA_AGRUPACION_MS,
): EventoTimeline[] {
  const out: EventoTimeline[] = [];
  for (const ev of eventos) {
    const ultimo = out[out.length - 1];
    const mismoGrupo =
      ultimo &&
      ultimo.actorId === ev.actorId &&
      ultimo.titulo === ev.titulo &&
      claveRecurso(ultimo) === claveRecurso(ev) &&
      Math.abs(new Date(ultimo.ts).getTime() - new Date(ev.ts).getTime()) <= ventanaMs;

    if (mismoGrupo) {
      ultimo.agrupados += 1;
      for (const c of ev.campos) {
        if (!ultimo.campos.includes(c)) ultimo.campos.push(c);
      }
      continue;
    }
    out.push({ ...ev, campos: [...ev.campos] });
  }
  return out;
}
