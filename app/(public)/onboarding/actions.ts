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
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: "Contraseña debe tener mínimo 8 caracteres." };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${appUrl}/api/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    needsConfirmation: data.user?.email_confirmed_at == null,
  };
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
  // Validaciones server-side
  if (!data.nombre || !data.apellido) {
    return { ok: false, error: "Nombre y apellido son obligatorios." };
  }
  if (!data.consultorioNombre || !data.ciudad || !data.provincia) {
    return { ok: false, error: "Datos del consultorio incompletos." };
  }

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
