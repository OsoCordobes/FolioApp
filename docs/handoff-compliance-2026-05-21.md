# Handoff · Compliance audit remediation
## Two-agent split · 2026-05-21

Two parallel Claude sessions are working on the legal compliance remediation:

- **Session A · Compliance backend** (this file authored by). Branch: `claude/folio-legal-compliance-audit-4JV32`. Scope: terms, privacy, cookies, data layer, server actions, migrations, ARCO endpoints, breach SOP. Touches no UI/visual code.
- **Session B · Visual flows & functionalities**. Scope: booking wizard UI (consent checkbox, PHI warning), EliminarCuentaButton wiring, MFA UI, Configuración → Privacidad UI, cookie banner UI, onboarding consent UI. Pixel-perfect / styling concerns.

Both sessions edit the same branch. Each PR must reference this handoff and the section it consumes/produces.

---

## Communication protocol

1. Each session updates the **Status table** below at the start and end of every work block.
2. Cross-session questions go under **Open questions for the other agent** — answer by editing the same section, then ping in your reply.
3. **Contracts** (server actions, endpoints, DB columns) are the source of truth. If you change one, update the contract section here in the same commit.
4. Never modify files explicitly owned by the other session without a note here first.

---

## Status

| Item | Owner | Status | Notes |
|---|---|---|---|
| M22 migration (audit triggers, sesion lock USING, pedido consent columns, audit purge, pseudonimizar_member) | A | **DONE** | `supabase/migrations/20260521000022_M22_compliance_hardening.sql` |
| Privacy policy rewrite | A | **DONE** | `app/(public)/privacidad/page.tsx`. Exports `PRIVACY_VERSION = "2026-05-21"`. |
| Terms rewrite (DPA roles, breach commitment, retention) | A | **DONE** | `app/(public)/terminos/page.tsx`. Exports `TERMS_VERSION = "2026-05-21"`. |
| Cookie policy page `/cookies` | A | **DONE** | `app/(public)/cookies/page.tsx`. Exports `COOKIES_VERSION = "2026-05-21"`. |
| Booking server action: accept `consent_aceptado_en` + IP + UA + version | A | **DONE** | `app/(public)/book/[slug]/actions.ts::createPedidoPublico`. Fields are optional at TS layer (to avoid breaking build before B wires UI) but runtime-rejected if missing. DB constraint `pedido_web_requires_consent` is the final fail-safe. |
| `/api/me/export` (ARCO Access JSON dump) | A | **DONE** | `app/api/me/export/route.ts`. Logs `profile.export` to audit_log. |
| `eliminarCuentaAction` + `previewEliminarCuentaAction` server action (calls `pseudonimizar_member`) | A | **DONE** | `app/(app)/configuracion/actions.ts`. Validates emailConfirmacion vs session email + motivo >=20 chars. |
| `docs/incident-response.md` breach SOP | A | **DONE** | `docs/incident-response.md` |
| Booking wizard UI: consent checkbox + PHI warning under "motivo" | **B** | TODO | Consume contract C1 below. Build is currently green because A made consent fields TS-optional; you must still pass them. |
| EliminarCuentaButton: wire to `eliminarCuentaAction` | **B** | TODO | Consume contract C2 below |
| MFA UI (Activar MFA button) | **B** | — | Out of scope for this audit unless B has bandwidth |
| Cookie banner UI (if added) | **B** | — | Optional — strict-necessary cookies don't legally require a banner per `/cookies` §3 |
| Configuración → Privacidad section UI (opt-out analytics toggle, "Descargar mis datos" button calling `/api/me/export`) | **B** | TODO | Consume contract C3 below |
| Onboarding consent UI (checkbox accepting Privacy + Terms at signup) | **B** | TODO | If you want server-side persistence, ping A — needs a new `profile.consent_version_accepted` column |

---

## Contracts (Session A → Session B)

### C1 · Booking consent — server side (READY ✓)

`createPedidoPublico` in `app/(public)/book/[slug]/actions.ts` accepts these new fields on its Zod input schema:

```ts
{
  // ... existing fields
  consentAccepted?: boolean,           // optional at TS layer, but server returns err("validation", "Para reservar debés aceptar...") if not true
  consentVersion?: string,              // pass PRIVACY_VERSION imported from app/(public)/privacidad/page.tsx
}
```

The server records `consent_aceptado_en = now()`, `consent_ip = <client IP from headers>`, `consent_user_agent = <UA>`, `consent_version = input.consentVersion` on the pedido row. The DB constraint `pedido_web_requires_consent` (M22) rejects WEB pedidos without `consent_aceptado_en` set — defense-in-depth.

**Session B action:** in `components/booking/booking-wizard.tsx`:
1. `import { PRIVACY_VERSION } from "@/app/(public)/privacidad/page.tsx";` (and `TERMS_VERSION` from terminos page if you want to show both)
2. Add `const [consentAccepted, setConsentAccepted] = useState(false);`
3. Disable the submit button while `!consentAccepted`
4. Add a required checkbox right above the submit button. Suggested label: "Acepto la [Política de Privacidad](/privacidad) y los [Términos](/terminos) y autorizo a Folio a procesar mis datos para responder a esta solicitud de turno."
5. Add a help text under the "Motivo" textarea: "Por favor no incluya diagnósticos ni información clínica detallada."
6. Pass `consentAccepted` + `consentVersion: PRIVACY_VERSION` to `createPedidoPublico`.

### C2 · Account deletion (READY ✓)

Two server actions in `app/(app)/configuracion/actions.ts`:

```ts
eliminarCuentaAction({ motivo: string; emailConfirmacion: string }): Promise<Result<void>>
previewEliminarCuentaAction(): Promise<Result<{ memberships: number }>>
```

`eliminarCuentaAction` validates `motivo.length >= 20`, `emailConfirmacion === session.email`, calls `pseudonimizar_member(motivo, dry_run=false)`, then `supabase.auth.signOut()`. Returns `ok: true` on success.

`previewEliminarCuentaAction` calls the same SQL with `dry_run=true` and returns a count of memberships that will be soft-deleted. Use this to show the user a confirmation dialog with real impact data instead of guessing.

**Session B action:** rewrite `EliminarCuentaButton` (`components/configuracion/configuracion.tsx` ~L231) to:
1. Optionally call `previewEliminarCuentaAction` on click to show a confirmation modal with `memberships` count.
2. Collect `motivo` (textarea, >=20 chars) and `emailConfirmacion` (typed by the user, must match their session email).
3. Call `eliminarCuentaAction({ motivo, emailConfirmacion })`.
4. On `result.ok`, redirect to `/login?cuenta_eliminada=1` (the login page can show a "Tu cuenta fue eliminada" banner). Replace the existing `prompt()` + `alert()` stubs.

### C3 · Data export (READY ✓)

`GET /api/me/export` (authenticated) returns a JSON blob:

```jsonc
{
  "ok": true,
  "exported_at": "2026-05-21T...",
  "ley_25326_basis": "art. 14 (derecho de acceso) — art. 16 (portabilidad implícita)",
  "privacy_policy_version": "2026-05-21",
  "profile": { /* PII decrypted (nombre, apellido) */ },
  "memberships": [...],
  "integraciones": [...],            // sin tokens
  "suscripciones": [...],
  "notas": [...]
}
```

Returns 401 if no session, 404 if profile not found. The response is forced to download via `Content-Disposition: attachment` with filename `folio-export-<id8>-<YYYY-MM-DD>.json`. Logs an `audit_log` entry `profile.export`.

**Session B action:** in `Configuración → Privacidad`, add a "Descargar mis datos" button. Easiest implementation:
```ts
<a href="/api/me/export" download className="fi-btn fi-btn-secondary">Descargar mis datos</a>
```
The `Content-Disposition` header already triggers the download.

### C4 · Cookie policy page (READY ✓)

Route `/cookies` (linked from `/privacidad` §6 and `/cookies` itself). Pure content page; no banner is required for strict-necessary cookies under AAIP guidance, as documented in `/cookies` §3.

**Session B action:** no required work. If you decide to add a cookie banner anyway (e.g., for analytics opt-in), wire it to set `folio.cookies_accepted=<version>` and respect Do-Not-Track. PostHog already respects DNT and has session replay disabled.

---

## Files Session A will modify (do not edit in parallel)

- `app/(public)/privacidad/page.tsx`
- `app/(public)/terminos/page.tsx`
- `app/(public)/cookies/page.tsx` (new)
- `app/(public)/book/[slug]/actions.ts` (server action only — wizard UI is B)
- `app/(app)/configuracion/actions.ts`
- `app/api/me/export/route.ts` (new)
- `supabase/migrations/20260521000022_M22_compliance_hardening.sql`
- `docs/incident-response.md` (new)
- `docs/handoff-compliance-2026-05-21.md` (this file)

## Files Session B will modify (do not edit in parallel)

- `components/booking/booking-wizard.tsx`
- `components/configuracion/configuracion.tsx`
- Any new components in `components/cookies/`, `components/configuracion/privacidad/`, etc.
- `app/(app)/configuracion/page.tsx` only for adding a new "Privacidad" section that consumes A's actions

---

## Open questions for the other agent

*(Session A → B: leave answers inline.)*

1. **Q (A → B):** Do you want to add an onboarding consent checkbox at signup? If yes, ping here and I'll add a `profile.consent_version_accepted` column + persist on signup. Otherwise, signup is treated as implicit acceptance (which is legally weaker but common at MVP).
2. **Q (A → B):** Should `eliminarCuentaAction` redirect to a new `/cuenta-eliminada` confirmation page, or to `/login` with a query param? I'll wire whatever you prefer.
3. **Q (A → B):** Cookie banner — want one? My recommendation: no banner needed legally for strict-necessary cookies; just keep `/cookies` page. If you disagree, ping.

*(Session B → A: leave questions here, A will reply by editing this section.)*

---

## Done definition

- All TODOs above marked DONE.
- All contracts (C1–C4) implemented on both sides and end-to-end exercised manually.
- PR description references this handoff.
- Privacy policy version (`PRIVACY_VERSION`) is `2026-05-21` and is the value persisted on the first WEB pedido after deploy.
