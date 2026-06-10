/**
 * Folio · Onboarding · resume state.
 *
 * Si un user abandona el onboarding y vuelve después, lee el estado actual
 * de su org + profile + member desde la DB y le devuelve:
 *   - el step donde quedó (`initialStep`)
 *   - los datos para pre-llenar los campos (`initialData`)
 *
 * Source of truth: DB. localStorage del cliente solo es backup de drafts no guardados.
 *
 * El layout `/onboarding/page.tsx` lo llama para hidratar el `<OnboardingApp />`.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptColumn } from "@/lib/crypto";

import { type Result, err, ok } from "./errors";

export interface OnboardingResumeState {
  /** false si el user todavía NO terminó. Si true, redirigir a /hoy. */
  shouldShowOnboarding: boolean;
  /** Step en el que arrancar (2-9). 9 si ya está completo. */
  initialStep: number;
  /** Slug actual de la org (provisional o ya editado por el user). */
  slug: string | null;
  /** OrganizationId — necesario para auto-save por step. */
  organizationId: string | null;
  /** Datos pre-llenados de los steps anteriores. Cliente los carga al state. */
  initialData: {
    email: string;
    nombre?: string;
    apellido?: string;
    matricula?: string;
    tel?: string;
    consultorioNombre?: string;
    rubro?: string;
    /** M50 · especialidad arquitectural de la org. */
    especialidad?: string;
    /** M49 · tipo de organización. */
    tipo?: "INDEPENDIENTE" | "CLINICA";
    ciudad?: string;
    provincia?: string;
    direccion?: string;
    direccionCompleta?: string;
    telefonoPublico?: string;
    instagram?: string;
    bio?: string;
    acento?: string;
    logoUrl?: string | null;
    cardMood?: "calido" | "clinico" | "editorial" | "boutique";
    diasActivos?: string[];
    franjas?: [string, string][];
    slotMin?: number;
    servicios?: Array<{
      nombre: string;
      dur: number;
      precio: number;
      tipoCanonico?: string;
    }>;
  };
}

/**
 * Lee el estado del onboarding del user actual. Si el user no tiene auth.user,
 * el caller debe redirigir a /login antes de llamar a esta función.
 *
 * El parámetro `serviceOverride` permite inyectar un mock para tests (mismo
 * patrón que `lib/auth/find-user-by-email.ts`). En producción siempre se
 * construye el service client real.
 */
export async function getOnboardingResumeState(
  userId: string,
  email: string,
  serviceOverride?: ReturnType<typeof createSupabaseServiceClient>,
): Promise<Result<OnboardingResumeState>> {
  const service = serviceOverride ?? createSupabaseServiceClient();

  // 1. Buscar member del user (la membership a una org).
  const { data: member, error: memErr } = await service
    .from("member")
    .select("id, organization_id")
    .eq("profile_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (memErr) return err("db_error", "Error leyendo membresía.", memErr.message);

  // Caso A: no tiene member → todavía no pasó por signUpAndInitOrganization.
  // Devolver estado "step 1, nada pre-llenado".
  if (!member) {
    return ok({
      shouldShowOnboarding: true,
      initialStep: 1,
      slug: null,
      organizationId: null,
      initialData: { email },
    });
  }

  // ─── Caso A.1: orphan membership (M37 defense in depth) ──────────────────
  // Antes de leer org con `deleted_at IS NULL`, distinguir "org soft-deleted"
  // de "org no existe". El primer caso causaba un loop infinito en producción:
  //   /hoy → (app)/layout veía not_found en active-context → redirect /onboarding
  //   /onboarding → este mismo helper retornaba error → page redirect /hoy
  // El audit del 2026-05-26 marcó esto como HIGH. La migración M37 agrega un
  // trigger de cascade soft-delete sobre member para que esta condición no
  // pueda surgir orgánicamente, pero también necesitamos manejar filas legacy
  // (orgs soft-deleted antes de M37).
  const { data: orgExistence, error: existsErr } = await service
    .from("organization")
    .select("id, deleted_at")
    .eq("id", member.organization_id)
    .maybeSingle();

  if (existsErr) return err("db_error", "Error verificando organización.", existsErr.message);

  if (!orgExistence || orgExistence.deleted_at !== null) {
    // La org desapareció (deleted_at set, o nunca existió). Limpiar el member
    // huérfano para no volver acá, y devolver step 1 para re-bootstrap.
    if (orgExistence && orgExistence.deleted_at !== null) {
      await service
        .from("member")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", member.id);
    }
    return ok({
      shouldShowOnboarding: true,
      initialStep: 1,
      slug: null,
      organizationId: null,
      initialData: { email },
    });
  }

  // 2. Leer organization + profile.
  const [orgRes, profRes] = await Promise.all([
    service
      .from("organization")
      .select(
        "id, slug, nombre, rubro, especialidad, tipo, ciudad, provincia, acento_hex, telefono_publico, direccion_completa, instagram_handle, bio, logo_url, card_mood, onboarding_completed, onboarding_step_max",
      )
      .eq("id", member.organization_id)
      .is("deleted_at", null)
      .maybeSingle(),
    service
      .from("profile")
      .select("nombre_cifrado, apellido_cifrado, matricula")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (orgRes.error) return err("db_error", "Error leyendo organización.", orgRes.error.message);
  if (!orgRes.data) return err("not_found", "Organización no existe.");

  const org = orgRes.data as {
    id: string;
    slug: string;
    nombre: string | null;
    rubro: string | null;
    especialidad: string | null;
    tipo: "INDEPENDIENTE" | "CLINICA" | null;
    ciudad: string | null;
    provincia: string | null;
    acento_hex: string | null;
    telefono_publico: string | null;
    direccion_completa: string | null;
    instagram_handle: string | null;
    bio: string | null;
    logo_url: string | null;
    card_mood: "calido" | "clinico" | "editorial" | "boutique" | null;
    onboarding_completed: boolean;
    onboarding_step_max: number;
  };
  const prof = (profRes.data ?? {}) as {
    nombre_cifrado?: string | null;
    apellido_cifrado?: string | null;
    matricula?: string | null;
  };

  // Caso B: onboarding ya completado → no mostrar.
  if (org.onboarding_completed) {
    return ok({
      shouldShowOnboarding: false,
      initialStep: 9,
      slug: org.slug,
      organizationId: org.id,
      initialData: { email },
    });
  }

  // Caso C: onboarding incompleto → resumir donde quedó.
  // Resume al MAYOR de: step_max guardado, o step 2 si recién pasó signup.
  const resumeStep = Math.max(org.onboarding_step_max, 2);

  // Desencriptar PII del profile (con fallback null si falla).
  const tryDecrypt = (v: string | null | undefined): string | undefined => {
    if (!v) return undefined;
    try {
      const dec = decryptColumn(v);
      return dec ?? undefined;
    } catch {
      return undefined;
    }
  };

  // 3. Leer disponibilidad + servicios para steps 5/6 si avanzamos hasta ahí.
  let diasActivos: string[] | undefined;
  let franjas: [string, string][] | undefined;
  let slotMin: number | undefined;
  let servicios: OnboardingResumeState["initialData"]["servicios"];

  if (resumeStep >= 5) {
    const { data: disp } = await service
      .from("disponibilidad_profesional")
      .select("dia_semana, hora_inicio, hora_fin")
      .eq("organization_id", org.id)
      .eq("member_id", member.id);
    if (disp && disp.length > 0) {
      const dowReverse: Record<number, string> = {
        0: "dom", 1: "lun", 2: "mar", 3: "mie", 4: "jue", 5: "vie", 6: "sab",
      };
      const dias = new Set<string>();
      const franjasSet = new Set<string>();
      for (const row of disp) {
        const dia = dowReverse[row.dia_semana as number];
        if (dia) dias.add(dia);
        franjasSet.add(`${row.hora_inicio}|${row.hora_fin}`);
      }
      diasActivos = Array.from(dias);
      franjas = Array.from(franjasSet).map((s) => s.split("|") as [string, string]);
    }
  }

  if (resumeStep >= 6) {
    const { data: servs } = await service
      .from("servicio")
      .select("nombre, duracion_min, precio_cents, tipo_canonico")
      .eq("organization_id", org.id)
      .is("deleted_at", null);
    if (servs && servs.length > 0) {
      servicios = servs.map((s) => ({
        nombre: s.nombre as string,
        dur: s.duracion_min as number,
        precio: (s.precio_cents as number) / 100,
        tipoCanonico: (s.tipo_canonico as string) ?? undefined,
      }));
    }
  }

  return ok({
    shouldShowOnboarding: true,
    initialStep: resumeStep,
    slug: org.slug,
    organizationId: org.id,
    initialData: {
      email,
      nombre: tryDecrypt(prof.nombre_cifrado),
      apellido: tryDecrypt(prof.apellido_cifrado),
      matricula: prof.matricula ?? undefined,
      consultorioNombre: org.nombre ?? undefined,
      rubro: org.rubro ?? undefined,
      especialidad: org.especialidad ?? undefined,
      tipo: org.tipo ?? undefined,
      ciudad: org.ciudad ?? undefined,
      provincia: org.provincia ?? undefined,
      direccion: org.direccion_completa ?? undefined,
      direccionCompleta: org.direccion_completa ?? undefined,
      telefonoPublico: org.telefono_publico ?? undefined,
      instagram: org.instagram_handle ?? undefined,
      bio: org.bio ?? undefined,
      acento: org.acento_hex ?? undefined,
      logoUrl: org.logo_url ?? null,
      cardMood: org.card_mood ?? "editorial",
      diasActivos,
      franjas,
      slotMin,
      servicios,
    },
  });
}
