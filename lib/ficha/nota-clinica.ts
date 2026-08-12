/**
 * Folio · contrato de una nota clínica (M96), sin I/O.
 *
 * Vive separado de `lib/db/notas-clinicas.ts` porque ese módulo es server-only
 * (importa crypto y el client de Supabase) y la card que escribe las notas es
 * un componente cliente: necesita el tope de caracteres y la forma del dato sin
 * arrastrar medio backend al bundle.
 *
 * La validación es pura a propósito: la tabla es APPEND-ONLY, así que una nota
 * mal formada no se puede corregir después. Lo que se valida, se valida antes.
 */

/** Tope del texto plano. La DB sólo exige que el ciphertext no esté vacío. */
export const NOTA_CLINICA_MAX = 5000;

export interface NotaClinicaFicha {
  id: string;
  /** ISO. La fecha es parte del registro clínico: nunca se muestra sin ella. */
  createdAt: string;
  /** Texto descifrado, o null si el ciphertext no se pudo leer. */
  texto: string | null;
  autorId: string;
  /** Nombre para mostrar del autor; null si no se pudo resolver. */
  autorNombre: string | null;
}

export type ValidacionNota =
  | { ok: true; texto: string }
  | { ok: false; motivo: "vacia" | "larga" | "no_texto"; mensaje: string };

/**
 * Valida el texto de una nota. Devuelve el texto ya trimmeado: es exactamente
 * lo que se persiste, así que el tope se mide sobre eso y no sobre lo tipeado.
 */
export function validarTextoNota(texto: unknown): ValidacionNota {
  if (typeof texto !== "string") {
    return { ok: false, motivo: "no_texto", mensaje: "La nota tiene que ser texto." };
  }
  const limpio = texto.trim();
  if (limpio.length === 0) {
    return { ok: false, motivo: "vacia", mensaje: "Escribí algo antes de anotar." };
  }
  if (limpio.length > NOTA_CLINICA_MAX) {
    return {
      ok: false,
      motivo: "larga",
      // El largo real va en el mensaje: un "texto demasiado largo" a secas
      // obliga al profesional a adivinar cuánto recortar.
      mensaje: `La nota no puede pasar de ${NOTA_CLINICA_MAX} caracteres (tiene ${limpio.length}).`,
    };
  }
  return { ok: true, texto: limpio };
}
