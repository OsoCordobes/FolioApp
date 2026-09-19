import { createHash } from "node:crypto";
import { blindIndex, blindIndexPhone, encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

export interface ManualTurnoInput {
  operacionId: string;
  pacienteId?: string;
  pacienteNuevo?: { nombre: string; apellido: string; telefono: string; email?: string };
  servicioId: string;
  profesionalId?: string;
  inicio: string;
  duracionMin: number;
  origen: "MANUAL" | "WALK_IN";
}

/** One database commit owns the identity, patient, visit, receipt and reminders. */
export async function createManualTurno(input: ManualTurnoInput): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  try {
    const session = await getActiveSession();
    if (!session.ok) return session;
    const org = session.data.organizationId;
    const np = input.pacienteNuevo;
    // Hash plaintext intent before randomized encryption; hashing the JSON first
    // avoids blindIndex's lowercase normalization merging distinct input values.
    const intent = JSON.stringify([
      "manual-turno.v1", input.pacienteId ?? null,
      np ? [np.nombre, np.apellido, np.telefono, np.email || null] : null,
      input.servicioId, input.profesionalId ?? null, new Date(input.inicio).toISOString(),
      input.duracionMin, input.origen,
    ]);
    const fingerprint = blindIndex(createHash("sha256").update(intent).digest("hex"), org);
    const identity = np ? {
      nombre_cifrado: encryptColumn(np.nombre), apellido_cifrado: encryptColumn(np.apellido),
      telefono_cifrado: encryptColumn(np.telefono), email_cifrado: encryptColumn(np.email || null),
      nombre_hash: blindIndex(`${np.nombre} ${np.apellido}`.trim(), org),
      telefono_hash: blindIndexPhone(np.telefono, org),
    } : null;
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("create_manual_turno_atomic", {
      p_org: org, p_operation: input.operacionId, p_hash: fingerprint,
      p_paciente: input.pacienteId ?? null, p_identity: identity,
      p_profesional: input.profesionalId ?? null, p_servicio: input.servicioId,
      p_inicio: input.inicio, p_duracion: input.duracionMin, p_origen: input.origen,
    });
    if (error) {
      // These errors are explicit transaction rejection, so no partial patient
      // can exist. Transport/unknown failures never invite a fresh operation.
      if (error.code === "40001") return err("conflict", "Este intento corresponde a otros datos. Revisá el turno antes de crear otro.");
      if (error.code === "22023") return err("validation", "Revisá los datos del paciente y del turno.");
      if (/^(22|23|40|42)/.test(error.code ?? "")) {
        const mapped = mapSupabaseError(error);
        return err(mapped.code, mapped.message);
      }
      return err("network", "No pudimos confirmar el guardado. Comprobá este mismo intento antes de crear otro turno.");
    }
    if (typeof data?.turnoId !== "string" || typeof data?.pacienteId !== "string") {
      return err("network", "No pudimos confirmar el guardado. Comprobá este mismo intento antes de crear otro turno.");
    }
    return ok({ turnoId: data.turnoId, pacienteId: data.pacienteId });
  } catch {
    return err("network", "No pudimos confirmar el guardado. Comprobá este mismo intento antes de crear otro turno.");
  }
}
