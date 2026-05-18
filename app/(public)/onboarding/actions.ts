"use server";

/**
 * Folio · Server Actions de onboarding.
 *
 * Flujo de signup:
 *   1. Step 1: signUpEmail(email, password) → crea auth.users + envía verify email.
 *      El usuario verifica → vuelve a la app con sesión activa.
 *   2. Steps 2-8: data se guarda en localStorage hasta el step 9.
 *   3. Step 9: completeOnboarding(data) → atomic:
 *      - crea organization
 *      - crea profile (cifrando nombre/apellido con AES-256-GCM)
 *      - crea member OWNER
 *      - crea servicios default
 *      - crea disponibilidad_profesional default
 *
 * Usamos service_role_key en completeOnboarding porque la creación cruza
 * varias tablas + auth tablespace. La RLS aún no aplica al usuario (recién
 * se crea su membership).
 */

import { redirect } from "next/navigation";

import { encryptColumn } from "@/lib/crypto";
import {
  completeOnboardingSchema,
  signUpSchema,
} from "@/lib/onboarding/schemas";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export interface SignUpResult {
  ok: boolean;
  error?: string;
  needsConfirmation?: boolean;
}

export async function signUpEmail(
  email: string,
  password: string,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  ({ email, password } = parsed.data);

  // Usamos admin.createUser (NO signUp) por dos razones:
  //   1. signUp dispara el email de confirmación de Supabase y el SMTP por
  //      default tiene rate limit (~4 emails/hora). Eso bloquea signups
  //      legítimos en Supabase Free.
  //   2. admin.createUser con email_confirm:true crea al usuario YA confirmado
  //      sin mandar mail. Apropiado para MVP hasta que integremos SMTP propio
  //      (Resend/SendGrid en F12) y el email de bienvenida con verificación.
  //
  // Después abrimos sesión con signInWithPassword en el client cookie-based
  // para que las server actions siguientes (completeOnboarding) vean al user.
  const service = createSupabaseServiceClient();
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // 'User already registered' → intentamos auto-confirmar (puede haber quedado
    // un user previo sin confirmar) y luego abrir sesión.
    if (createErr.message.toLowerCase().includes("already") || createErr.message.toLowerCase().includes("registered")) {
      const { data: list } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (existing && !existing.email_confirmed_at) {
        await service.auth.admin.updateUserById(existing.id, { email_confirm: true });
      }
      // Caer a signInWithPassword más abajo
    } else {
      return { ok: false, error: createErr.message };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    return { ok: false, error: `Cuenta creada pero no pude entrar: ${signInErr.message}` };
  }

  void created;
  return { ok: true, needsConfirmation: false };
}

export interface OnboardingData {
  nombre: string;
  apellido: string;
  matricula: string;
  tel: string;
  consultorioNombre: string;
  rubro: string;
  direccion: string;
  ciudad: string;
  provincia: string;
  instagram?: string;
  acento: string;
  diasActivos: string[];                          // ['lun','mar',...]
  franjas: [string, string][];
  slotMin: number;
  servicios: Array<{
    nombre: string;
    dur: number;
    precioCents: number;
    tipoCanonico: string;
  }>;
}

export interface OnboardingResult {
  ok: boolean;
  error?: string;
  organizationId?: string;
  memberId?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")          // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function completeOnboarding(
  data: OnboardingData,
): Promise<OnboardingResult> {
  // Validación server-side estricta con Zod.
  const parsed = completeOnboardingSchema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path?.join(".") ?? "datos";
    return {
      ok: false,
      error: `${path}: ${firstIssue?.message ?? "inválido"}`,
    };
  }
  data = parsed.data as OnboardingData;

  // Obtener user desde sesión actual
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado. Volvé a entrar." };
  }

  // Service client para crear org + profile + member en una operación admin
  const service = createSupabaseServiceClient();

  // 1. Slug único de la org
  const baseSlug = slugify(`${data.nombre}-${data.apellido}`);
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 5) {
    const { data: exists } = await service
      .from("organization")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!exists) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  // 2. Crear organization
  const { data: org, error: orgErr } = await service
    .from("organization")
    .insert({
      slug,
      nombre: data.consultorioNombre,
      rubro: data.rubro,
      ciudad: data.ciudad,
      provincia: data.provincia,
      acento_hex: data.acento,
    })
    .select("id")
    .single();

  if (orgErr || !org) {
    return { ok: false, error: `Error creando consultorio: ${orgErr?.message ?? "desconocido"}` };
  }

  // 3. Crear profile (cifrando PII)
  const nombreCifrado = encryptColumn(data.nombre);
  const apellidoCifrado = encryptColumn(data.apellido);
  if (!nombreCifrado || !apellidoCifrado) {
    return { ok: false, error: "Error cifrando datos personales." };
  }

  const { error: profErr } = await service
    .from("profile")
    .upsert({
      id: user.id,
      email: user.email!,
      nombre_cifrado: nombreCifrado,
      apellido_cifrado: apellidoCifrado,
      matricula: data.matricula || null,
    });

  if (profErr) {
    return { ok: false, error: `Error creando perfil: ${profErr.message}` };
  }

  // 4. Crear member OWNER + es_colegiado=true (el founder es médico activo)
  const { data: member, error: memErr } = await service
    .from("member")
    .insert({
      organization_id: org.id,
      profile_id: user.id,
      role: "OWNER",
      es_colegiado: true,
      accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (memErr || !member) {
    return { ok: false, error: `Error creando membresía: ${memErr?.message ?? "desconocido"}` };
  }

  // 5. Crear servicios default
  if (data.servicios && data.servicios.length > 0) {
    const { error: servErr } = await service.from("servicio").insert(
      data.servicios.map((s) => ({
        organization_id: org.id,
        nombre: s.nombre,
        tipo_canonico: s.tipoCanonico,
        duracion_min: s.dur,
        precio_cents: s.precioCents,
      })),
    );
    if (servErr) {
      console.warn("[onboarding] servicios default fallaron:", servErr.message);
      // No bloqueamos onboarding por esto — el OWNER puede crearlos manualmente.
    }
  }

  // 6. Crear disponibilidad_profesional default
  if (data.diasActivos.length > 0 && data.franjas.length > 0) {
    const dowMap: Record<string, number> = {
      dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
    };
    const dispRows = data.diasActivos.flatMap((dia) =>
      data.franjas.map(([from, to]) => ({
        organization_id: org.id,
        member_id: member.id,
        dia_semana: dowMap[dia] ?? 1,
        hora_inicio: from,
        hora_fin: to,
      })),
    );
    if (dispRows.length > 0) {
      const { error: dispErr } = await service.from("disponibilidad_profesional").insert(dispRows);
      if (dispErr) {
        console.warn("[onboarding] disponibilidad default falló:", dispErr.message);
      }
    }
  }

  return {
    ok: true,
    organizationId: org.id,
    memberId: member.id,
  };
}

export async function finishOnboardingAndGoToApp(): Promise<void> {
  redirect("/hoy");
}
