"use server";

import { headers } from "next/headers";

import { formatResetMessage, limitByIp, limitByKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";

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

import { findUserByEmail } from "@/lib/auth/find-user-by-email";
import { encryptColumn } from "@/lib/crypto";
import { signUpSchema } from "@/lib/onboarding/schemas";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

// ─── Legacy cleanup (auditoría LOW): las funciones `signUpEmail` y
// `completeOnboarding` fueron eliminadas en Phase 10. No tenían callers
// (grep confirmado) y representaban un attack surface no auditado — sin
// rate-limit, sin Turnstile, sin consent gate. Toda creación de cuenta
// ahora pasa por `signUpAndInitOrganization` (premium architecture).

export async function finishOnboardingAndGoToApp(): Promise<void> {
  redirect("/hoy");
}

// ════════════════════════════════════════════════════════════════════════════
// PREMIUM ONBOARDING ARCHITECTURE (M20+)
// ════════════════════════════════════════════════════════════════════════════
// Flow oficial: la org se crea en step 1 (post-signup) con onboarding_completed=false.
// Cada step persiste su delta con updateOnboardingStep. Step 9 llama finalizeOnboarding
// que solo marca completed=true.
//
// El bootstrap atómico de profile+org+member usa el RPC SECURITY DEFINER de M33
// (bootstrap_org_atomic). Reemplazó al flow viejo de inserts manuales + DELETEs
// compensatorios que tenía el legacy completeOnboarding (removido en Phase 10).

export interface OnboardingBootstrapResult {
  ok: boolean;
  error?: string;
  organizationId?: string;
  slug?: string;
  needsConfirmation?: boolean;
}

/**
 * Premium signup: crea auth.user + organization placeholder + profile vacío + member OWNER.
 *
 * La org queda con datos mínimos (slug auto del email) y `onboarding_completed=false`.
 * Steps siguientes la van completando vía `updateOnboardingStep`.
 *
 * Idempotente: si el user ya existe (registró antes), abre sesión y busca su org.
 * Si tiene org → la devuelve. Si no → la crea.
 */
export async function signUpAndInitOrganization(
  email: string,
  password: string,
  options: { turnstileToken?: string | null; consent?: boolean } = {},
): Promise<OnboardingBootstrapResult> {
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  ({ email, password } = parsed.data);

  // ─── Audit-prep Phase 4: rate-limit + Turnstile + consent gate ─────────────
  // Headers carry the caller's IP via Vercel's x-forwarded-for. In dev /
  // self-hosted the proxy may not set it; fall back to "unknown" which the
  // limiter buckets under a single key (acceptable for dev — it'll still
  // throttle abuse).
  const reqHeaders = await headers();
  const ipRaw = reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? null;
  const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
  // Cascada doble (audit-prep finding A4):
  //   - 50/h por IP: contempla demos / wifi compartido de clínica donde
  //     varios profesionales registran a la vez.
  //   - 50/h por email: defensa contra credential-stuffing distribuido
  //     (botnet probando passwords contra un mismo email desde N IPs).
  //     Original 5/h era muy ajustado: cada error de UX (password débil,
  //     captcha vencido) quemaba un slot y bloqueaba al user 1h. Turnstile
  //     + el rate-limit propio de Supabase Auth sostienen la defensa real.
  // Ambos miden ventanas independientes; cualquier limit triggered bloquea.
  const ipLimit = await limitByIp("signup", ip, 50);
  if (!ipLimit.ok) {
    return {
      ok: false,
      error: `Demasiados intentos de registro desde tu red. ${formatResetMessage(ipLimit.resetIn)}`,
    };
  }
  const emailLimit = await limitByKey("signup-email", email, 50);
  if (!emailLimit.ok) {
    return {
      ok: false,
      error: `Demasiados intentos para este email. ${formatResetMessage(emailLimit.resetIn)}`,
    };
  }
  // Turnstile is mandatory in production. In dev the verifier is a no-op
  // when TURNSTILE_SECRET_KEY is missing (returns true) so visual regression
  // and quick local signup still work.
  const captchaOk = await verifyTurnstile(options.turnstileToken, ip);
  if (!captchaOk) {
    return {
      ok: false,
      error: "No pude verificar el captcha. Recargá la página y probá de nuevo.",
    };
  }
  // PII processing consent (Ley 25.326 art. 14). The /login signup form
  // requires the checkbox; the /onboarding Step 1 form requires it too.
  // Either form passes consent=true; absence (e.g. legacy clients) is
  // refused. We also persist the consent record on the consentimiento
  // table further below, after the org exists.
  if (options.consent !== true) {
    return {
      ok: false,
      error: "Tenés que aceptar el aviso de privacidad para continuar.",
    };
  }

  const service = createSupabaseServiceClient();

  // 1. Crear o resolver auth.user. `wasExisting` recuerda si el user ya existía
  //    para diferenciar mensajes downstream cuando signInWithPassword falla.
  let userId: string;
  let wasExisting = false;
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message.toLowerCase().includes("already") || createErr.message.toLowerCase().includes("registered")) {
      // El user ya existe en auth.users. Buscarlo por email vía paginated
      // listUsers (M33 fix: el old code hardcodeaba perPage:200 → se rompía
      // a partir del usuario 201). Helper extraído a lib/auth (Sprint 0 T0.2).
      const existing = await findUserByEmail(service, email);
      if (!existing) {
        return {
          ok: false,
          error: "Ya existe una cuenta con este email. Iniciá sesión desde /login.",
        };
      }
      if (!existing.email_confirmed_at) {
        await service.auth.admin.updateUserById(existing.id, { email_confirm: true });
      }
      userId = existing.id;
      wasExisting = true;
    } else {
      return { ok: false, error: createErr.message };
    }
  } else {
    userId = created.user.id;
  }

  // 2. Abrir sesión cookie-based (necesaria para los siguientes Server Actions)
  const supabase = await createSupabaseServerClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // Si el user ya existía y signInWithPassword falla, lo más probable es
    // que: a) escribió mal su password vieja, b) la cuenta es de Google OAuth
    // sin password, o c) password reset pendiente. Mensaje específico para
    // que sepa qué hacer.
    if (wasExisting) {
      return {
        ok: false,
        error: "Ya existe una cuenta con este email. Iniciá sesión en /login con tu contraseña, o usá 'Olvidé mi contraseña'.",
      };
    }
    return { ok: false, error: `Cuenta creada pero no pude entrar: ${signInErr.message}` };
  }

  // 3. Bootstrap atómico vía M33 RPC.
  //
  // Reemplaza los pasos 3-6 viejos (existing-check + org insert + profile
  // upsert + member insert con DELETEs compensatorios). Garantía Postgres
  // de atomicidad real: si falla a mitad, rollback automático, no quedan
  // huérfanos.
  //
  // El pickFreshSlug local se preserva como UX optimization (slug-2, slug-3
  // en vez del random hash); la RPC tiene fallback con sufijo random para
  // race conditions de concurrencia.
  const emailBase = email.split("@")[0] || "consultorio";
  const provisionalSlug = await pickFreshSlug(service, slugifyInline(emailBase));
  const userAgent = reqHeaders.get("user-agent");

  const { data: bootstrapped, error: bootstrapErr } = await service.rpc(
    "bootstrap_org_atomic",
    {
      p_user_id: userId,
      p_email: email,
      p_provisional_slug: provisionalSlug,
      p_consent_ip: ip,
      p_consent_user_agent: userAgent,
      p_consent_legal_text_version: "v1",
    },
  );

  if (bootstrapErr || !bootstrapped) {
    return {
      ok: false,
      error: `Error inicializando consultorio: ${bootstrapErr?.message ?? "desconocido"}`,
    };
  }

  const result = bootstrapped as { organization_id: string; member_id: string; slug: string; created: boolean };
  void created;
  return { ok: true, organizationId: result.organization_id, slug: result.slug };
}

/**
 * Bootstrap del onboarding para un user que YA tiene sesión (típicamente
 * llegó por Google OAuth en /api/auth/callback). No crea ni toca password
 * — el user ya está autenticado y, si entró por OAuth, podría no tener
 * password de Supabase Auth nada más. Esta action es el equivalente a los
 * pasos 4-6 de `signUpAndInitOrganization` (crear org placeholder + profile
 * con consent + member OWNER), saltando los pasos de auth.
 *
 * Sigue requiriendo consent (Ley 25.326 art. 14) + Turnstile, porque al
 * loguearse vía Google el user no vió todavía nuestro aviso de privacidad.
 */
export async function bootstrapOrgForAuthenticatedUser(
  options: { turnstileToken?: string | null; consent?: boolean } = {},
): Promise<OnboardingBootstrapResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sesión expirada. Volvé a entrar." };
  }

  const reqHeaders = await headers();
  const ipRaw = reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? null;
  const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
  const userAgent = reqHeaders.get("user-agent");

  // Rate-limit + captcha gates (mantengo simetría con signUpAndInitOrganization).
  // 50/h por IP — alineado con signup IP cap (demos / wifi compartido).
  const limit = await limitByIp("onboarding-bootstrap", ip, 50);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Demasiados intentos. ${formatResetMessage(limit.resetIn)}`,
    };
  }
  const captchaOk = await verifyTurnstile(options.turnstileToken, ip);
  if (!captchaOk) {
    return { ok: false, error: "No pude verificar el captcha. Recargá la página." };
  }
  if (options.consent !== true) {
    return { ok: false, error: "Tenés que aceptar el aviso de privacidad para continuar." };
  }

  const service = createSupabaseServiceClient();

  // Bootstrap atómico vía M33 RPC. La función es idempotente y devuelve la
  // membership existente si el user ya tiene una — no necesitamos chequear
  // antes. Reemplaza los 3 inserts manuales + rollbacks compensatorios.
  const emailBase = (user.email ?? "consultorio").split("@")[0] || "consultorio";
  const provisionalSlug = await pickFreshSlug(service, slugifyInline(emailBase));

  const { data: bootstrapped, error: bootstrapErr } = await service.rpc(
    "bootstrap_org_atomic",
    {
      p_user_id: user.id,
      p_email: user.email ?? "",
      p_provisional_slug: provisionalSlug,
      p_consent_ip: ip,
      p_consent_user_agent: userAgent,
      p_consent_legal_text_version: "v1",
    },
  );

  if (bootstrapErr || !bootstrapped) {
    return {
      ok: false,
      error: `Error inicializando consultorio: ${bootstrapErr?.message ?? "desconocido"}`,
    };
  }

  const result = bootstrapped as { organization_id: string; member_id: string; slug: string; created: boolean };
  return { ok: true, organizationId: result.organization_id, slug: result.slug };
}

// Helper interno: pickea un slug libre buscando un sufijo numérico si está tomado.
async function pickFreshSlug(
  service: ReturnType<typeof createSupabaseServiceClient>,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug || "consultorio";
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: exists } = await service
      .from("organization")
      .select("id")
      .eq("slug", candidate)
      .is("deleted_at", null)
      .maybeSingle();
    if (!exists) return candidate;
    candidate = `${baseSlug}-${attempt + 2}`;
  }
  // Último recurso: sufijo random
  return `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper interno: slugify mínimo (sin diacritics, lowercase, alphanumeric-dashes).
// Duplicado del lib/onboarding/slug.ts a propósito para evitar import circular.
function slugifyInline(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

// ─── updateOnboardingStep: persiste delta de un step ────────────────────────

export interface StepUpdateResult {
  ok: boolean;
  error?: string;
  slug?: string;            // útil en step 3 si el user cambió el slug
}

export interface Step2Data {
  nombre: string;
  apellido: string;
  matricula?: string;
  tel?: string;
}

export interface Step3Data {
  consultorioNombre: string;
  rubro: string;
  ciudad: string;
  provincia: string;
  direccion?: string;
  direccionCompleta?: string;
  telefonoPublico?: string;
  instagram?: string;
  bio?: string;
  slugManual?: string;
}

export interface Step4Data {
  acento: string;
  /** Optional logo URL persisted by uploadOrgLogo separately. Step 4 stores it for resume. */
  logoUrl?: string | null;
  /** Visual mood of the public card. */
  cardMood?: "calido" | "clinico" | "editorial" | "boutique";
}

export interface Step5Data {
  diasActivos: string[];
  franjas: [string, string][];
  slotMin: number;
}

export interface Step6Data {
  servicios: Array<{
    nombre: string;
    dur: number;
    precioCents: number;
    tipoCanonico: string;
  }>;
}

/**
 * Persiste el delta de un step específico. El cliente llama con debounce
 * (800ms) cada vez que el user cambia un campo, para auto-save.
 *
 * También actualiza `organization.onboarding_step_max = max(actual, stepId)`
 * para que el resume state sepa hasta dónde llegó.
 */
export async function updateOnboardingStep(
  stepId: number,
  data: Step2Data | Step3Data | Step4Data | Step5Data | Step6Data,
): Promise<StepUpdateResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada. Volvé a entrar." };

  const service = createSupabaseServiceClient();

  // Buscar la org del user (creada en signUpAndInitOrganization).
  const { data: member } = await service
    .from("member")
    .select("organization_id")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member?.organization_id) {
    return { ok: false, error: "No pude resolver tu organización. Cerrá sesión y volvé a registrarte." };
  }
  const orgId = member.organization_id as string;

  try {
    switch (stepId) {
      case 2: {
        const d = data as Step2Data;
        const nombreCifrado = d.nombre ? encryptColumn(d.nombre) : null;
        const apellidoCifrado = d.apellido ? encryptColumn(d.apellido) : null;
        const profilePatch: Record<string, unknown> = {};
        if (nombreCifrado !== null) profilePatch.nombre_cifrado = nombreCifrado;
        if (apellidoCifrado !== null) profilePatch.apellido_cifrado = apellidoCifrado;
        if (d.matricula !== undefined) profilePatch.matricula = d.matricula || null;
        if (Object.keys(profilePatch).length > 0) {
          const { error } = await service.from("profile").update(profilePatch).eq("id", user.id);
          if (error) return { ok: false, error: error.message };
        }
        break;
      }
      case 3: {
        const d = data as Step3Data;
        const orgPatch: Record<string, unknown> = {};
        if (d.consultorioNombre !== undefined) orgPatch.nombre = d.consultorioNombre;
        if (d.rubro !== undefined) orgPatch.rubro = d.rubro;
        if (d.ciudad !== undefined) orgPatch.ciudad = d.ciudad;
        if (d.provincia !== undefined) orgPatch.provincia = d.provincia;
        if (d.telefonoPublico !== undefined) orgPatch.telefono_publico = d.telefonoPublico || null;
        if (d.direccionCompleta !== undefined || d.direccion !== undefined) {
          orgPatch.direccion_completa = d.direccionCompleta || d.direccion || null;
        }
        if (d.instagram !== undefined) orgPatch.instagram_handle = d.instagram || null;
        if (d.bio !== undefined) orgPatch.bio = d.bio || null;

        // Slug change: validar disponibilidad antes
        if (d.slugManual) {
          const { data: existing } = await service
            .from("organization")
            .select("id")
            .eq("slug", d.slugManual)
            .neq("id", orgId)
            .is("deleted_at", null)
            .maybeSingle();
          if (existing) {
            return { ok: false, error: "Ese link ya está tomado, elegí otro." };
          }
          orgPatch.slug = d.slugManual;
        }

        if (Object.keys(orgPatch).length > 0) {
          const { data: updated, error } = await service
            .from("organization")
            .update(orgPatch)
            .eq("id", orgId)
            .select("slug")
            .single();
          if (error) return { ok: false, error: error.message };
          return { ok: true, slug: updated.slug as string };
        }
        break;
      }
      case 4: {
        const d = data as Step4Data;
        const patch: Record<string, unknown> = {};
        if (d.acento) patch.acento_hex = d.acento;
        if (d.logoUrl !== undefined) patch.logo_url = d.logoUrl;
        if (d.cardMood) patch.card_mood = d.cardMood;
        if (Object.keys(patch).length > 0) {
          const { error } = await service
            .from("organization")
            .update(patch)
            .eq("id", orgId);
          if (error) return { ok: false, error: error.message };
        }
        break;
      }
      case 5: {
        const d = data as Step5Data;
        // Reemplazo total de disponibilidad: delete + insert
        const { data: memberSelf } = await service
          .from("member")
          .select("id")
          .eq("profile_id", user.id)
          .eq("organization_id", orgId)
          .single();
        if (!memberSelf) return { ok: false, error: "Member no encontrado." };

        await service
          .from("disponibilidad_profesional")
          .delete()
          .eq("member_id", memberSelf.id);

        const dowMap: Record<string, number> = {
          dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
        };
        const rows = d.diasActivos.flatMap((dia) =>
          d.franjas.map(([from, to]) => ({
            organization_id: orgId,
            member_id: memberSelf.id,
            dia_semana: dowMap[dia] ?? 1,
            hora_inicio: from,
            hora_fin: to,
          })),
        );
        if (rows.length > 0) {
          const { error } = await service.from("disponibilidad_profesional").insert(rows);
          if (error) return { ok: false, error: error.message };
        }
        break;
      }
      case 6: {
        const d = data as Step6Data;
        // Reemplazo total de servicios
        await service.from("servicio").delete().eq("organization_id", orgId);
        if (d.servicios.length > 0) {
          const { error } = await service.from("servicio").insert(
            d.servicios.map((s) => ({
              organization_id: orgId,
              nombre: s.nombre,
              tipo_canonico: s.tipoCanonico,
              duracion_min: s.dur,
              precio_cents: s.precioCents,
            })),
          );
          if (error) return { ok: false, error: error.message };
        }
        break;
      }
      // Steps 7-8 (integraciones): no persistimos nada acá — sus flows OAuth
      // ya escriben en `integration` cuando el user conecta.
    }

    // Actualizar onboarding_step_max si avanzó
    await service
      .from("organization")
      .update({ onboarding_step_max: stepId })
      .eq("id", orgId)
      .lt("onboarding_step_max", stepId);

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Marca el onboarding como completado. Llamada desde Step 9.
 */
export async function finalizeOnboarding(): Promise<{ ok: boolean; error?: string; slug?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const service = createSupabaseServiceClient();
  const { data: member } = await service
    .from("member")
    .select("organization_id")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member?.organization_id) return { ok: false, error: "No pude resolver tu organización." };

  const { data: org, error } = await service
    .from("organization")
    .update({
      onboarding_completed: true,
      onboarding_step_max: 9,
    })
    .eq("id", member.organization_id)
    .select("slug")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, slug: org.slug as string };
}

// ════════════════════════════════════════════════════════════════════════════
// CARD PERSONALIZATION (F3 · logo upload · M21)
// ════════════════════════════════════════════════════════════════════════════
// Server actions invoked by <LogoUpload> at Step 4. Path convention:
//   org-logos/<org_id>/logo.png  (upsert: true → re-upload overwrites)
// RLS on storage.objects ya restringe write a OWNER/DIRECTOR; el server
// usa service_role para saltar RLS porque la auth ya fue validada por
// `getUser()` y la pertenencia se chequea contra `member` antes del upload.

import {
  LOGO_BUCKET,
  LOGO_MAX_BYTES,
  buildLogoPath,
  buildLogoPublicUrl,
} from "@/lib/storage/logos";

export interface UploadOrgLogoResult {
  ok: boolean;
  error?: string;
  logoUrl?: string;
}

/**
 * Sube un PNG de logo del consultorio. Recibe FormData (campo "file")
 * para que la transferencia no pase por base64 + JSON.
 */
export async function uploadOrgLogo(formData: FormData): Promise<UploadOrgLogoResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No recibimos un archivo." };
  }
  if (file.type !== "image/png") {
    return { ok: false, error: "Solo aceptamos PNG." };
  }
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "El logo supera los 500 KB." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada. Volvé a entrar." };

  const service = createSupabaseServiceClient();
  const { data: member } = await service
    .from("member")
    .select("organization_id")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member?.organization_id) {
    return { ok: false, error: "No pude resolver tu organización." };
  }
  const orgId = member.organization_id as string;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = buildLogoPath(orgId);

  const { error: upErr } = await service.storage.from(LOGO_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "no-cache",
  });
  if (upErr) return { ok: false, error: `Error subiendo logo: ${upErr.message}` };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const cacheBust = Date.now();
  const logoUrl = `${buildLogoPublicUrl({ supabaseUrl, orgId })}?v=${cacheBust}`;

  const { error: dbErr } = await service
    .from("organization")
    .update({ logo_url: logoUrl })
    .eq("id", orgId);
  if (dbErr) return { ok: false, error: `Error guardando logo_url: ${dbErr.message}` };

  return { ok: true, logoUrl };
}

export interface RemoveOrgLogoResult {
  ok: boolean;
  error?: string;
}

/**
 * Borra el logo del bucket y limpia organization.logo_url. Idempotente:
 * si no había logo, no falla.
 */
export async function removeOrgLogo(): Promise<RemoveOrgLogoResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const service = createSupabaseServiceClient();
  const { data: member } = await service
    .from("member")
    .select("organization_id")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member?.organization_id) {
    return { ok: false, error: "No pude resolver tu organización." };
  }
  const orgId = member.organization_id as string;

  const path = buildLogoPath(orgId);
  const { error: rmErr } = await service.storage.from(LOGO_BUCKET).remove([path]);
  if (rmErr && !/not.?found/i.test(rmErr.message)) {
    return { ok: false, error: rmErr.message };
  }

  await service.from("organization").update({ logo_url: null }).eq("id", orgId);
  return { ok: true };
}
