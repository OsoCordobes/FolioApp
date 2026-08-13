/**
 * Folio · importador CSV · emparejamiento fila ↔ identidad recién insertada.
 *
 * Por qué existe este módulo (E4): el import inserta `paciente_identidad` en
 * batch y después crea una fila de `paciente` por cada identidad. El código
 * emparejaba `chunk[i]` con `returning[i]`, o sea POR POSICIÓN — asumiendo que
 * el RETURNING de un INSERT múltiple devuelve las filas en el orden en que se
 * mandaron. Postgres no lo garantiza (el orden depende del plan de ejecución,
 * de los triggers y del batching interno). Si el orden difiere, el `paciente`
 * de Juan queda apuntando a la identidad de María: nombre, DNI y teléfono
 * cifrados de otra persona, sin nada que lo detecte después.
 *
 * La solución es emparejar por un identificador estable de la fila: el par de
 * blind indexes (dni_hash, telefono_hash) que ya calculamos y que viaja en el
 * INSERT. Es exactamente lo que insertamos, así que vuelve idéntico en el
 * RETURNING, y en `paciente_identidad` es único entre las identidades activas
 * de la org (M30: UNIQUE parcial por (org, dni_hash) y por (org, telefono_hash)).
 *
 * Módulo PURO a propósito (sin DB, sin crypto): es la pieza que decide de quién
 * es cada ficha, y se testea en tests/unit/import-emparejar-identidades.test.ts.
 */

/** Lo mínimo que necesita una fila del CSV para emparejarse. */
export interface FilaEmparejable {
  dniHash: string | null;
  telHash: string | null;
}

/** Fila devuelta por el RETURNING del INSERT de `paciente_identidad`. */
export interface IdentidadInsertada {
  id: string;
  dni_hash: string | null;
  telefono_hash: string | null;
}

/**
 * Por qué una fila se quedó sin identidad atribuible:
 *   - `clave_ambigua`: dos filas del archivo (o dos identidades devueltas)
 *     comparten el mismo par de hashes — no hay forma de saber cuál es cuál.
 *   - `sin_returning`: la identidad de esa fila no volvió en el RETURNING.
 */
export type MotivoSinIdentidad = "clave_ambigua" | "sin_returning";

export type ResultadoFila =
  | { estado: "emparejada"; identidadId: string }
  | { estado: "sin_identidad"; motivo: MotivoSinIdentidad };

export interface Emparejamiento {
  /** Alineado por índice con las filas de entrada (misma longitud, mismo orden). */
  porFila: ResultadoFila[];
  /**
   * Ids devueltos que no pudieron atribuirse a ninguna fila. El caller los
   * borra: una identidad sin `paciente` es invisible en la app y encima ocupa
   * el slot del UNIQUE parcial (M30), bloqueando el reintento del import.
   */
  identidadesSinFila: string[];
}

/**
 * Clave de emparejamiento: el par (dni_hash, telefono_hash) tal cual se
 * insertó. Los blind indexes son hex de 64 chars, así que el separador "|" no
 * puede aparecer adentro y ("ab", null) nunca colapsa con (null, "ab").
 */
function clave(dniHash: string | null, telHash: string | null): string {
  return `${dniHash ?? ""}|${telHash ?? ""}`;
}

function agrupar<T>(xs: readonly T[], claveDe: (x: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const x of xs) {
    const k = claveDe(x);
    const grupo = grupos.get(k);
    if (grupo) grupo.push(x);
    else grupos.set(k, [x]);
  }
  return grupos;
}

/**
 * Empareja cada fila del CSV con la identidad que le corresponde, sin depender
 * del orden del RETURNING.
 *
 * Solo empareja cuando la correspondencia es 1↔1: una fila con esa clave y una
 * identidad con esa clave. Cualquier otra combinación (clave repetida en el
 * archivo, identidad que no volvió, dos identidades con la misma clave) deja la
 * fila SIN identidad y con motivo — nunca se elige "la primera que haya", que
 * es justamente cómo se le asignaría a un paciente la ficha de otro.
 */
export function emparejarIdentidades(
  filas: readonly FilaEmparejable[],
  insertadas: readonly IdentidadInsertada[],
): Emparejamiento {
  const filasPorClave = agrupar(filas, (f) => clave(f.dniHash, f.telHash));
  const idsPorClave = agrupar(insertadas, (i) => clave(i.dni_hash, i.telefono_hash));

  const identidadesSinFila: string[] = [];

  const porFila = filas.map((f): ResultadoFila => {
    const k = clave(f.dniHash, f.telHash);
    const hermanas = filasPorClave.get(k) ?? [];
    const candidatas = idsPorClave.get(k) ?? [];
    if (hermanas.length === 1 && candidatas.length === 1) {
      return { estado: "emparejada", identidadId: candidatas[0].id };
    }
    return {
      estado: "sin_identidad",
      motivo: hermanas.length > 1 || candidatas.length > 1 ? "clave_ambigua" : "sin_returning",
    };
  });

  for (const [k, candidatas] of idsPorClave) {
    const hermanas = filasPorClave.get(k) ?? [];
    // Se atribuye únicamente el caso 1↔1; el resto queda huérfano para borrar.
    if (hermanas.length === 1 && candidatas.length === 1) continue;
    for (const c of candidatas) identidadesSinFila.push(c.id);
  }

  return { porFila, identidadesSinFila };
}
