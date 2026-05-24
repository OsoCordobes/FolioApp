# CSP audit pre-flip · 2026-05-24

Análisis previo al flip de `Content-Security-Policy-Report-Only` → enforcing
(Sprint 0 Task 0.8.3). Cubre los hallazgos de Task 0.8.1 (Sentry violations
review) y Task 0.8.2 (grep manual del repo).

---

## Task 0.8.1 · Sentry violations review

**Hallazgo crítico:** `next.config.ts` históricamente seteó
`Content-Security-Policy-Report-Only` **sin** una directiva `report-uri` /
`report-to`. Esto significa que durante todo el período de Report-Only los
navegadores **detectaban violaciones** pero **no las reportaban a ningún
servidor** — Sentry nunca ingestó CSP reports.

Implicancia: no se puede consultar Sentry retrospectivamente. La auditoría
asumió que había data ahí; la realidad es que el wiring nunca existió.

**Acción compensatoria:** análisis estático del código (Task 0.8.2 abajo) +
smoke manual exhaustivo en cada ruta crítica con DevTools Console + deploy
preview con repeat smoke. Si tras flip aparecen violaciones legítimas en
producción, rollback < 5 min vía Vercel "Promote previous deployment".

**Acción de mejora (Task 0.8.3):** agregar `report-uri` apuntando al
endpoint built-in de Sentry para que futuros ajustes de CSP tengan data
disponible.

---

## Task 0.8.2 · Grep manual de origenes externos

### Comandos ejecutados

```bash
# Inline HTML injections
grep -r "dangerouslySetInnerHTML" app/ components/   # → 0 matches
grep -rE "on(load|click|error|change)=\"" app/        # → 0 matches (inline handlers)

# URLs externas hardcoded en app/, components/, lib/
grep -rE "https://[a-zA-Z0-9.-]+" app/ components/ lib/
```

### Inventario de origenes externos detectados

| Origen | Sitio de uso | Tipo | CSP cobertura |
|---|---|---|---|
| `https://fonts.googleapis.com` | `app/layout.tsx:43,46` preconnect+stylesheet | browser fetch | ✓ `style-src` + preconnect típicamente bajo `connect-src` — agregar por seguridad |
| `https://fonts.gstatic.com` | `app/layout.tsx:44` preconnect | browser fetch | ✓ `font-src` — preconnect también puede ir bajo `connect-src` |
| `https://challenges.cloudflare.com/turnstile/v0/api.js` | `components/auth/login-form.tsx`, `components/booking/booking-wizard.tsx`, `components/onboarding/step1-{consent,registro}.tsx` | `<Script>` tag | ✓ `script-src` + `frame-src` |
| `https://us.i.posthog.com` (NEXT_PUBLIC_POSTHOG_HOST default) | `lib/observability/posthog-client.tsx:18` | browser fetch | ✓ `connect-src https://*.posthog.com` matchea (CSP L3 spec: `*` matches one or more labels) |
| `https://www.argentina.gob.ar/aaip` | `app/(public)/privacidad/page.tsx:182` | `<a target="_blank">` navegación | N/A — los `<a>` no aplican CSP (solo `connect-src` para fetch) |
| `https://wa.me/<num>` | varios componentes | `<a href>` y `window.open` | N/A — navegación |
| `https://instagram.com/<handle>` | `components/public-card/public-card.tsx:175` | `<a href>` | N/A — navegación |
| `https://folio-app-ten.vercel.app` | `components/configuracion/configuracion.tsx:305`, `components/onboarding/step9-moment.tsx:49` | string magic (fallback de `window.location.origin`) | N/A — no es URL fetcheada |
| `https://www.googleapis.com/auth/calendar.events` | `app/api/google/callback/route.ts:73`, `lib/google/oauth.ts:14,15,22` | OAuth scope string + server-side | N/A — server-side (CSP no aplica) |
| `https://graph.facebook.com/<v>` | `lib/whatsapp/client.ts:18` | server-side fetch | N/A — server-side |
| `https://api.mercadopago.com` | `lib/mercadopago/client.ts:20` | server-side fetch | ✓ `connect-src` redundante pero queda |
| `https://wsaa*.afip.gov.ar`, `https://servicios*.afip.gov.ar`, `https://wswhomo.afip.gov.ar` | `lib/afip/wsfev1.ts` | server-side SOAP | N/A — server-side |

### Diff CSP vs realidad

La CSP actual (next.config.ts:27-40) **cubre** todos los origenes browser-side
detectados, con dos posibles edge cases a mitigar antes del flip:

1. **`<link rel="preconnect">` a Google Fonts**: en CSP L3 estricto, preconnect
   se gatea bajo `connect-src`. Actualmente no está. Riesgo bajo (preconnect
   sin destino no falla la carga; el stylesheet sí carga vía `style-src`),
   pero conviene agregar para evitar warning en console.

2. **`'unsafe-eval'` en script-src**: Next 15 con Turbopack en prod **no**
   requiere eval(). Sacarlo reduce surface XSS. Verificado: bundle build
   produce `__webpack_require__` style sin `eval()`.

### Cambios a aplicar en Task 0.8.3

1. Remover `'unsafe-eval'` del `script-src`.
2. Agregar `https://fonts.googleapis.com` y `https://fonts.gstatic.com` al
   `connect-src` (cobertura del preconnect).
3. Flip `Content-Security-Policy-Report-Only` → `Content-Security-Policy`.
4. Agregar `report-uri` al endpoint built-in de Sentry para data futura.
5. Mantener `'unsafe-inline'` en script-src + style-src (Next 15 inyecta
   bootstrap script inline; nonce-based CSP es Sprint 3+).

### Verificación pre-deploy

```bash
pnpm build && pnpm start
# Browser, DevTools Console abierta, validar 0 violaciones CSP en:
# /  ·  /login  ·  /onboarding  ·  /hoy  ·  /calendario
# /focus/[id]  ·  /pacientes  ·  /pacientes/[id]
# /configuracion  ·  /finanzas  ·  /book/<slug-real>
# /privacidad  ·  /terminos  ·  /reset-password
```

### Verificación deploy preview

Tras push de Sprint 0, Vercel auto-deploya un preview URL. Re-correr el
smoke en cada ruta sobre el preview URL. Si aparece violación, anotarla
acá y revertir el flip antes del merge a master.
