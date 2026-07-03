/**
 * Folio · classifySignUpOutcome — clasificación pura del resultado de
 * `supabase.auth.signUp` (ítem 1.5 · verificación de email adaptativa).
 *
 * GoTrue responde distinto según el toggle "Confirm email" del dashboard:
 *
 *   - Confirm OFF (estado actual de prod): signUp de un email nuevo devuelve
 *     `user` + `session` (autoconfirm). Email existente → error
 *     "User already registered".
 *   - Confirm ON (cuando F0.6 lo active): signUp devuelve `user` SIN
 *     `session` (hay que confirmar por email). Si el email ya existe
 *     confirmado, GoTrue devuelve un user OFUSCADO con `identities: []`
 *     (anti-enumeración de GoTrue) — lo detectamos vía `maybeExisting`.
 *
 * Esta función es lógica pura (sin I/O) para poder testearla con node:test
 * sin mocks de Supabase. El caller (signUpAndInitOrganization) decide qué
 * hacer con cada outcome.
 */

export type SignUpOutcome =
  | { kind: "session" }
  | { kind: "needs_confirmation"; maybeExisting: boolean }
  | { kind: "existing_try_password" }
  | { kind: "error"; message: string };

export interface SignUpResponseShape {
  error: { message: string } | null;
  user: { identities?: unknown[] | null } | null;
  session: unknown | null;
}

export function classifySignUpOutcome(input: SignUpResponseShape): SignUpOutcome {
  if (input.error) {
    // "User already registered" (confirm OFF + email existente). Cubrimos
    // también variantes con "already"/"registered" sueltos, como hacía el
    // viejo branch de admin.createUser.
    if (/already|registered/i.test(input.error.message)) {
      return { kind: "existing_try_password" };
    }
    return { kind: "error", message: input.error.message };
  }
  if (input.session) {
    return { kind: "session" };
  }
  if (input.user) {
    // user sin session ⇒ confirm ON. `identities: []` (array vacío) es la
    // señal de GoTrue de "email ya registrado y confirmado" (user ofuscado);
    // un signup fresco trae al menos la identity "email".
    return {
      kind: "needs_confirmation",
      maybeExisting: Array.isArray(input.user.identities) && input.user.identities.length === 0,
    };
  }
  // Ni error, ni session, ni user: respuesta inesperada de GoTrue.
  return { kind: "error", message: "No pudimos completar el registro. Probá de nuevo." };
}
