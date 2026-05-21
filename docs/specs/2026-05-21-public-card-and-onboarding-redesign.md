# Folio · Public card + onboarding redesign

> Subir la card pública del profesional (la que comparte en su historia, la que ven los pacientes en `/book/[slug]`) de "form output" a **producto premium personalizable**. Misma data model en base, capas opt-in de personalidad.
>
> **Fecha**: 2026-05-21
> **Status**: spec drafted, awaiting founder review

---

## 1. Context

Feedback del founder:
> "Se siente muy tipo formulario. Todo el onboarding también. La idea me parece perfecta — quiero un mejor design, más personalidad, premium."

Diagnóstico actual:

- `components/onboarding/card-preview.tsx` (`CardPreview`) tiene buenos huesos pero: densidad sin respiro, jerarquía plana, genérica (toda card de Folio se parece, solo cambia `acento_hex`), sin "momento" cinematográfico al entrar.
- `/book/[slug]` (lo que ve el paciente) **NO usa CardPreview**. `BookingWizard` tiene un header inline plano (líneas 172-178): rubro uppercase + nombre + ubicación. Esa es la first impression del producto para cada paciente que entra al link. Hoy es plana.
- No hay sistema de personalización más allá del `acento_hex`. Cada card de Folio es esencialmente la misma con un tinte distinto.

## 2. Goals

1. **Card premium baseline (Layer A)**: cualquier profesional con datos mínimos recibe una card en tier "producto bien diseñado", no "form output".
2. **Personalización opt-in**:
   - **Mood selector (Layer B)** — 4 estilos visuales curados que diferencian profesional a profesional.
   - **Logo upload (Layer D)** — PNG con transparencia, sustituye avatar de iniciales en el hero.
3. **Card unificada**: misma component sirve en onboarding (live preview + step 9 reveal), `/configuracion`, y `/book/[slug]`. Hoy `/book/[slug]` no la usa — eso se arregla acá.
4. **Reduce-motion compliant**: como toda Folio.

## 3. Non-goals

- Foto upload del profesional o consultorio (deferred a v2).
- Reescribir el booking wizard completo (solo cambia su header: lo reemplaza con `PublicCard`).
- Cambiar el data model más allá de 2 campos nuevos (`logo_url`, `card_mood`).
- Soportar formatos de imagen distintos a PNG (SVG/WebP/JPEG fuera de scope).
- Diseño de la card "interna" del app (sidebar avatar dentro de `/hoy`, etc.). Out of scope.

## 4. Arquitectura: las tres capas

```
[A foundation] — chassis visual común (proporciones, espaciado, tipografía, motion)
       ↓
[B mood preset] — voz visual elegida por el pro (tipo secundaria, paleta, densidad, decoración)
       ↓
[D logo opcional] — brand mark en hero, reemplaza avatar de iniciales si existe
       ↓
= Card pública renderizada
```

Componente nuevo: `<PublicCard>` reemplaza `<CardPreview>`. Se ubica en `components/public-card/public-card.tsx`. Los 3 variants actuales (`preview`, `full`, `editing`) se mantienen.

## 5. Layer A — Foundation refactor

Cambios visuales sin nuevos datos:

| Aspecto | Cambio |
|---|---|
| Hero | Asimétrico 60/40. Logo/avatar grande izquierda; nombre + rubro + ciudad derecha con generous whitespace |
| Nombre | Geist 28-36px (responsive), weight 600, letter-spacing -0.018em (sin introducir display font nuevo — respetamos el system) |
| Bio | Pull-quote: left border accent, line-height 1.5, font-size 15px, generoso padding-left. NO como párrafo de form |
| Contacto | Grid 2-col en desktop (dirección + tel arriba; instagram + horario opcional abajo). Stack en mobile |
| Servicios | Mini-cards (no lista bullets). Cada servicio: nombre + chip duración + precio prominente. Hover state sutil |
| CTA | "Reservar turno" botón con peso, sombra direccional consistente con light source top-left, micro-interaction al hover |
| Motion entry | Stagger no-uniforme (logo → nombre → bio → contacto → servicios → CTA), 600-1000ms total. Reduce-motion compliant |
| Link footer | `folio-app.../book/<slug>` mono pequeño, opacity 0.5 |

Reglas heredadas del motion design language v2 (folio.css `--ease-*`, `--dur-*`): cero `cubic-bezier(...)` raw nuevos.

## 6. Layer B — Mood preset system

Cuatro moods curados. Cada mood = objeto de tokens override sobre A:

```ts
interface MoodTokens {
  id: 'calido' | 'clinico' | 'editorial' | 'boutique';
  displayName: string;
  tagline: string;                                          // mostrado en mood picker
  nameWeight: 500 | 600 | 700;
  nameLetterSpacing: string;
  bioStyle: 'plain' | 'italic-serif' | 'quote-with-rule';
  acentoBlend: { color: string; amount: number };           // mezcla con --accent del pro
  bgTexture: 'flat' | 'gradient-soft' | 'gradient-radial' | 'paper-noise';
  heroPaddingY: number;
  cardRadius: 12 | 16 | 20 | 24;
  decoration: 'none' | 'sub-line' | 'corner-mark' | 'date-badge';
}
```

| Mood | Tagline | Vibe |
|---|---|---|
| **Cálido** | "Cercano y humano" | warm acento blend, gradient soft, weight 500, bio italic-serif, corner-mark con un círculo soft acento, radius 16 |
| **Clínico** | "Preciso y profesional" | flat surface, weight 700, mono dominante en data, decoration none, radius 12 (más sharp) |
| **Editorial** | "Refinado y selecto" | gradient radial sutil, weight 600, bio quote-with-rule, sub-line decorativa, radius 20 (default mood) |
| **Boutique** | "Personal y curado" | paper-noise sutil, weight 600, bio italic-serif, date-badge decorativo, radius 24 |

Default cuando un pro no elige: `editorial`. Mood se persiste en `organization.card_mood`.

## 7. Layer D — Logo upload

### Storage
- Bucket Supabase Storage: `org-logos`
- RLS: org owner puede write (upload + delete). Public read.
- Path: `<org_id>/logo.png`
- Re-upload sobrescribe (mismo path).

### DB
- Nueva columna: `organization.logo_url text NULL`
- Migration M21 (ver §10).

### Upload UX
- Drop zone + click to browse.
- Validaciones: PNG only, max 500KB, recomendado ≥512×512.
- Preview inmediato dentro del drop zone.
- Botón "Saltar — usar mis iniciales" para continuar sin logo.
- Helper inline: "Mejor con fondo transparente y formato cuadrado".

### Render en card
- Si `logo_url` existe → `<img>` en hero zone, tamaño 80px (preview) / 120px (full), `object-fit: contain`, sobre un gradient soft del acento.
- Si no → `AvatarIniciales` con misma proporción (componente actual, sin cambios).
- Transición suave entre estados via opacity al volver a la card después de subir.

### Sin processing server-side
- No Sharp ni resize automático. PNG con alpha = renderea OK en surface clara y dark mode.
- Si el pro sube logo con mucho border vacío, no compensamos — su responsabilidad. El helper inline lo aclara.

## 8. Onboarding integration

Hoy son 9 pasos. Inserto **un step nuevo** entre los actuales (concretamente entre el "nombre/apellido/matrícula" y el "consultorio + ciudad"):

- **Step nuevo · "Tu identidad visual"**:
  - Logo upload (skippable)
  - Mood picker: 4 cards visualmente representativas (preview del mood aplicado al avatar/nombre del pro)
  - Live preview a la derecha (sticky) muestra el cambio inmediato

Se mantiene 9 steps totales por flujo narrativo del onboarding — uno de los actuales se combina con éste, o desplazamos numeración. Decisión a tomar en plan de implementación.

Step 9 ("the moment", reveal final): sigue conceptualmente igual, pero la card revealed ya tiene mood + logo aplicados.

## 9. Integration en `/book/[slug]`

Hoy `BookingWizard` (líneas 172-178) tiene un header inline plano. Se reemplaza:

```
┌────────────────────────────────┐
│  <PublicCard variant="full" /> │  ← card hero (logo + nombre + mood)
└────────────────────────────────┘
┌────────────────────────────────┐
│  Booking flow (3 steps)         │  ← intacto
└────────────────────────────────┘
```

En mobile (<768px), la card colapsa al hacer scroll y queda un mini header sticky con logo/iniciales + nombre + CTA "Reservar". Eso preserva contexto sin robar viewport.

## 10. Data model changes

Migration **M21 · card personalization**:

```sql
-- supabase/migrations/20260521000021_M21_card_personalization.sql
ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS logo_url text NULL,
  ADD COLUMN IF NOT EXISTS card_mood text NOT NULL DEFAULT 'editorial'
    CHECK (card_mood IN ('calido','clinico','editorial','boutique'));

COMMENT ON COLUMN organization.logo_url IS
  'URL pública del logo PNG del consultorio (Supabase Storage). NULL → renderea avatar iniciales.';
COMMENT ON COLUMN organization.card_mood IS
  'Estilo visual elegido por el pro para su card pública.';
```

Storage bucket `org-logos` se crea via migration o via dashboard manual + RLS policy.

## 11. Component / file layout

| Path | Acción |
|---|---|
| `components/public-card/public-card.tsx` | NEW. Reemplaza `CardPreview`. Implementa A + B + D. |
| `components/public-card/moods.ts` | NEW. Definitions de los 4 moods + `applyMood(tokens)` helper |
| `components/public-card/logo-upload.tsx` | NEW. Drop zone + validation + upload a Storage |
| `components/public-card/avatar-fallback.tsx` | NEW (extracción del actual `avatar-iniciales`). Sin cambios funcionales. |
| `components/onboarding/card-preview.tsx` | DELETE. Re-exports a `PublicCard` por compatibilidad temporal mientras se migra el resto. |
| `components/booking/booking-wizard.tsx` | UPDATE. Reemplazar header inline líneas 172-178 con `<PublicCard variant="full" />` |
| `app/(public)/onboarding/page.tsx` + `actions.ts` | UPDATE. Agregar step "identidad visual" + acciones de persist logo_url/card_mood |
| `supabase/migrations/20260521000021_M21_card_personalization.sql` | NEW |
| `public/folio.css` | Agregar bloque `.pc-*` (public-card) + cleanup `.card-preview-*` viejo al final |
| `lib/storage.ts` | NEW (o si ya hay un módulo, agregar). Helpers para upload + URL público de logos |

## 12. Acceptance criteria

- [ ] `/book/[slug]` renderea `<PublicCard variant="full" />` como hero antes del booking wizard
- [ ] Logo PNG con transparencia sube exitoso, persiste, re-upload lo sobrescribe
- [ ] Mood picker en onboarding persiste en DB, se refleja en live preview, sobrevive recarga
- [ ] Cada mood se ve distinguible al ojo de alguien sin contexto (test: dos screenshots A/B de mood Cálido vs Clínico — no se confunden)
- [ ] Sin logo, fallback `AvatarIniciales` se renderea con calidad elite (no se ve "missing image")
- [ ] Reduce-motion: card entra sin stagger, sin scale, sin blur. Estado final inmediato.
- [ ] Mobile responsive: en `/book/[slug]` la card colapsa, sticky mini header funciona
- [ ] `pnpm typecheck && pnpm lint && pnpm build` verde
- [ ] Bundle First Load `/book/[slug]` < 250 KB
- [ ] Bundle First Load `/onboarding` < 275 KB
- [ ] No quedan referencias al import de `CardPreview` después del cleanup

## 13. Implementation phases (high-level)

Cada fase se planifica en detalle en el **implementation plan** que sigue a este spec (vía `superpowers:writing-plans`).

| Fase | Scope |
|---|---|
| **F1 · Data foundation** | Migration M21 + Supabase Storage bucket `org-logos` con RLS + helper `lib/storage.ts` |
| **F2 · Logo upload** | Component `logo-upload.tsx` + integration en onboarding placeholder + verificación E2E del flow |
| **F3 · Public card foundation (A)** | `PublicCard` component nuevo, mood 'editorial' default, reemplaza `CardPreview` en onboarding live preview |
| **F4 · Mood system (B)** | `moods.ts` + 4 moods implementados + mood picker UI + persistencia |
| **F5 · Onboarding step "identidad visual"** | Nuevo step en onboarding que combina logo + mood |
| **F6 · `/book/[slug]` integration** | Reemplazar header inline de `BookingWizard` con `<PublicCard variant="full" />` + sticky mini header mobile |
| **F7 · Verification + ship** | Acceptance criteria pass + delete `CardPreview` + cleanup CSS viejo |

## 14. Open decisions (para resolver en plan)

1. **¿4 moods finales o testeamos con 2 primero (Cálido + Clínico)?** — mood Editorial + Boutique podrían ser v2. Argumento por 2 primero: ship más rápido, learn from real use. Argumento por 4: hay más differentiation desde día 1.
2. **Mood picker UI: grid 2x2 o slider horizontal?** — Grid es más scanneable; slider tiene swipe en mobile.
3. **Logo: ¿permitimos SVG además de PNG?** — SVG es más liviano y crisp, pero requiere sanitización contra XSS. Default NO; reconsiderar si los pros lo piden.
4. **Onboarding: ¿el nuevo step "identidad visual" suma a 10 totales o reemplaza/combina con uno existente para mantener 9?** — afecta el copy de la barra de progreso.
5. **¿Pre-mood en onboarding?** — un mini quiz tipo "¿cómo describirías tu práctica?" que auto-suggest un mood (con override). Mejora UX pero agrega complejidad. Default NO; v2.

---

## Self-review checklist

- [x] Placeholders: cero "TBD" o "TODO" sin asignar — todas las decisiones tienen un default propuesto
- [x] Internal consistency: §4 arquitectura coincide con §11 component layout
- [x] Scope check: scope acotado a card + onboarding step + booking page integration. Fuera: foto upload, booking wizard rewrite, sidebar app card
- [x] Ambiguity check: las 5 open decisions en §14 son los puntos donde dos interpretaciones razonables existen — explícitas
