/**
 * Folio · notas clínicas de la ficha (M96).
 *
 * La anotación que NO cuelga de un turno: la llamada telefónica, el WhatsApp
 * preguntando por una reacción, lo que el profesional recuerda al día
 * siguiente. Antes eso no tenía dónde vivir — se perdía, o terminaba deformando
 * la nota de una visita a la que no pertenece.
 *
 * APPEND-ONLY (Ley 26.529 art. 15): no hay update ni delete acá, ni los va a
 * haber. Un error se corrige agregando otra nota, como la tinta. La DB lo
 * refuerza por partida doble (policies + triggers, M96), así que este módulo
 * no es la única línea de defensa.
 *
 * PHI: el texto viaja cifrado app-side (encryptColumn). Nada de contenido
 * clínico se loguea acá.
 */

import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { validarTextoNota, type NotaClinicaFicha } from "@/lib/ficha/nota-clinica";

import { err, ok, mapSupabaseError, type Result } from "./errors";
import { getActiveSession } from "./session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// El contrato (tope, forma del dato, validación) vive en lib/ficha/nota-clinica
// porque la card que escribe las notas es un componente CLIENTE y este módulo es
// server-only: importa crypto y el client de Supabase.
export { NOTA_CLINICA_MAX, type NotaClinicaFicha } from "@/lib/ficha/nota-clinica";

/**
 * Agrega una nota a la ficha de un paciente.
 *
 * El `autor_id` NO lo elige el caller: sale de la sesión activa. La RLS de M96
 * lo vuelve a exigir (`autor_id = user_member_id_in(org)`), así que una nota
 * firmada con el member de otro es imposible por dos caminos.
 *
 * El guard de pertenencia del paciente lo hace la propia RLS: el INSERT exige
 * `EXISTS (paciente …)` evaluado bajo la RLS de `paciente`, o sea que un
 * pacienteId de otra org —o de una ficha en caja fuerte ajena— no matchea y el
 * insert se rechaza. No hace falta un SELECT previo que además filtraría, por
 * la diferencia de mensajes, si esa ficha existe.
 */
export async function addNotaClinica(input: {
  pacienteId: string;
  texto: string;
}): Promise<Result<{ id: string }>> {
  const textoOk = validarTextoNota(input.texto);
  if (!textoOk.ok) return err("validation", textoOk.mensaje);

  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nota_clinica")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: input.pacienteId,
      autor_id: session.data.memberId,
      texto_cifrado: encryptColumn(textoOk.texto),
    })
    .select("id")
    .single();

  if (error) {
    const mapped = mapSupabaseError(error);
    // La RLS rechaza tanto "ese paciente no es tuyo" como "no tenés rol
    // clínico" con el mismo 42501. No lo desambiguamos: el mensaje sería un
    // oráculo sobre fichas que el usuario no puede ver.
    if (mapped.code === "forbidden") {
      return err("forbidden", "No podés anotar en esta ficha.");
    }
    return err(mapped.code, "No pudimos guardar la nota.", error.message);
  }
  if (!data) return err("db_error", "No pudimos guardar la nota.");
  return ok({ id: data.id as string });
}

/**
 * Notas de una ficha, de la más nueva a la más vieja.
 *
 * Una nota cuyo ciphertext no descifra se devuelve con `texto: null` en vez de
 * desaparecer: que el profesional vea "hay una nota del 3 de julio que no
 * podemos mostrar" es infinitamente mejor que un hueco silencioso en la
 * historia clínica. El fallo ya va a Sentry vía tryDecrypt.
 */
export async function listNotasClinicas(
  pacienteId: string,
  limite = 100,
): Promise<Result<NotaClinicaFicha[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nota_clinica")
    .select("id, created_at, texto_cifrado, autor_id")
    .eq("paciente_id", pacienteId)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No pudimos leer las notas de la ficha.", error.message);
  }

  const filas = (data ?? []) as Array<{
    id: string;
    created_at: string;
    texto_cifrado: string | null;
    autor_id: string;
  }>;
  if (filas.length === 0) return ok([]);

  // Nombres de autor en UN batch (no N+1). Si falla, las notas se muestran
  // igual sin nombre: el contenido clínico manda sobre el adorno.
  //
  // `profile.nombre`/`apellido` están CIFRADOS (M02), así que se descifran acá —
  // server-side, como el resto de la PII. El email es el fallback cuando el
  // nombre no se puede leer: identifica al autor igual y no es PHI del paciente.
  const autorIds = [...new Set(filas.map((f) => f.autor_id))];
  const nombrePorMember = new Map<string, string>();
  const { data: members } = await supabase
    .from("member")
    .select("id, profile:profile_id (nombre_cifrado, apellido_cifrado, email)")
    .in("id", autorIds);
  const autores = (members ?? []) as unknown as Array<{
    id: string;
    profile:
      | { nombre_cifrado: string | null; apellido_cifrado: string | null; email: string | null }
      // PostgREST tipa el embed como array cuando no puede probar la cardinalidad.
      | Array<{ nombre_cifrado: string | null; apellido_cifrado: string | null; email: string | null }>
      | null;
  }>;
  for (const m of autores) {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    if (!p) continue;
    const nombre = [
      tryDecrypt(p.nombre_cifrado, "profile.nombre"),
      tryDecrypt(p.apellido_cifrado, "profile.apellido"),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (nombre) nombrePorMember.set(m.id, nombre);
    else if (p.email) nombrePorMember.set(m.id, p.email);
  }

  return ok(
    filas.map((f) => ({
      id: f.id,
      createdAt: f.created_at,
      texto: tryDecrypt(f.texto_cifrado, "nota_clinica.texto"),
      autorId: f.autor_id,
      autorNombre: nombrePorMember.get(f.autor_id) ?? null,
    })),
  );
}
