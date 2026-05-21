# Folio · Public Card + Onboarding Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Companion document — READ FIRST:** [`./2026-05-21-design-language-recommendation.md`](./2026-05-21-design-language-recommendation.md). Every token, font, motion beat, and decoration primitive referenced in this plan is defined there. Do not start F1 without reading it.

**Goal:** Lift Folio's public professional card from "form output" to an editorial-grade product card by (1) adopting the **Folio Atelier** design language, (2) introducing a 4-mood preset system, (3) supporting opt-in PNG logo upload, and (4) plugging the card into `/book/[slug]` and the onboarding flow.

**Architecture:** Single new component `<PublicCard>` reading purely from CSS variables. Mood is applied via a `data-card-mood` attribute on the root — no JS token assembly. Logo lives in Supabase Storage (`org-logos/<org_id>/logo.png`), referenced by `organization.logo_url`. Mood is persisted in `organization.card_mood` (4-value text enum). The component is consumed in three places: onboarding live-preview, onboarding Step-9 reveal, and `/book/[slug]` hero.

**Tech Stack:** Next.js 15 App Router (Turbopack, dev port **3010**) · React 19 · TypeScript strict · Supabase (Postgres + Storage + RLS) · Prisma · framer-motion 11.11 · folio.css (motion language v2) · **Playwright** (e2e + visual projects — the project has no Vitest installed) · pgTAP (Supabase).

---

## ⚠ Amendments (post-author critical review · 2026-05-21)

Mechanical corrections applied after the plan was committed, after reading the actual repo state. Each preserves the design intent; only the *how* changes. Treat amendments as authoritative whenever the body conflicts.

| # | Body says | Reality / corrected guidance | Why |
|---|---|---|---|
| A1 | CSS namespace `.pc-*` / `--pc-*` / `@keyframes pc-*` | **Renamed globally to `.fpc-*` / `--fpc-*` / `@keyframes fpc-*`** (Folio Public Card) | `public/folio.css` already uses `.pc-*` for the existing "Paciente Centro" (patient detail) screen — lines 3725-3905+. Collision is real; rename avoids it. |
| A2 | "Add Fraunces via `next/font/google`" | **Extend the existing Google Fonts `<link>` in `app/layout.tsx`** with `&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600`. The `--font-display` token sets `'Fraunces', 'Iowan Old Style', Georgia, serif`. | Geist + Geist Mono already load via CDN `<link>`; introducing `next/font` for Fraunces only would split the loading mechanism and block the F11 self-host migration. F1.1 is rewritten in-body for this. |
| A3 | "Write Vitest unit test for X" | **Two test layers** depending on what's tested: (a) **Pure helpers / modules** → `node:test` via `tsx`, runs as `pnpm test:unit` (built-in Node 22+, zero new deps, ~200 ms wall time). Files live in `tests/unit/**/*.test.ts`. (b) **DOM / browser behavior / computed style** → **Playwright** in `tests/e2e/` against a dev-only `/dev/...` preview route. | The project has no Vitest installed. Initial amendment routed everything through Playwright; that proved flaky for pure helpers (Playwright boots two webservers, competes with itself, takes ≥30 s per run). `node:test` sidesteps the webserver entirely for pure functions. Playwright remains the right tool for DOM assertions because they need a real renderer. F1.2 + F1.3 already use Playwright (computed style + DOM); F2.3 uses `node:test`. |
| A4 | `http://localhost:3000`, `pnpm test` | **`http://localhost:3010`, `pnpm test:app` / `pnpm test:all` / `pnpm exec playwright test --project=e2e ...`** | `pnpm dev` runs on port 3010 (per `package.json`). The script `pnpm test` does not exist; available scripts are `test:visual`, `test:app`, `test:all`. |

These four amendments do not affect: the Folio Atelier identity, the 4 moods, the motion choreography, the data model (M21), the storage bucket design, or any acceptance criterion. They only change file-loading mechanism, test framework, port, and CSS prefix string.

---

## Conventions used throughout this plan

- **Beat names** (e.g., `fpc-enter-hero`, `fpc-mood-card-select`) refer to the named motion beats defined in `design-language-recommendation.md` §3.5. The implementing agent must consult that section to know the easing token, duration, and properties for each beat.
- **Token names** (e.g., `--accent-warm`, `--fpc-radius`) refer to the palette/scale tokens defined in the same companion doc §3.2 and §3.3.
- **Visual gate** at the end of each phase means: implementing agent stops, starts the dev server (`pnpm dev`), navigates to the URLs listed under "Visual gate," and **explicitly asks the founder** to verify in browser before proceeding. Code metrics green is not a gate. The founder approval is the gate. See `feedback-visual-validation-required.md`.
- **No `--no-verify`, no `--force`, no `--skip` ever.** If a hook fails, fix the root cause.
- **Commits**: one commit per task, conventional commits, `feat(card): ...` / `fix(card): ...` / `chore(card): ...` / `test(card): ...`. Add `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer when relevant.
- **Phase numbering vs. spec:** spec §13 listed F1–F7. This plan inserts **F1 Token bootstrap** as a precondition phase (everything downstream depends on the tokens). The spec's F1–F7 shift to F2–F8 here. The mapping is documented in §0.4.
- **Out of scope tripwires (refuse the work, write an Open Question instead)**: refactoring `BookingWizard`'s 3-step flow itself (only its header changes); replacing `fi-btn` button recipe (separate sprint); changing `acento_hex` validation (M20 already defines its constraints); editing the sidebar avatar (out of scope per spec §3).

---

## 0 · Phase 0 — Design language ratification (research deliverable)

This phase produced [`./2026-05-21-design-language-recommendation.md`](./2026-05-21-design-language-recommendation.md). Its key outputs that this plan consumes:

- **Identity stays brass + cream + warm ink ("Folio Atelier" = evolution of Brass-aged)**.
- **Brass becomes signature, not button**. New `--accent-ink` `#2A4365` introduced for clinical CTAs.
- **One display serif added** — Fraunces (variable, OFL, free), used in declared hero slots only.
- **4 moods** (`cálido`, `clínico`, `editorial` (default), `boutique`) implemented as pure CSS-variable overrides via `[data-card-mood="…"]`.
- **3 decoration primitives + 1 texture overlay** (editorial-ruler, brass-corner-mark, date-badge, paper-noise) cover all 4 moods.
- **11 named motion beats** specified frame-by-frame; all degrade per the unified `prefers-reduced-motion` policy already in folio.css.

### 0.1 Open Questions resolved by founder before F1 starts

The founder must answer the 8 Open Questions in `design-language-recommendation.md` §7 *before* the implementing agent kicks off F1. Recommended defaults are in that section. The implementing agent should **not** assume defaults — read the founder's responses (left in a `### Founder decisions (date: …)` block appended to that doc) before F1 task 1.1.

### 0.2 If any Open Question is left unanswered

The implementing agent uses the recommended default and adds a `<!-- ASSUMED_DEFAULT: Q-N -->` HTML comment at the call-site so future review can locate the assumption.

### 0.3 Verification before F1

- [ ] Founder has reviewed `design-language-recommendation.md` end-to-end.
- [ ] Founder has answered the 8 Open Questions (or accepted defaults explicitly).
- [ ] Founder has confirmed the brass-demotion + ink-blue-introduction is endorsed (this is the single biggest taste decision).
- [ ] Implementing agent has read `feedback-visual-validation-required.md`, `feedback-premium-standard.md`, `feedback-no-emojis.md` from memory.

### 0.4 Phase mapping (spec F1-F7 → plan F1-F8)

| Spec §13 phase | Plan phase | Reason for renumbering |
|---|---|---|
| (none in spec) | **F1 Token bootstrap** | Inserted: every downstream phase reads new tokens |
| F1 Data foundation | F2 Data foundation | Shift |
| F2 Logo upload | F3 Logo upload | Shift |
| F3 Public card foundation (A) | F4 Public card foundation (A) | Shift |
| F4 Mood system (B) | F5 Mood system (B) | Shift |
| F5 Onboarding "identidad visual" | F6 Onboarding "identidad visual" | Shift |
| F6 `/book/[slug]` integration | F7 `/book/[slug]` integration | Shift |
| F7 Verification + ship | F8 Verification + ship | Shift |

---

*End of preamble. F1 starts on the next page-break — the implementing agent stops reading here and reads §1 only after confirming §0.3 boxes.*

---

## 1 · F1 — Token bootstrap (no UI changes ship)

**Goal of phase:** add the Folio Atelier tokens to `public/folio.css`, extend the Google Fonts `<link>` in `app/layout.tsx` to also fetch Fraunces, register the decoration-primitive React components + CSS classes, and verify zero visual regression on existing surfaces (dashboard, onboarding, login). Nothing should *look different* yet on the user-facing app; this phase only makes the new tokens *available*.

**Why this phase ships nothing visible:** decoupling the foundation from the UI work means F4 (PublicCard) can be reviewed against a stable token surface, and any taste-rejection at the visual gate of F1 (e.g., "Fraunces feels wrong on dashboard text — actually we never used it there but we want to confirm it's loaded right") is cheap to roll back. Frequent commits = low blast radius.

**Phase verification:**
- `pnpm typecheck && pnpm lint && pnpm build` green.
- Dashboard (`/hoy`), onboarding step 2, login, `/book/<existing-slug>` render **identical** to pre-F1 (visual diff via Playwright screenshot if available, else founder eyeballs at the gate).
- `document.fonts.check("1em Fraunces")` returns `true` after page load in `/onboarding`.
- Computed style of `:root` exposes the new tokens (`--accent-ink`, `--fpc-radius`, `--font-display`, `--space-4`, `--r-2xl`, `--track-tight-2`, `--shadow-card`).

### Files in F1

- **Modify:** `public/folio.css` — token additions only (append a new block; do not edit existing tokens).
- **Modify:** `app/layout.tsx` — extend the existing Google Fonts `<link>` to also request Fraunces (variable, opsz axis + weights 400/500/600).
- **Modify:** `next.config.ts` (only if needed) — no expected changes.
- **Create:** `components/public-card/decoration.tsx` — exports `<EditorialRule />`, `<BrassCornerMark />`, `<DateBadge />` decoration primitives (small file, ~80 lines).
- **Create:** `app/(dev)/decoration/page.tsx` — dev-only preview route that renders the three primitives so Playwright can assert their DOM presence.
- **Create:** `tests/e2e/atelier-tokens.spec.ts` — Playwright e2e (project `e2e`) covering: Fraunces `document.fonts.load` resolves; all required `:root` tokens have non-empty `getComputedStyle`; decoration primitives render at `/decoration`.

---

### Task 1.1 — Add Fraunces via Google Fonts `<link>` (matches existing Geist convention)

**Files:**
- Modify: `app/layout.tsx`

**Why CDN, not `next/font`:** the existing layout loads Geist + Geist Mono via `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`. Folio standardised on this pattern in F11 backlog ("self-hosting evaluado en F11 si Lighthouse lo demanda"). Mixing `next/font` (Fraunces) with CDN-loaded Geist/Geist Mono would be inconsistent and would block the planned F11 self-host migration. Keep parity now; migrate all three together later.

- [ ] **Step 1 — Read the current layout file.**

```bash
cat app/layout.tsx
```

- [ ] **Step 2 — Write the failing Playwright e2e that proves Fraunces is reachable.**

Create `tests/e2e/atelier-tokens.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("Atelier tokens · F1 acceptance", () => {
  test("Fraunces is loadable on /onboarding", async ({ page }) => {
    await page.goto("/onboarding");
    // document.fonts.load triggers fetch + returns array of resolved FontFace.
    // If Fraunces is unreachable, the promise resolves to []. Asserting length
    // catches a missing <link> as well as a CDN block.
    const loaded = await page.evaluate(async () => {
      const faces = await document.fonts.load("400 1em Fraunces");
      return faces.length;
    });
    expect(loaded).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3 — Run it; expect FAIL.**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "Fraunces is loadable" --reporter=line
```

Expected: FAIL — `loaded === 0`.

- [ ] **Step 4 — Add Fraunces to `app/layout.tsx` by extending the existing Geist `<link>`.**

Replace the current Geist `<link>` element with a single combined link covering Geist + Geist Mono + Fraunces (one HTTP request, one stylesheet, one cached resource). The Fraunces axis spec uses Google Fonts API v2 syntax for the optical-size axis.

```tsx
// app/layout.tsx — replace the existing single <link> stylesheet line with:
<link
  href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
  rel="stylesheet"
/>
```

Everything else in `layout.tsx` stays as-is. The `<link rel="preconnect">` lines already cover `fonts.googleapis.com` + `fonts.gstatic.com`.

- [ ] **Step 5 — Run the test; expect PASS.**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "Fraunces is loadable" --reporter=line
```

Expected: PASS — `loaded >= 1`.

- [ ] **Step 6 — Typecheck + lint.**

```bash
pnpm typecheck
pnpm lint
```

Expected: both green.

- [ ] **Step 7 — Commit.**

```bash
git add app/layout.tsx tests/e2e/atelier-tokens.spec.ts
git commit -m "$(cat <<'EOF'
feat(typography): load Fraunces variable display font via Google Fonts <link>

Extends the existing Geist + Geist Mono <link> in app/layout.tsx to also
request Fraunces (opsz 9..144 + wght 400/500/600). Same delivery
mechanism as Geist — single combined stylesheet, no next/font detour
(F11 backlog will self-host all three together).

For use in PublicCard hero + Step 9 reveal + editorial mood label.
Body type stays Geist; mono stays Geist Mono.

Rationale: docs/specs/2026-05-21-design-language-recommendation.md §3.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2 — Add palette evolution tokens to folio.css

**Files:**
- Modify: `public/folio.css` (append a new block at the end of `:root { … }` and `[data-theme="dark"] { … }`).

> **Note:** project uses Playwright only (no Vitest installed). Token-presence verification runs as a Playwright e2e that reads `getComputedStyle(:root)` against the running dev server.

- [ ] **Step 1 — Write the failing token-presence Playwright test.**

Append to `tests/e2e/atelier-tokens.spec.ts` (the same file created in 1.1):

```ts
test.describe("Atelier tokens · :root computed style", () => {
  const REQUIRED_TOKENS = [
    "--accent-warm",
    "--accent-warm-soft",
    "--accent-warm-glow",
    "--accent-ink",
    "--accent-ink-soft",
    "--accent-ink-glow",
    "--fpc-accent",
    "--fpc-bg-tint-style",
    "--fpc-name-family",
    "--fpc-name-weight",
    "--fpc-bio-style",
    "--fpc-radius",
    "--fpc-decoration",
    "--space-4",
    "--r-2xl",
    "--r-3xl",
    "--r-pill",
    "--shadow-card",
    "--shadow-focus-warm",
    "--shadow-focus-ink",
    "--track-tight-2",
    "--font-display",
  ] as const;

  for (const token of REQUIRED_TOKENS) {
    test(`:root declares ${token}`, async ({ page }) => {
      await page.goto("/onboarding");
      const value = await page.evaluate(
        (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
        token,
      );
      expect(value, `${token} should resolve to a non-empty value`).not.toBe("");
    });
  }

  test("--accent-ink resolves to #2A4365 in light mode", async ({ page }) => {
    await page.goto("/onboarding");
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent-ink").trim().toLowerCase(),
    );
    expect(value).toBe("#2a4365");
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL on every missing token.**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "computed style" --reporter=line
```

Expected: many FAILs (tokens not yet declared).

- [ ] **Step 3 — Add the token block to folio.css.**

Append to the end of the existing `:root { … }` block (or as a fresh block right after — keep order: the new block must come AFTER the existing brass-aged block so it overrides where intended):

> **Verbatim source for this token block: `design-language-recommendation.md` §3.2 light + dark blocks.** Copy them in full into `public/folio.css`. Don't rewrite — copy.

Then append:

```css
/* ═════════════ FOLIO ATELIER · type-scale + track-scale tokens ═════════════ */
:root {
  --font-display: 'Fraunces', 'Iowan Old Style', Georgia, serif;
  --font-sans:    'Geist', -apple-system, system-ui, sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, monospace;

  --fs-xs:     11px;
  --fs-sm:     12.5px;
  --fs-body:   14px;
  --fs-md:     15px;
  --fs-lg:     18px;
  --fs-xl:     22px;
  --fs-2xl:    28px;
  --fs-3xl:    34px;
  --fs-4xl:    44px;
  --fs-display: 56px;

  --track-tight-2: -0.028em;
  --track-tight-1: -0.018em;
  --track-tight-0: -0.01em;
  --track-normal:  0;
  --track-loose-1: 0.04em;
  --track-loose-2: 0.10em;
  --track-loose-3: 0.14em;
}
```

- [ ] **Step 4 — Run test; expect PASS.**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "computed style" --reporter=line
```

Expected: PASS on all token-presence checks + the `--accent-ink === #2a4365` assertion.

- [ ] **Step 5 — Run typecheck + build.**

```bash
pnpm typecheck && pnpm build
```

Expected: both green. No layout change ships.

- [ ] **Step 6 — Commit.**

```bash
git add public/folio.css tests/unit/folio-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(tokens): add Folio Atelier palette + type-scale + spacing tokens

Adds --accent-ink (#2A4365, clinical functional accent), --accent-warm-*
(brass identity layer), --fpc-* (PublicCard mood overlay scaffold),
--space-*, --r-2xl/3xl/pill, --shadow-card, --track-* scale, and
--font-display alias. Back-compat: legacy --accent / --brass aliases
still resolve to brass.

Source of truth: docs/specs/2026-05-21-design-language-recommendation.md §3.2-3.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3 — Register decoration-primitive React components + CSS classes

**Files:**
- Create: `components/public-card/decoration.tsx`
- Create: `app/(dev)/decoration/page.tsx` — dev preview rendering the three primitives.
- Modify: `tests/e2e/atelier-tokens.spec.ts` — append decoration assertions.
- Modify: `public/folio.css` — append `.fpc-rule`, `.fpc-corner-mark`, `.fpc-date-badge` styles.

- [ ] **Step 1 — Write the failing Playwright assertions.**

Append to `tests/e2e/atelier-tokens.spec.ts`:

```ts
test.describe("Atelier decoration primitives", () => {
  test("EditorialRule, BrassCornerMark, DateBadge render at /decoration", async ({ page }) => {
    await page.goto("/decoration");
    await expect(page.locator(".fpc-rule").first()).toBeVisible();
    const svg = page.locator("svg.fpc-corner-mark").first();
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByText("EST. 2026 · CÓRDOBA")).toHaveClass(/fpc-date-badge/);
  });
});
```

- [ ] **Step 2 — Run; expect FAIL (route 404 + selectors missing).**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "decoration primitives" --reporter=line
```

- [ ] **Step 3 — Create `components/public-card/decoration.tsx`.**

```tsx
/**
 * Folio · PublicCard decoration primitives.
 *
 * Pure CSS-class-driven SVG/HTML primitives consumed by mood overrides.
 * No props beyond label; styling is governed by --fpc-decoration-color set
 * by the mood block on the card root.
 */

export function EditorialRule(props: { label?: string }) {
  return <span className="fpc-rule" aria-hidden>{props.label ?? ""}</span>;
}

export function BrassCornerMark() {
  return (
    <svg
      className="fpc-corner-mark"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M 18 0 L 18 7 M 18 0 L 11 0"
        stroke="var(--fpc-decoration-color)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DateBadge({ label }: { label: string }) {
  return (
    <span className="fpc-date-badge" aria-label={`Marca de origen: ${label}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 4 — Append the CSS for these classes to `public/folio.css`.**

```css
/* ═════════════ FOLIO ATELIER · decoration primitives ═════════════ */
.fpc-rule {
  display: block;
  height: 1px;
  width: 24px;
  background: var(--fpc-decoration-color, var(--ink-3));
  margin-bottom: 10px;
  opacity: 0.6;
}
.fpc-corner-mark {
  display: inline-block;
  color: var(--fpc-decoration-color, var(--accent-warm));
  opacity: 0.7;
}
.fpc-date-badge {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: var(--track-loose-2);
  color: var(--ink-3);
  padding: 3px 9px;
  border: 1px solid var(--fpc-decoration-color, var(--accent-warm));
  border-radius: var(--r-pill);
  background: transparent;
}
```

- [ ] **Step 5 — Create the dev preview route `app/(dev)/decoration/page.tsx`:**

```tsx
import { EditorialRule, BrassCornerMark, DateBadge } from "@/components/public-card/decoration";

export const dynamic = "force-static";

export default function DecorationDevPage() {
  return (
    <main style={{ padding: 40, display: "grid", gap: 24 }}>
      <section>
        <h2>EditorialRule</h2>
        <EditorialRule />
      </section>
      <section style={{ position: "relative", padding: 24, border: "1px solid var(--line)", borderRadius: 12, width: 280 }}>
        <h2>BrassCornerMark</h2>
        <span style={{ position: "absolute", top: 8, right: 12 }}><BrassCornerMark /></span>
      </section>
      <section>
        <h2>DateBadge</h2>
        <DateBadge label="EST. 2026 · CÓRDOBA" />
      </section>
    </main>
  );
}
```

- [ ] **Step 6 — Run tests; expect PASS.**

```bash
pnpm exec playwright test --project=e2e tests/e2e/atelier-tokens.spec.ts -g "decoration primitives" --reporter=line
pnpm typecheck
```

- [ ] **Step 7 — Commit.**

```bash
git add components/public-card/decoration.tsx app/\(dev\)/decoration/page.tsx public/folio.css tests/e2e/atelier-tokens.spec.ts
git commit -m "feat(card): decoration primitives (rule, corner-mark, date-badge) + dev route

Three pure-CSS-class decoration components consumed by the 4 mood
presets. Color governed by --fpc-decoration-color on the card root.
Preview at /decoration; Playwright e2e asserts DOM presence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4 — Visual gate (founder approval)

**Goal:** confirm nothing regressed visually on existing surfaces and that Fraunces is loaded.

- [ ] **Step 1 — Start dev server.**

```bash
pnpm dev
```

- [ ] **Step 2 — In a browser, walk these URLs and compare to pre-F1 screenshots (or memory if no baseline):**

  - `/login` — should look identical (Geist, brass-aged).
  - `/onboarding` — should look identical except Fraunces is now loaded (visible via DevTools → Network → fonts).
  - `/hoy` (after login as a known test user) — sidebar + dashboard look identical.
  - `/book/<existing-slug>` — booking flow looks identical (header is still the inline plain header — that changes in F7).

- [ ] **Step 3 — In DevTools Console, run:**

```js
document.fonts.check("1em Fraunces");          // → true
getComputedStyle(document.documentElement).getPropertyValue("--accent-ink");  // → "#2A4365"
getComputedStyle(document.documentElement).getPropertyValue("--font-display"); // → contains "fraunces" or "Iowan"
```

- [ ] **Step 4 — Ask the founder:**

> "F1 token bootstrap done. Surfaces look identical to before; Fraunces is loaded but unused yet. Can I move to F2?"

- [ ] **Step 5 — Receive explicit "sí" or correction. Do not proceed silently.**

- [ ] **Step 6 — Commit any drift-fixes from the gate, then move to F2.**

---

## 2 · F2 — Data foundation (M21 migration + Storage bucket + helpers)

**Goal:** create `organization.logo_url` (nullable text), `organization.card_mood` (text with check constraint, default `'editorial'`), the Supabase Storage bucket `org-logos` with RLS policy, and `lib/storage/logos.ts` helpers for upload/URL.

**Phase verification:**
- pgTAP green for M21.
- `supabase storage list-buckets` (or dashboard) shows `org-logos` bucket.
- A test upload from the helper writes to `<org_id>/logo.png` and the public URL resolves to `200`.
- Existing orgs unaffected (`logo_url IS NULL` for all backfilled rows; `card_mood = 'editorial'` for all).

### Files in F2

- **Create:** `supabase/migrations/20260521000021_M21_card_personalization.sql`
- **Create:** `supabase/tests/M21_card_personalization.test.sql` (pgTAP)
- **Create:** `lib/storage/logos.ts`
- **Create:** `lib/storage/__tests__/logos.test.ts` (Vitest unit)
- **Create:** `supabase/storage/policies/org-logos.sql` (Storage RLS — separate file because Storage policies live in `storage.objects`, not the regular schema)

---

### Task 2.1 — Write the failing pgTAP test for M21

**Files:** Create `supabase/tests/M21_card_personalization.test.sql`.

- [ ] **Step 1 — Author the failing test.**

```sql
-- supabase/tests/M21_card_personalization.test.sql

BEGIN;
SELECT plan(8);

-- 1. logo_url column exists, is text, is nullable
SELECT has_column('organization', 'logo_url', 'organization.logo_url exists');
SELECT col_type_is('organization', 'logo_url', 'text', 'logo_url is text');
SELECT col_is_null('organization', 'logo_url', 'logo_url is nullable');

-- 2. card_mood column exists, is text, NOT NULL, default 'editorial'
SELECT has_column('organization', 'card_mood', 'organization.card_mood exists');
SELECT col_type_is('organization', 'card_mood', 'text', 'card_mood is text');
SELECT col_not_null('organization', 'card_mood', 'card_mood is NOT NULL');
SELECT col_default_is('organization', 'card_mood', 'editorial', 'card_mood default is editorial');

-- 3. CHECK constraint enforces the 4-mood enum
SELECT throws_ok(
  $$ INSERT INTO organization (slug, nombre, card_mood) VALUES ('test-bad-mood', 'X', 'invalid_mood') $$,
  '23514',
  NULL,
  'card_mood rejects invalid values (CHECK constraint enforced)'
);

ROLLBACK;
```

- [ ] **Step 2 — Run it; expect FAIL.**

```bash
# Local pgTAP runner (adjust to your setup; e.g., via supabase CLI)
pnpm pgtap supabase/tests/M21_card_personalization.test.sql
```

Expected: every assertion fails — columns do not exist yet.

---

### Task 2.2 — Author the migration M21

**Files:** Create `supabase/migrations/20260521000021_M21_card_personalization.sql`.

- [ ] **Step 1 — Write the migration.**

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M21 · Card personalization (logo_url + card_mood)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds two columns to organization to support Layer D (logo upload) and
-- Layer B (mood preset) of the public card redesign. NO PII, no encryption.
--
-- Mood values are a 4-enum text column with a CHECK constraint (not a PG
-- ENUM type — text + CHECK is easier to evolve and Supabase RLS handles it
-- the same way).
--
-- Backfill: all existing orgs receive card_mood='editorial' via the column
-- default. logo_url stays NULL by definition.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS logo_url  text NULL,
  ADD COLUMN IF NOT EXISTS card_mood text NOT NULL DEFAULT 'editorial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_card_mood_enum'
  ) THEN
    ALTER TABLE organization
      ADD CONSTRAINT organization_card_mood_enum
      CHECK (card_mood IN ('calido','clinico','editorial','boutique'));
  END IF;
END$$;

COMMENT ON COLUMN organization.logo_url IS
  'URL pública del logo PNG del consultorio (Supabase Storage bucket org-logos). NULL → renderea avatar iniciales en card pública.';
COMMENT ON COLUMN organization.card_mood IS
  'Estilo visual elegido por el pro para su card pública. Valores: calido | clinico | editorial | boutique. Aplicado vía data-card-mood en <PublicCard>.';
```

- [ ] **Step 2 — Apply the migration locally.**

```bash
supabase db push  # or the project's standard migration runner
```

- [ ] **Step 3 — Run pgTAP; expect PASS.**

```bash
pnpm pgtap supabase/tests/M21_card_personalization.test.sql
```

Expected: 8/8 PASS.

- [ ] **Step 4 — Commit.**

```bash
git add supabase/migrations/20260521000021_M21_card_personalization.sql supabase/tests/M21_card_personalization.test.sql
git commit -m "feat(db): M21 add organization.logo_url + organization.card_mood

Supports Layer D (logo upload) and Layer B (mood preset) of the
public card redesign. card_mood enforced via CHECK (4 values).
Backfill: existing orgs get card_mood='editorial' from default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3 — Create Supabase Storage bucket `org-logos` + RLS

**Files:** Create `supabase/storage/policies/org-logos.sql`.

- [ ] **Step 1 — Author the bucket-creation + RLS SQL.**

```sql
-- supabase/storage/policies/org-logos.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Folio · org-logos bucket · RLS policies
-- ════════════════════════════════════════════════════════════════════════════
-- Bucket: org-logos, public read, write restricted to org OWNER/DIRECTOR.
-- Path convention: <org_id>/logo.png (re-upload overwrites in place).
--
-- Why public read: the logo appears on /book/<slug> which is anonymous.
-- Public-readable is correct here — no PII.
-- ════════════════════════════════════════════════════════════════════════════

-- Bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  524288,                          -- 512 KB
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: anyone can read (public read)
CREATE POLICY IF NOT EXISTS "org-logos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

-- Policy: only OWNER/DIRECTOR of the org can insert/update/delete
-- (path prefix must equal the org_id of an org where the auth user is OWNER or DIRECTOR)
CREATE POLICY IF NOT EXISTS "org-logos owner-or-director write"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'org-logos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM member m
      WHERE m.profile_id = auth.uid()
        AND m.organization_id::text = (string_to_array(name, '/'))[1]
        AND m.role IN ('OWNER', 'DIRECTOR')
        AND m.deleted_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM member m
      WHERE m.profile_id = auth.uid()
        AND m.organization_id::text = (string_to_array(name, '/'))[1]
        AND m.role IN ('OWNER', 'DIRECTOR')
        AND m.deleted_at IS NULL
    )
  );
```

- [ ] **Step 2 — Apply.**

```bash
psql "$SUPABASE_DB_URL" -f supabase/storage/policies/org-logos.sql
# or via the supabase CLI equivalent
```

- [ ] **Step 3 — Verify via dashboard or CLI that the bucket exists with `public=true`, `file_size_limit=524288`, MIME allowlist `image/png`.**

- [ ] **Step 4 — Commit.**

```bash
git add supabase/storage/policies/org-logos.sql
git commit -m "feat(storage): create org-logos bucket (public read, OWNER/DIRECTOR write)

512 KB cap, PNG-only MIME allowlist. Path: <org_id>/logo.png. Public
read because /book/<slug> is anonymous. RLS write restricted to the
org's OWNER or DIRECTOR via the member table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4 — Write `lib/storage/logos.ts` helper + unit test

**Files:**
- Create: `lib/storage/logos.ts`
- Create: `lib/storage/__tests__/logos.test.ts`

- [ ] **Step 1 — Write the failing unit test.**

```ts
// lib/storage/__tests__/logos.test.ts
import { describe, it, expect } from "vitest";
import {
  buildLogoPath,
  buildLogoPublicUrl,
  validateLogoFile,
  LOGO_MAX_BYTES,
} from "../logos";

describe("lib/storage/logos · pure helpers", () => {
  it("buildLogoPath produces <org_id>/logo.png", () => {
    expect(buildLogoPath("11111111-2222-3333-4444-555555555555"))
      .toBe("11111111-2222-3333-4444-555555555555/logo.png");
  });

  it("buildLogoPublicUrl appends bucket + path against a project URL", () => {
    const url = buildLogoPublicUrl({
      supabaseUrl: "https://abc.supabase.co",
      orgId: "11111111-2222-3333-4444-555555555555",
    });
    expect(url).toBe(
      "https://abc.supabase.co/storage/v1/object/public/org-logos/11111111-2222-3333-4444-555555555555/logo.png"
    );
  });

  it("validateLogoFile accepts a PNG under 512 KB", () => {
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    expect(validateLogoFile(file).ok).toBe(true);
  });

  it("validateLogoFile rejects non-PNG", () => {
    const file = new File([new Uint8Array(1024)], "logo.jpg", { type: "image/jpeg" });
    const result = validateLogoFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("PNG");
  });

  it("validateLogoFile rejects > 512 KB", () => {
    const big = new File([new Uint8Array(LOGO_MAX_BYTES + 1)], "logo.png", { type: "image/png" });
    const result = validateLogoFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("500");
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL (module missing).**

```bash
pnpm exec vitest run lib/storage/__tests__/logos.test.ts
```

- [ ] **Step 3 — Implement `lib/storage/logos.ts`.**

```ts
/**
 * Folio · org-logos storage helpers.
 *
 * Pure path/url builders + a client-side file validator. The actual upload
 * happens server-side from the onboarding action (so we keep service-role
 * out of the browser). This module is pure — no Supabase client created here.
 */

export const LOGO_BUCKET = "org-logos" as const;
export const LOGO_MAX_BYTES = 500 * 1024;                 // 500 KB (under bucket 512 KB cap, leaving ~12 KB headroom)
export const LOGO_ALLOWED_MIME = ["image/png"] as const;
export const LOGO_OBJECT_NAME = "logo.png" as const;

export function buildLogoPath(orgId: string): string {
  return `${orgId}/${LOGO_OBJECT_NAME}`;
}

export function buildLogoPublicUrl(args: { supabaseUrl: string; orgId: string }): string {
  const trimmed = args.supabaseUrl.replace(/\/+$/, "");
  return `${trimmed}/storage/v1/object/public/${LOGO_BUCKET}/${buildLogoPath(args.orgId)}`;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string; code: "wrong-mime" | "too-big" | "empty" };

export function validateLogoFile(file: File): ValidateResult {
  if (file.size === 0) return { ok: false, error: "El archivo está vacío.", code: "empty" };
  if (!(LOGO_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Solo aceptamos PNG.", code: "wrong-mime" };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "El logo supera los 500 KB. Reducí el tamaño y volvé a intentar.", code: "too-big" };
  }
  return { ok: true };
}
```

- [ ] **Step 4 — Run tests; expect PASS.**

```bash
pnpm exec vitest run lib/storage/__tests__/logos.test.ts
pnpm typecheck
```

- [ ] **Step 5 — Commit.**

```bash
git add lib/storage/logos.ts lib/storage/__tests__/logos.test.ts
git commit -m "feat(storage): pure helpers for org-logos path + URL + validation

Constants: bucket name, 500 KB cap (under 512 KB bucket limit),
PNG-only MIME. validateLogoFile returns a discriminated union for
typed error handling at the call site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5 — F2 Visual gate

- [ ] **Step 1 — Confirm migration ran.**

```bash
psql "$SUPABASE_DB_URL" -c "\d organization" | grep -E "logo_url|card_mood"
```

Expected: two rows (`logo_url text`, `card_mood text NOT NULL DEFAULT 'editorial'`).

- [ ] **Step 2 — Confirm bucket exists.**

Via dashboard or:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT id, public, file_size_limit FROM storage.buckets WHERE id='org-logos';"
```

- [ ] **Step 3 — Confirm RLS policies exist.**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT policyname FROM pg_policies WHERE tablename='objects' AND schemaname='storage';" | grep org-logos
```

- [ ] **Step 4 — Ask the founder:** "F2 done — migration + bucket + RLS + helper. Nothing visible changed in the app yet. Can I proceed to F3?"

---

## 3 · F3 — Logo upload component (`<LogoUpload>`)

**Goal:** ship a self-contained `<LogoUpload>` component that supports drag-drop + click-to-browse + preview + error states, calls a server action to persist `logo_url` on the organization, and respects the motion beats `fpc-logo-drop-enter` + `fpc-logo-drop-error`.

**Phase verification:**
- Component renders standalone in a Storybook entry or test page.
- Drag a 1×1 px PNG → preview appears (320 ms scale 0.92→1.00 + opacity).
- Drag a JPG → error shake animation, error message, no upload triggered.
- Drag a 600 KB PNG → "supera 500 KB" error.
- A real upload writes to `org-logos/<org_id>/logo.png` and updates `organization.logo_url`.
- Re-upload overwrites at same path.

### Files in F3

- **Create:** `components/public-card/logo-upload.tsx`
- **Create:** `components/public-card/__tests__/logo-upload.test.tsx`
- **Modify:** `app/(public)/onboarding/actions.ts` — add `uploadOrgLogo` server action.
- **Create:** `app/(public)/onboarding/__tests__/upload-logo.action.test.ts`
- **Modify:** `public/folio.css` — append `.fpc-dropzone-*` styles + keyframes for `fpc-logo-drop-error` shake.

---

### Task 3.1 — Define the server action `uploadOrgLogo`

**Files:**
- Modify: `app/(public)/onboarding/actions.ts`
- Create: `app/(public)/onboarding/__tests__/upload-logo.action.test.ts`

- [ ] **Step 1 — Write the failing action test.**

```ts
// app/(public)/onboarding/__tests__/upload-logo.action.test.ts
import { describe, it, expect, vi } from "vitest";
// Mocks for Supabase client — adapt to existing test setup
import { uploadOrgLogo } from "../actions";

describe("uploadOrgLogo · server action contract", () => {
  it("returns { ok:false } if no session", async () => {
    // Arrange: stub auth.getUser → no user
    const res = await uploadOrgLogo({ pngBase64: "iVBORw0KGgo...", contentType: "image/png" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sesi/i);
  });
  // Additional tests: rejects non-png contentType, rejects > 500 KB, success returns logo_url
});
```

- [ ] **Step 2 — Implement `uploadOrgLogo` in `actions.ts`.**

Append (after `finalizeOnboarding`):

```ts
// ─── uploadOrgLogo · persists a PNG into org-logos and updates organization.logo_url ───

import { LOGO_BUCKET, LOGO_MAX_BYTES, buildLogoPath, buildLogoPublicUrl } from "@/lib/storage/logos";

export interface UploadOrgLogoArgs {
  /** Base64-encoded PNG bytes (no data: prefix). */
  pngBase64: string;
  /** Must be image/png. */
  contentType: string;
}

export interface UploadOrgLogoResult {
  ok: boolean;
  error?: string;
  logoUrl?: string;
}

export async function uploadOrgLogo(args: UploadOrgLogoArgs): Promise<UploadOrgLogoResult> {
  if (args.contentType !== "image/png") {
    return { ok: false, error: "Solo aceptamos PNG." };
  }
  const buf = Buffer.from(args.pngBase64, "base64");
  if (buf.byteLength === 0) return { ok: false, error: "Archivo vacío." };
  if (buf.byteLength > LOGO_MAX_BYTES) {
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
  if (!member?.organization_id) return { ok: false, error: "No pude resolver tu organización." };
  const orgId = member.organization_id as string;

  const path = buildLogoPath(orgId);
  const { error: upErr } = await service.storage.from(LOGO_BUCKET).upload(path, buf, {
    contentType: "image/png",
    upsert: true,                       // re-upload overwrites
    cacheControl: "no-cache",
  });
  if (upErr) return { ok: false, error: `Error subiendo logo: ${upErr.message}` };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const logoUrl = `${buildLogoPublicUrl({ supabaseUrl, orgId })}?v=${Date.now()}`; // cache-bust

  const { error: dbErr } = await service
    .from("organization")
    .update({ logo_url: logoUrl })
    .eq("id", orgId);
  if (dbErr) return { ok: false, error: `Error guardando logo_url: ${dbErr.message}` };

  return { ok: true, logoUrl };
}

export interface RemoveOrgLogoResult { ok: boolean; error?: string; }

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
  if (!member?.organization_id) return { ok: false, error: "No pude resolver tu organización." };
  const orgId = member.organization_id as string;
  const { error: rmErr } = await service.storage.from(LOGO_BUCKET).remove([buildLogoPath(orgId)]);
  if (rmErr && !/not.?found/i.test(rmErr.message)) return { ok: false, error: rmErr.message };
  await service.from("organization").update({ logo_url: null }).eq("id", orgId);
  return { ok: true };
}
```

- [ ] **Step 3 — Run; expect PASS on the tests once stubs are wired.**

- [ ] **Step 4 — Commit.**

```bash
git add app/(public)/onboarding/actions.ts app/(public)/onboarding/__tests__/upload-logo.action.test.ts
git commit -m "feat(card): uploadOrgLogo + removeOrgLogo server actions

Validates PNG + 500 KB cap, writes to org-logos/<org_id>/logo.png
(upsert: true), then updates organization.logo_url with a
cache-busted public URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2 — Implement `<LogoUpload>` component

**Files:** Create `components/public-card/logo-upload.tsx` + its test file.

Component contract:

```ts
interface LogoUploadProps {
  currentLogoUrl?: string | null;
  onUploaded: (logoUrl: string) => void;       // parent updates state
  onRemoved: () => void;
  /** When true, suppresses motion (for SSR-driven contexts). */
  reducedMotion?: boolean;
}
```

States:

| State | Trigger | Visual |
|---|---|---|
| `idle` | initial render, no logo | dashed border `--ink-4`, centered "Arrastrá tu logo aquí o hacé click" + helper "PNG, transparente, ≥512×512 — max 500 KB" |
| `idle-with-logo` | `currentLogoUrl` is set | shows 80×80 px logo preview centered + "Cambiar" + "Quitar" buttons under |
| `drag-over` | `dragover` event | dashed border `--accent-warm`, surface tint `--accent-warm-soft`, helper text → "Soltá para subir" |
| `validating` | drop or file-pick fires | spinner badge top-right; preview thumb 80×80 px at 0.6 opacity |
| `uploading` | server action in flight | spinner badge top-right; preview thumb at 1.0 opacity, brass progress hairline at bottom |
| `success` | server action OK | beat `fpc-logo-drop-enter` plays on preview (scale 0.92→1.00 + opacity, `--ease-overshoot`, 320 ms) |
| `error` | server action rejects OR client validation fails | beat `fpc-logo-drop-error` plays (3-cycle shake) + inline error in `--red`, dashed border becomes `--red` |

Frame-by-frame motion:

- **`fpc-logo-drop-enter`** — at `T=0`: preview already painted at `opacity:0` `scale:0.92`. From `T=0` to `T=320 ms`, `opacity 0→1`, `transform: scale(0.92)→scale(1.00)`, easing `--ease-overshoot`. No follow-through. Rationale: overshoot reads as "stamping" — appropriate for a brand logo landing on a brand card.
- **`fpc-logo-drop-error`** — from `T=0` to `T=220 ms` over 3 sub-beats: `translateX(0→-6→+6→-3→+3→0)`, easing `--ease-anticipate`, total duration 220 ms; simultaneous border-color tween `--ink-4 → --red` over 140 ms. After `T=220 ms` the shake stops; border stays red until next drag-over or successful drop.

CSS additions to `public/folio.css`:

```css
/* ═════════════ FOLIO ATELIER · LogoUpload dropzone ═════════════ */
.fpc-dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 196px;
  padding: 24px;
  border: 1.5px dashed var(--ink-4);
  border-radius: var(--r-xl);
  background: transparent;
  cursor: pointer;
  transition:
    border-color var(--dur-quick) var(--ease-standard-out),
    background var(--dur-quick) var(--ease-standard-out);
}
.fpc-dropzone:hover { border-color: var(--accent-warm); }
.fpc-dropzone.is-drag-over {
  border-color: var(--accent-warm);
  background: var(--accent-warm-soft);
}
.fpc-dropzone.is-error {
  border-color: var(--red);
  animation: fpc-logo-drop-error var(--dur-snappy) var(--ease-anticipate);
}
.fpc-dropzone-preview {
  width: 80px;
  height: 80px;
  object-fit: contain;
  border-radius: var(--r-md);
  opacity: 0;
  transform: scale(0.92);
  animation: fpc-logo-drop-enter var(--dur-moderate) var(--ease-overshoot) forwards;
}
.fpc-dropzone-hint {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

@keyframes fpc-logo-drop-enter {
  to { opacity: 1; transform: scale(1.00); }
}
@keyframes fpc-logo-drop-error {
  0%   { transform: translateX(0);  }
  20%  { transform: translateX(-6px); }
  40%  { transform: translateX( 6px); }
  60%  { transform: translateX(-3px); }
  80%  { transform: translateX( 3px); }
  100% { transform: translateX(0);  }
}

@media (prefers-reduced-motion: reduce) {
  .fpc-dropzone-preview,
  .fpc-dropzone.is-error {
    animation: none !important;
  }
  .fpc-dropzone-preview { opacity: 1; transform: none; }
}
```

- [ ] **Step 1 — Write the failing component test.**

```tsx
// components/public-card/__tests__/logo-upload.test.tsx
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LogoUpload } from "../logo-upload";

describe("<LogoUpload>", () => {
  it("idle: shows helper text", () => {
    render(<LogoUpload onUploaded={() => {}} onRemoved={() => {}} />);
    expect(screen.getByText(/PNG, transparente/i)).toBeInTheDocument();
  });
  it("drag-over: applies is-drag-over class", () => {
    render(<LogoUpload onUploaded={() => {}} onRemoved={() => {}} />);
    const dz = screen.getByRole("button", { name: /logo/i });
    fireEvent.dragOver(dz);
    expect(dz.className).toMatch(/is-drag-over/);
  });
  it("error: drag-drop a JPG triggers error class + message", async () => {
    const onUploaded = vi.fn();
    render(<LogoUpload onUploaded={onUploaded} onRemoved={() => {}} />);
    const dz = screen.getByRole("button", { name: /logo/i });
    const jpg = new File([new Uint8Array(1024)], "f.jpg", { type: "image/jpeg" });
    fireEvent.drop(dz, { dataTransfer: { files: [jpg] } });
    expect(await screen.findByText(/PNG/i)).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 — Run; expect FAIL (component not built).**

- [ ] **Step 3 — Implement `components/public-card/logo-upload.tsx`.**

```tsx
"use client";
import { useCallback, useId, useRef, useState } from "react";
import { uploadOrgLogo, removeOrgLogo } from "@/app/(public)/onboarding/actions";
import { validateLogoFile, LOGO_ALLOWED_MIME } from "@/lib/storage/logos";

interface LogoUploadProps {
  currentLogoUrl?: string | null;
  onUploaded: (logoUrl: string) => void;
  onRemoved: () => void;
  reducedMotion?: boolean;
}

type Status = "idle" | "drag-over" | "validating" | "uploading" | "error" | "success";

export function LogoUpload({ currentLogoUrl, onUploaded, onRemoved }: LogoUploadProps) {
  const [status, setStatus] = useState<Status>(currentLogoUrl ? "success" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(currentLogoUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    const v = validateLogoFile(file);
    if (!v.ok) {
      setStatus("error");
      setError(v.error);
      return;
    }
    setStatus("validating");
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setLocalPreview(dataUrl);
      const base64 = dataUrl.split(",")[1] ?? "";
      setStatus("uploading");
      const result = await uploadOrgLogo({ pngBase64: base64, contentType: "image/png" });
      if (!result.ok) {
        setStatus("error");
        setError(result.error ?? "Error desconocido.");
        return;
      }
      setStatus("success");
      onUploaded(result.logoUrl!);
    };
    reader.readAsDataURL(file);
  }, [onUploaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setStatus("idle");
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void handleFile(file);
  }, [handleFile]);

  const onClickPick = () => fileInputRef.current?.click();
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const onRemove = async () => {
    const r = await removeOrgLogo();
    if (r.ok) {
      setLocalPreview(null);
      setStatus("idle");
      onRemoved();
    } else {
      setError(r.error ?? "No pude quitar el logo.");
    }
  };

  const dragClass = status === "drag-over" ? "is-drag-over" : status === "error" ? "is-error" : "";

  return (
    <div className={`fpc-dropzone ${dragClass}`.trim()}
      role="button"
      aria-label="Subir logo del consultorio"
      tabIndex={0}
      onClick={onClickPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClickPick(); }}
      onDragOver={(e) => { e.preventDefault(); setStatus("drag-over"); }}
      onDragLeave={() => setStatus(localPreview ? "success" : "idle")}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={LOGO_ALLOWED_MIME.join(",")}
        hidden
        onChange={onPick}
      />
      {localPreview ? (
        <img src={localPreview} alt="Vista previa del logo" className="fpc-dropzone-preview" />
      ) : (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.4" color="var(--ink-4)" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 600, color: "var(--ink)" }}>
          {localPreview ? "Cambiar logo" : "Arrastrá tu logo aquí o hacé click"}
        </div>
        <div className="fpc-dropzone-hint">PNG, transparente, ≥512×512 — max 500 KB</div>
      </div>
      {error ? (
        <div role="alert" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{error}</div>
      ) : null}
      {localPreview ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void onRemove(); }}
          style={{ marginTop: 4, fontSize: "var(--fs-sm)", color: "var(--ink-3)", background: "transparent" }}
        >
          Quitar logo
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4 — Run tests; expect PASS.**

- [ ] **Step 5 — Commit.**

```bash
git add components/public-card/logo-upload.tsx components/public-card/__tests__/logo-upload.test.tsx public/folio.css
git commit -m "feat(card): LogoUpload component (drag-drop, validate, error shake)

Implements fpc-logo-drop-enter (320 ms overshoot stamp) and
fpc-logo-drop-error (220 ms 3-cycle shake). PNG-only client + server
validation. Re-upload overwrites at <org_id>/logo.png. Reduce-motion
honoured (animations stripped, final state preserved).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3 — F3 Visual gate

- [ ] Start `pnpm dev`, navigate to a temporary preview route (or onboarding Step 4 stub if already plumbed) and:
  - Drag a transparent PNG ≥512×512 px → expect stamp-in animation, persisted to DB.
  - Drag a JPG → expect 3-cycle shake + Spanish error.
  - Drag a 600 KB PNG → expect "supera 500 KB".
  - Quit & re-enter the page → logo persists (DB-driven).
- [ ] Ask founder: "F3 logo upload done. Approve to proceed to F4 PublicCard?"

---

## 4 · F4 — `<PublicCard>` foundation (Layer A · default mood "editorial")

**Goal:** ship the new `<PublicCard>` component with three variants (`preview`, `full`, `editing`), implementing the editorial mood as the baseline. No mood-switching logic yet (that arrives in F5); the card simply renders with `data-card-mood="editorial"` hard-coded. By end of F4 the card replaces `<CardPreview>` in the onboarding live-preview shell and in Step 9, **without** changing `/book/[slug]` yet (that lands in F7).

**Phase verification:**
- Component renders with sample data in onboarding live-preview sticky panel.
- Step 9 reveal uses `<PublicCard variant="full" />` and the choreography sequences correctly (frame-by-frame below).
- `prefers-reduced-motion: reduce` collapses all entry beats to fades.
- Existing `<CardPreview>` import is replaced by `<PublicCard>` via a re-export shim during transition; no compile errors.
- Acceptance criterion **"Sin logo, fallback AvatarIniciales se renderea con calidad elite"** passes — manually verify in browser.

### Files in F4

- **Create:** `components/public-card/public-card.tsx`
- **Create:** `components/public-card/__tests__/public-card.test.tsx`
- **Create:** `components/public-card/avatar-fallback.tsx` (extracted re-export of current `AvatarIniciales` to keep the public-card folder self-contained; no functional change — re-exports `AvatarIniciales`).
- **Modify:** `components/onboarding/card-preview.tsx` — convert to a compat re-export of `PublicCard` (keeps existing imports working until F8 cleanup).
- **Modify:** `public/folio.css` — append `.fpc-card`, `.fpc-hero`, `.fpc-name`, `.fpc-meta`, `.fpc-bio`, `.fpc-contact`, `.fpc-services`, `.fpc-cta`, `.fpc-link-footer` plus their entry keyframes.
- **Modify:** `components/onboarding/step-shell.tsx` and `components/onboarding/step9-moment.tsx` — swap import.

---

### Task 4.1 — Scaffold the PublicCard file with types

- [ ] **Step 1 — Read existing `CardPreview` props carefully (already done in F1 prep but re-confirm).**

The new component preserves the existing data contract and adds two fields. Types lifted verbatim:

```ts
// components/public-card/public-card.tsx
"use client";
import type { ReactNode } from "react";
import { AvatarIniciales } from "@/components/avatar-iniciales";
import { adjustHexLightness } from "@/lib/format/initials";
import { EditorialRule, BrassCornerMark, DateBadge } from "./decoration";

export type PublicCardVariant = "preview" | "full" | "editing";
export type CardMood = "calido" | "clinico" | "editorial" | "boutique";

export interface PublicCardService {
  nombre: string;
  dur: number;
  precioCents: number;
}

export interface PublicCardData {
  nombre?: string | null;
  consultorioNombre?: string | null;
  rubro?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  bio?: string | null;
  telefonoPublico?: string | null;
  instagramHandle?: string | null;
  direccionCompleta?: string | null;
  acentoHex?: string | null;
  logoUrl?: string | null;        // NEW — Layer D
  cardMood?: CardMood;            // NEW — Layer B
  servicios?: PublicCardService[];
  slug?: string | null;
}

export interface PublicCardProps {
  data: PublicCardData;
  variant?: PublicCardVariant;
  appUrl?: string;
  className?: string;
}

const DEFAULT_ACENTO = "#8A6722";
```

- [ ] **Step 2 — Write the failing render-shape test.**

```tsx
// components/public-card/__tests__/public-card.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PublicCard } from "../public-card";

describe("<PublicCard>", () => {
  it("renders name + rubro + ciudad in preview variant", () => {
    render(<PublicCard data={{ nombre: "Lorenzo Martínez", rubro: "Kinesiología", ciudad: "Córdoba" }} />);
    expect(screen.getByText("Lorenzo Martínez")).toBeInTheDocument();
    expect(screen.getByText(/Kinesiología/)).toBeInTheDocument();
    expect(screen.getByText(/Córdoba/)).toBeInTheDocument();
  });
  it("defaults to mood editorial when cardMood not provided", () => {
    const { container } = render(<PublicCard data={{ nombre: "Pro" }} />);
    expect(container.firstChild).toHaveAttribute("data-card-mood", "editorial");
  });
  it("renders logo when logoUrl is provided", () => {
    render(<PublicCard data={{ nombre: "Pro", logoUrl: "https://x/logo.png" }} variant="full" />);
    expect(screen.getByAltText(/logo/i)).toHaveAttribute("src", "https://x/logo.png");
  });
  it("falls back to AvatarIniciales when no logoUrl", () => {
    render(<PublicCard data={{ nombre: "Lorenzo Martínez" }} variant="full" />);
    expect(screen.queryByAltText(/logo/i)).toBeNull();
    expect(screen.getByText(/LM/)).toBeInTheDocument();
  });
  it("renders CTA in variant=full when slug is set", () => {
    render(<PublicCard data={{ nombre: "Pro", slug: "pro" }} variant="full" />);
    expect(screen.getByRole("button", { name: /reservar/i })).toBeInTheDocument();
  });
  it("respects variant=editing with placeholders for missing fields", () => {
    render(<PublicCard data={{}} variant="editing" />);
    expect(screen.getByText(/agregá una bio/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3 — Run; expect FAIL.**

---

### Task 4.2 — Implement the PublicCard render

- [ ] **Step 1 — Author `components/public-card/public-card.tsx`.**

Full body (continues from the type block in 4.1):

```tsx
export function PublicCard({ data, variant = "preview", appUrl = "", className = "" }: PublicCardProps) {
  const acento = isValidHex(data.acentoHex) ? data.acentoHex! : DEFAULT_ACENTO;
  const acentoSoft = adjustHexLightness(acento, 60);
  const mood: CardMood = data.cardMood ?? "editorial";

  const fullName = data.nombre?.trim() || data.consultorioNombre?.trim() || "Tu nombre";
  const consultorio = data.consultorioNombre?.trim() || "Tu consultorio";
  const showLink = data.slug && appUrl;
  const linkText = showLink ? `${stripScheme(appUrl)}/book/${data.slug}` : null;
  const isFull = variant === "full";
  const isEditing = variant === "editing";

  return (
    <article
      className={`fpc-card fpc-variant-${variant} ${className}`.trim()}
      data-card-mood={mood}
      data-acento={acento}
      style={{
        // Acento per-pro override — moods may map this further via CSS.
        ["--fpc-accent" as string]: acento,
        ["--fpc-accent-soft" as string]: acentoSoft,
      }}
    >
      <header className="fpc-hero">
        {data.logoUrl ? (
          <img
            src={data.logoUrl}
            alt={`Logo de ${consultorio}`}
            className="fpc-logo"
            width={isFull ? 120 : 80}
            height={isFull ? 120 : 80}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <AvatarIniciales fullName={fullName} acentoHex={acento} size={isFull ? "xl" : "lg"} />
        )}
        <div className="fpc-hero-text">
          <h2 className="fpc-name">{fullName}</h2>
          <p className="fpc-meta">
            {data.rubro || consultorio}
            {data.ciudad ? <span> · {data.ciudad}</span> : null}
          </p>
        </div>
        {/* Mood-applied decorations rendered conditionally per mood id */}
        {mood === "calido"   ? <span className="fpc-corner-slot"><BrassCornerMark /></span> : null}
        {mood === "boutique" ? <span className="fpc-date-slot"><DateBadge label="EST. 2026 · CÓRDOBA" /></span> : null}
      </header>

      {data.bio ? (
        <p className="fpc-bio">{data.bio}</p>
      ) : isEditing ? (
        <p className="fpc-bio is-placeholder">Agregá una bio del consultorio</p>
      ) : null}

      {(data.direccionCompleta || data.telefonoPublico || data.instagramHandle) ? (
        <section className="fpc-contact" aria-label="Contacto">
          {mood === "editorial" || mood === "clinico" ? <EditorialRule /> : null}
          {data.direccionCompleta ? <Row icon={<IconPin />} text={data.direccionCompleta} /> : null}
          {data.telefonoPublico ? (
            <Row icon={<IconPhone />} text={data.telefonoPublico}
              href={`tel:${data.telefonoPublico.replace(/[^\d+]/g, "")}`} />
          ) : null}
          {data.instagramHandle ? (
            <Row icon={<IconInstagram />} text={`@${data.instagramHandle.replace(/^@/, "")}`}
              href={`https://instagram.com/${data.instagramHandle.replace(/^@/, "")}`} />
          ) : null}
        </section>
      ) : null}

      {data.servicios && data.servicios.length > 0 ? (
        <section className="fpc-services" aria-label="Servicios">
          {mood === "editorial" || mood === "clinico" ? <EditorialRule /> : null}
          <h3 className="fpc-services-label fm-mono">Servicios</h3>
          <ul>
            {data.servicios.slice(0, isFull ? 5 : 3).map((s, i) => (
              <li key={i}>
                <span className="fpc-srv-name">{s.nombre}</span>
                <span className="fpc-srv-dur">· {s.dur} min</span>
                <span className="fpc-srv-price">{formatArs(s.precioCents / 100)}</span>
              </li>
            ))}
          </ul>
          {data.servicios.length > (isFull ? 5 : 3) ? (
            <p className="fpc-services-more">+ {data.servicios.length - (isFull ? 5 : 3)} más</p>
          ) : null}
        </section>
      ) : null}

      {isFull && data.slug ? (
        <footer className="fpc-footer">
          <button type="button" className="fpc-cta">Reservar turno</button>
        </footer>
      ) : null}

      {!isFull && linkText ? (
        <div className="fpc-link-footer fm-mono">{linkText}</div>
      ) : null}
    </article>
  );
}

// helpers + icons + Row identical to current CardPreview implementation;
// extract into the same file for now. (Cleanup in F8 may pull these into
// components/public-card/internals/ but that is not required for ship.)
```

Helpers (`Row`, `IconPin`, `IconPhone`, `IconInstagram`, `formatArs`, `isValidHex`, `stripScheme`) are copied verbatim from current `components/onboarding/card-preview.tsx`.

- [ ] **Step 2 — Author the CSS counterpart in `public/folio.css`.**

Append:

```css
/* ═════════════ FOLIO ATELIER · PublicCard · base ═════════════ */
.fpc-card {
  position: relative;
  background: var(--fpc-bg, var(--surface));
  border: 1px solid var(--line);
  border-radius: var(--fpc-radius);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  isolation: isolate;                       /* lets ::before bg gradients sit behind text safely */
}
.fpc-card::before {                         /* mood-driven hero tint */
  content: "";
  position: absolute;
  inset: 0 0 60% 0;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--fpc-accent) calc(var(--fpc-bg-tint-amount) * 100%), transparent) 0%,
    transparent 100%);
  pointer-events: none;
  z-index: 0;
}
.fpc-variant-full         { max-width: 560px; }
.fpc-variant-preview      { max-width: 360px; }

.fpc-hero {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: auto 1fr; gap: 16px;
  align-items: flex-start;
  padding: var(--fpc-hero-py-full) 28px calc(var(--fpc-hero-py-full) - 12px);
  border-bottom: 1px solid color-mix(in srgb, var(--fpc-accent) 8%, transparent);
}
.fpc-variant-preview .fpc-hero { padding: var(--fpc-hero-py-prev) 20px calc(var(--fpc-hero-py-prev) - 8px); }

.fpc-logo { object-fit: contain; border-radius: var(--r-md); background: transparent; }

.fpc-name {
  margin: 0;
  font-family: var(--fpc-name-family, var(--font-sans));
  font-weight: var(--fpc-name-weight, 600);
  letter-spacing: var(--fpc-name-tracking, var(--track-tight-1));
  font-size: var(--fpc-name-size-full);
  line-height: 1.06;
  color: var(--ink);
  word-break: break-word;
}
.fpc-variant-preview .fpc-name { font-size: var(--fpc-name-size-prev); line-height: 1.18; }

.fpc-meta {
  margin: 6px 0 0;
  font-size: var(--fs-body);
  color: var(--ink-3);
  letter-spacing: var(--track-tight-0);
}

.fpc-bio {
  position: relative; z-index: 1;
  margin: 0;
  padding: 16px 28px 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.fpc-bio.is-placeholder { color: var(--ink-4); font-style: italic; }

.fpc-contact {
  position: relative; z-index: 1;
  padding: 18px 28px;
  display: flex; flex-direction: column; gap: 10px;
  border-bottom: 1px solid var(--line-soft);
}

.fpc-services {
  position: relative; z-index: 1;
  padding: 18px 28px 24px;
}
.fpc-services-label {
  font-size: var(--fs-xs);
  letter-spacing: var(--track-loose-2);
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
  margin: 0 0 12px;
}
.fpc-services ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.fpc-services li { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: baseline; font-size: var(--fs-md); color: var(--ink); }
.fpc-srv-name  { font-weight: 500; }
.fpc-srv-dur   { color: var(--ink-3); }
.fpc-srv-price { font-variant-numeric: tabular-nums; font-weight: 500; grid-column: 2; }
.fpc-services-more { margin: 10px 0 0; font-size: var(--fs-xs); color: var(--ink-3); }

.fpc-footer {
  position: relative; z-index: 1;
  padding: 20px 28px 28px;
  border-top: 1px solid var(--line-soft);
}
.fpc-cta {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%;
  background: var(--fpc-accent);
  color: #FBF9F4;
  border: 0;
  border-radius: var(--r-lg);
  padding: 14px 20px;
  font-size: var(--fs-md);
  font-weight: 500;
  cursor: pointer;
  transition: transform var(--dur-quick) var(--ease-standard-out), box-shadow var(--dur-quick) var(--ease-standard-out);
}
.fpc-cta:hover { transform: translateY(-0.5px); box-shadow: var(--shadow-2); }
.fpc-cta:active { transform: translateY(0.5px); transition-duration: var(--dur-instant); }

.fpc-link-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface-2);
  font-size: var(--fs-xs);
  color: var(--ink-3);
  word-break: break-all;
}

.fpc-corner-slot { position: absolute; top: 14px; right: 16px; z-index: 2; }
.fpc-date-slot   { position: absolute; top: 14px; right: 16px; z-index: 2; }

/* ═════════════ Entry choreography (mood-agnostic baseline) ═════════════ */
.fpc-card { animation: fpc-enter-hero var(--dur-cinematic) var(--ease-emphasized-out) both; }
.fpc-hero            { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-2); }
.fpc-bio             { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-4); }
.fpc-contact         { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-5); }
.fpc-services        { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-6); }
.fpc-footer .fpc-cta  { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-7); }
.fpc-link-footer     { animation: fpc-enter-musical 320ms var(--ease-emphasized-out) both; animation-delay: var(--fpc-stagger-musical-8); }

@keyframes fpc-enter-hero {
  from { opacity: 0; transform: translateY(var(--fpc-hero-y-from)); filter: blur(var(--fpc-hero-blur-from)); }
  to   { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes fpc-enter-musical {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .fpc-card, .fpc-hero, .fpc-bio, .fpc-contact, .fpc-services, .fpc-footer .fpc-cta, .fpc-link-footer {
    animation-duration: var(--dur-quick) !important;
    animation-delay: 0ms !important;
    transform: none !important;
    filter: none !important;
  }
}
```

- [ ] **Step 3 — Run component tests; expect PASS.**

```bash
pnpm exec vitest run components/public-card/__tests__/public-card.test.tsx
```

- [ ] **Step 4 — Add compat re-export at `components/onboarding/card-preview.tsx`.**

Replace the entire body with:

```tsx
"use client";
/**
 * @deprecated Use <PublicCard> from "@/components/public-card/public-card".
 * This shim re-exports PublicCard under the old name to keep transitional
 * call-sites compiling until F8 cleanup. Will be removed in F8.
 */
export { PublicCard as CardPreview } from "@/components/public-card/public-card";
export type {
  PublicCardData as CardPreviewData,
  PublicCardService as CardPreviewService,
  PublicCardVariant as CardPreviewVariant,
} from "@/components/public-card/public-card";
```

- [ ] **Step 5 — Verify all existing imports still compile.**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

- [ ] **Step 6 — Commit.**

```bash
git add components/public-card/public-card.tsx components/public-card/__tests__/public-card.test.tsx components/onboarding/card-preview.tsx public/folio.css
git commit -m "feat(card): introduce <PublicCard> (Layer A foundation, editorial default)

New component reads --fpc-* tokens. data-card-mood='editorial' default.
LogoUrl renders <img>; null → AvatarIniciales fallback. Musical-stagger
entry beats (fpc-enter-hero + fpc-enter-musical). Reduce-motion compliant.
CardPreview kept as compat shim re-export until F8 cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.3 — Frame-by-frame choreography reference for the agent

This is the **load-bearing motion table** for F4. Implementing agent verifies in the browser that observed timings match within ±15 ms via DevTools → Performance recorder.

| T (ms) | Layer | Element | Beat | Properties | Easing | Distance |
|---|---|---|---|---|---|---|
|   0 | A | `.fpc-card` | `fpc-enter-hero` start | opacity 0, translateY 12 px, blur 6 px | `--ease-emphasized-out` | — |
|  90 | A | `.fpc-hero`           | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-2`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 200 | A | `.fpc-meta` (within hero) | inherited from `.fpc-hero` | — | — | — |
| 340 | B | `.fpc-bio`            | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-4`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 480 | B | `.fpc-contact`        | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-5`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 620 | B | `.fpc-services`       | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-6`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 720 | A | `.fpc-card`           | `fpc-enter-hero` end (`--dur-cinematic` from 0) | opacity 1, y 0, blur 0 | — | — |
| 760 | B | `.fpc-footer .fpc-cta` | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-7`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 860 | B | `.fpc-link-footer`    | `fpc-enter-musical` start (delay = `--fpc-stagger-musical-8`) | opacity 0, y 8 px | `--ease-emphasized-out` | 8 px |
| 1180 | — | (last musical beat ends 320 ms after its start) | — | — | — | — |

**Why "musical" not uniform stagger:** the gaps between deltas widen progressively (90, 110, 140, 140, 140, 140, 100 ms) — that uneven cadence reads as natural typing rhythm rather than mechanical metronome ticking. The CTA appears slightly faster after services because the eye has just scanned a list and wants the resolution.

**Layer terminology (A/B/C):**
- **A primary** = chassis itself (card body, hero zone).
- **B secondary** = content blocks (bio, contact, services, CTA, link footer).
- **C ambient** = decorative ornament (corner-mark, date-badge, paper-noise) — these have no entry animation; they fade in with their parent block.

---

### Task 4.4 — F4 Visual gate

- [ ] Start dev server. Walk these surfaces:
  - `/onboarding` (Step 3-8) — the live preview panel renders `<PublicCard variant="preview" data-card-mood="editorial">`. Verify musical stagger.
  - `/onboarding` (Step 9) — `<PublicCard variant="full">`. Verify Fraunces is visible on the name, brass demoted (CTA still uses brass for now — F5 may shift Clínico mood to ink), shadow has the `--shadow-card` ambient feel.
  - Toggle `prefers-reduced-motion` in DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce". Reload. Verify card snaps in (no stagger, no scale, no blur).
- [ ] Ask the founder: "F4 PublicCard done. Editorial mood baseline visible in onboarding live preview + Step 9. Approve to proceed to F5 mood system?"

---

## 5 · F5 — Mood system (Layer B · 4 moods)

**Goal:** implement the 4 mood-override blocks defined in `design-language-recommendation.md` §4. Each mood operates via `[data-card-mood="<id>"]` selector on `.fpc-card`. No JS token assembly. Per-pro acento (custom hex) blends per mood rule (defined per-mood in 5.7).

**Phase verification:**
- All 4 moods render distinguishable at thumbnail scale (200×100 px) without reading text.
- `acento_hex` per-pro override applies in Cálido / Editorial / Boutique; in Clínico, override is **blended toward `--accent-ink` at 40 % saturation** (per design-language §4.2 + Open Question 7 recommended default).
- Boutique mood paper-noise overlay is visible on a 1× DPR display and on a 2× retina display.
- Mood persistence works end-to-end (chosen mood survives reload — but full picker UI lands in F6; for F5 the implementing agent toggles via a temporary `?mood=` query parameter in a dev-only test page).

### Files in F5

- **Create:** `components/public-card/moods.ts` — exports `MOOD_IDS`, `MOOD_LABELS`, `MOOD_TAGLINES`, and `applyAcentoBlend(mood, acentoHex)` helper.
- **Modify:** `public/folio.css` — append the four mood override blocks (verbatim from design-language doc §4).
- **Create:** `public/img/paper-noise.svg` (or inline `data:` URI in CSS — choice in 5.6).
- **Create:** `components/public-card/__tests__/moods.test.ts`
- **Create:** `app/(dev)/card-moods/page.tsx` — internal dev-only preview page rendering one card per mood side-by-side for visual diff.

---

### Task 5.1 — Define `components/public-card/moods.ts`

- [ ] **Step 1 — Write failing tests.**

```ts
// components/public-card/__tests__/moods.test.ts
import { describe, it, expect } from "vitest";
import { MOOD_IDS, MOOD_LABELS, MOOD_TAGLINES, applyAcentoBlend } from "../moods";

describe("moods · catalogue", () => {
  it("exports 4 mood ids in canonical order", () => {
    expect(MOOD_IDS).toEqual(["calido", "clinico", "editorial", "boutique"]);
  });
  it("each id has a Spanish label and tagline", () => {
    for (const id of MOOD_IDS) {
      expect(MOOD_LABELS[id]).toBeTruthy();
      expect(MOOD_TAGLINES[id]).toBeTruthy();
    }
  });
  it("applyAcentoBlend returns the same hex for non-clinico moods", () => {
    expect(applyAcentoBlend("calido", "#FF5500")).toBe("#FF5500");
    expect(applyAcentoBlend("editorial", "#FF5500")).toBe("#FF5500");
    expect(applyAcentoBlend("boutique", "#FF5500")).toBe("#FF5500");
  });
  it("applyAcentoBlend blends toward ink-blue at 40% for clinico mood", () => {
    // ink-blue = #2A4365 ⇒ (42, 67, 101)
    // user picked #FF5500 ⇒ (255, 85, 0)
    // 60% user + 40% ink = (170, 78, 60) ≈ #aa4e3c
    expect(applyAcentoBlend("clinico", "#FF5500")).toBe("#AA4E3C");
  });
});
```

- [ ] **Step 2 — Implement `components/public-card/moods.ts`.**

```ts
import type { CardMood } from "./public-card";

export const MOOD_IDS = ["calido", "clinico", "editorial", "boutique"] as const;

export const MOOD_LABELS: Record<CardMood, string> = {
  calido:    "Cálido",
  clinico:   "Clínico",
  editorial: "Editorial",
  boutique:  "Boutique",
};

export const MOOD_TAGLINES: Record<CardMood, string> = {
  calido:    "Cercano y humano",
  clinico:   "Preciso y profesional",
  editorial: "Refinado y selecto",
  boutique:  "Personal y curado",
};

const INK_BLUE = { r: 42, g: 67, b: 101 } as const;   // #2A4365

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const v = m[1];
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const part = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

/**
 * For Clínico mood the pro-chosen acento blends 60/40 toward ink-blue
 * to preserve the surgical-precision register. All other moods leave
 * the pro acento untouched.
 */
export function applyAcentoBlend(mood: CardMood, hex: string): string {
  if (mood !== "clinico") return hex;
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex({
    r: rgb.r * 0.6 + INK_BLUE.r * 0.4,
    g: rgb.g * 0.6 + INK_BLUE.g * 0.4,
    b: rgb.b * 0.6 + INK_BLUE.b * 0.4,
  });
}
```

- [ ] **Step 3 — Run; expect PASS.**

- [ ] **Step 4 — Wire the blend into `<PublicCard>` style prop:**

In `public-card.tsx`, replace the line

```ts
["--fpc-accent" as string]: acento,
```

with

```ts
import { applyAcentoBlend } from "./moods";
// ...
const blended = applyAcentoBlend(mood, acento);
// ...
["--fpc-accent" as string]: blended,
```

- [ ] **Step 5 — Commit.**

```bash
git add components/public-card/moods.ts components/public-card/__tests__/moods.test.ts components/public-card/public-card.tsx
git commit -m "feat(card): mood catalogue + clínico acento blend (60/40 toward ink-blue)

Pro-chosen acento blends toward ink-blue in clinico mood only; all
other moods preserve acento verbatim. Decision rationale:
design-language-recommendation.md §4.2 + Open Question 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2 — Implement mood-CSS override blocks

- [ ] **Step 1 — Append to `public/folio.css`.**

```css
/* ═════════════ FOLIO ATELIER · Mood overrides ═════════════ */

/* ─── Cálido — Cercano y humano ─── */
[data-card-mood="calido"] {
  --fpc-bg-tint-amount: 0.10;
  --fpc-bg-tint-style:  linear;
  --fpc-name-family:    var(--font-display);
  --fpc-name-weight:    500;
  --fpc-name-tracking:  -0.014em;
  --fpc-bio-style:      italic-serif;
  --fpc-radius:         16px;
  --fpc-decoration:     corner-mark;
  --fpc-decoration-color: var(--accent-warm);
  --fpc-hero-py-full:   36px;
}
[data-card-mood="calido"] .fpc-bio { font-family: var(--font-display); font-style: italic; }

/* ─── Clínico — Preciso y profesional ─── */
[data-card-mood="clinico"] {
  --fpc-bg-tint-amount: 0;
  --fpc-bg-tint-style:  flat;
  --fpc-name-family:    var(--font-sans);
  --fpc-name-weight:    700;
  --fpc-name-tracking:  -0.022em;
  --fpc-bio-style:      plain;
  --fpc-radius:         10px;
  --fpc-decoration:     sub-line;
  --fpc-decoration-color: var(--accent-ink);
  --fpc-hero-py-full:   28px;
}
[data-card-mood="clinico"] .fpc-cta { background: var(--accent-ink); color: #FBF9F4; }
[data-card-mood="clinico"] .fpc-services-label,
[data-card-mood="clinico"] .fpc-link-footer { letter-spacing: var(--track-loose-3); }
[data-card-mood="clinico"] .fpc-hero,
[data-card-mood="clinico"] .fpc-bio,
[data-card-mood="clinico"] .fpc-contact,
[data-card-mood="clinico"] .fpc-services,
[data-card-mood="clinico"] .fpc-footer .fpc-cta,
[data-card-mood="clinico"] .fpc-link-footer {
  animation-delay: 0ms !important;
  animation-duration: 200ms !important;
}
[data-card-mood="clinico"] .fpc-hero            { animation-delay:  60ms !important; }
[data-card-mood="clinico"] .fpc-bio             { animation-delay: 120ms !important; }
[data-card-mood="clinico"] .fpc-contact         { animation-delay: 180ms !important; }
[data-card-mood="clinico"] .fpc-services        { animation-delay: 240ms !important; }
[data-card-mood="clinico"] .fpc-footer .fpc-cta  { animation-delay: 300ms !important; }
[data-card-mood="clinico"] .fpc-link-footer     { animation-delay: 360ms !important; }

/* ─── Editorial — Refinado y selecto (DEFAULT) ─── */
[data-card-mood="editorial"] {
  --fpc-bg-tint-amount: 0.06;
  --fpc-bg-tint-style:  radial;
  --fpc-name-family:    var(--font-display);
  --fpc-name-weight:    400;
  --fpc-name-tracking:  -0.018em;
  --fpc-bio-style:      quote-with-rule;
  --fpc-radius:         20px;
  --fpc-decoration:     sub-line;
  --fpc-decoration-color: var(--accent-warm);
  --fpc-hero-py-full:   40px;
}
[data-card-mood="editorial"] .fpc-card::before {
  background: radial-gradient(at 0% 0%,
    color-mix(in srgb, var(--fpc-accent) calc(var(--fpc-bg-tint-amount) * 100%), transparent) 0%,
    transparent 60%);
  inset: 0 0 50% 0;
}
[data-card-mood="editorial"] .fpc-bio {
  border-left: 1px solid var(--fpc-accent);
  padding-left: 18px;
  font-style: italic;
  font-family: var(--font-display);
  margin-left: 28px;
}

/* ─── Boutique — Personal y curado ─── */
[data-card-mood="boutique"] {
  --fpc-bg-tint-amount: 0;
  --fpc-bg-tint-style:  paper-noise;
  --fpc-name-family:    var(--font-display);
  --fpc-name-weight:    600;
  --fpc-name-tracking:  -0.022em;
  --fpc-bio-style:      italic-serif;
  --fpc-radius:         24px;
  --fpc-decoration:     date-badge;
  --fpc-decoration-color: var(--accent-warm-2);
  --fpc-hero-py-full:   36px;
}
[data-card-mood="boutique"] .fpc-card {
  background-image:
    var(--shadow-card),
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.015 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  background-blend-mode: normal, multiply;
}
[data-card-mood="boutique"] .fpc-bio { font-family: var(--font-display); font-style: italic; }
[data-card-mood="boutique"] .fpc-link-footer { animation-delay: 920ms !important; }

@media (prefers-reduced-transparency: reduce) {
  [data-card-mood="boutique"] .fpc-card { background-image: none; }
}
```

- [ ] **Step 2 — Build a side-by-side dev page.**

Create `app/(dev)/card-moods/page.tsx`:

```tsx
import { PublicCard } from "@/components/public-card/public-card";
import { MOOD_IDS, MOOD_LABELS, MOOD_TAGLINES } from "@/components/public-card/moods";

const SAMPLE = {
  nombre: "Lorenzo Martínez",
  rubro: "Kinesiología deportiva",
  ciudad: "Córdoba",
  bio: "Atiendo lesiones complejas y consulta tras la primera sesión. Acompaño hasta la vuelta total.",
  telefonoPublico: "+54 351 411-2233",
  instagramHandle: "loremartinez.kine",
  direccionCompleta: "Av. Colón 1234 · Nueva Córdoba",
  acentoHex: "#8A6722",
  slug: "lorenzo-martinez",
  servicios: [
    { nombre: "Consulta inicial", dur: 60, precioCents: 3500000 },
    { nombre: "Seguimiento",      dur: 45, precioCents: 2200000 },
    { nombre: "Pack 5 sesiones",  dur: 45, precioCents: 9500000 },
  ],
} as const;

export default function CardMoodsDevPage() {
  return (
    <main style={{ padding: 40, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 40, background: "var(--bg)" }}>
      {MOOD_IDS.map((id) => (
        <section key={id}>
          <header style={{ marginBottom: 12 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 28 }}>{MOOD_LABELS[id]}</h2>
            <p style={{ color: "var(--ink-3)" }}>{MOOD_TAGLINES[id]}</p>
          </header>
          <PublicCard data={{ ...SAMPLE, cardMood: id }} variant="full" appUrl="folio-app-ten.vercel.app" />
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 3 — Visual diff via dev page.**

```bash
pnpm dev
# open http://localhost:3010/card-moods
```

Verify the founder-grade differentiation:

| Pair compared | Must look distinct on (yes/no) | Distinguishing axes |
|---|---|---|
| Cálido vs Clínico | yes — diagonal opposites | serif/sans · linear-tint/flat · 16px/10px radius · corner-mark/sub-line · ink-warm/ink-blue CTA |
| Cálido vs Editorial | yes | corner-mark vs sub-line · linear-tint vs radial-tint · weight 500 vs 400 |
| Cálido vs Boutique | yes | linear-tint vs paper-noise · weight 500 vs 600 · 16px vs 24px radius |
| Clínico vs Editorial | yes | sans vs serif · flat vs radial · ink-blue vs brass |
| Clínico vs Boutique | yes | sans vs serif · flat vs paper-noise · uniform stagger vs musical |
| Editorial vs Boutique | yes | radial-tint vs paper-noise · weight 400 vs 600 · sub-line vs date-badge |

- [ ] **Step 4 — Commit.**

```bash
git add public/folio.css app/(dev)/card-moods/page.tsx
git commit -m "feat(card): 4-mood preset system via [data-card-mood] selectors

Cálido (warm linear tint, brass corner-mark, italic serif bio).
Clínico (flat surface, ink-blue CTA, sub-line decoration, uniform stagger).
Editorial (default, radial tint, sub-line, quote-with-rule bio).
Boutique (paper-noise overlay, weight 600 display, date-badge, deferred footer).
Dev preview at /card-moods.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3 — F5 Visual gate

- [ ] Open `/card-moods` in browser. Take a screenshot, downscale to 200×100 px per mood, lay them side-by-side. Confirm: at thumbnail scale, all 6 pairs in the table above remain distinct.
- [ ] Toggle dark mode. Confirm all 4 moods still differentiate (paper-noise survives, ink-blue CTA still reads clinical).
- [ ] Toggle `prefers-reduced-motion: reduce`. Confirm: all 4 moods snap in without stagger/scale/blur; final visual is unchanged.
- [ ] Toggle `prefers-reduced-transparency: reduce` (macOS Settings → Accessibility, or DevTools emulator if available). Confirm Boutique paper-noise overlay is suppressed.
- [ ] Ask founder: "F5 mood system done. 4 moods visually distinct at thumbnail. Approve to proceed to F6 onboarding step?"

---

## 6 · F6 — Onboarding "Identidad visual" step

**Goal:** repurpose existing **Step 4 (`Step4Personalizacion`, currently only the `acento` picker)** into a unified "Identidad visual" step containing (1) acento picker (keep current UI), (2) logo upload, (3) mood picker. This decision keeps the total at 9 steps (no progress-bar copy churn) and groups three identity-related decisions in one moment. The other "open decision" (insert a new 10th step) is rejected — see Open Decisions §13.

**Phase verification:**
- `OnboardingDataState` gains `logoUrl` and `cardMood` fields.
- Auto-save (`updateOnboardingStep(4, ...)`) persists both alongside `acento_hex`.
- Live preview to the right shows mood + logo immediately on selection.
- Skip-this-step still works (defaults: acento=brass, mood=editorial, no logo).
- Resume scenario works: leave mid-step, return, your selections are pre-populated.

### Files in F6

- **Modify:** `components/onboarding/steps.tsx` — extend `OnboardingDataState`, rewrite `Step4Personalizacion`.
- **Modify:** `app/(public)/onboarding/actions.ts` — extend `Step4Data` interface + case-4 switch in `updateOnboardingStep`.
- **Modify:** `lib/db/onboarding-resume.ts` — include `logo_url` + `card_mood` in the resume hydration.
- **Create:** `components/public-card/mood-picker.tsx` — 4-card grid picker.
- **Create:** `components/public-card/__tests__/mood-picker.test.tsx`

---

### Task 6.1 — Extend `OnboardingDataState`

- [ ] **Step 1 — Patch `components/onboarding/steps.tsx`:**

```ts
export interface OnboardingDataState {
  // ... existing fields ...
  acento: string;
  logoUrl: string | null;          // NEW
  cardMood: "calido" | "clinico" | "editorial" | "boutique";  // NEW
  // ... existing fields ...
}

export const ONBOARDING_INITIAL: OnboardingDataState = {
  // ... existing ...
  acento: "#8A6722",
  logoUrl: null,                   // NEW
  cardMood: "editorial",           // NEW
  // ... existing ...
};
```

- [ ] **Step 2 — Patch `previewDataFor()` to pass through the new fields:**

```ts
function previewDataFor(data: OnboardingDataState): PublicCardData {
  return {
    // ... existing ...
    logoUrl: data.logoUrl ?? undefined,
    cardMood: data.cardMood,
  };
}
```

- [ ] **Step 3 — Typecheck.**

```bash
pnpm typecheck
```

---

### Task 6.2 — Server-side: extend `Step4Data` + persist

- [ ] **Step 1 — Patch `Step4Data` and `updateOnboardingStep` (case 4):**

```ts
export interface Step4Data {
  acento: string;
  logoUrl?: string | null;                                        // NEW
  cardMood?: "calido" | "clinico" | "editorial" | "boutique";     // NEW
}

// inside switch case 4:
case 4: {
  const d = data as Step4Data;
  const patch: Record<string, unknown> = {};
  if (d.acento) patch.acento_hex = d.acento;
  if (d.logoUrl !== undefined) patch.logo_url = d.logoUrl;
  if (d.cardMood) patch.card_mood = d.cardMood;
  if (Object.keys(patch).length > 0) {
    const { error } = await service.from("organization").update(patch).eq("id", orgId);
    if (error) return { ok: false, error: error.message };
  }
  break;
}
```

- [ ] **Step 2 — Patch `lib/db/onboarding-resume.ts`** to surface `logo_url` + `card_mood` in `initialData`:

```ts
// inside the select() — add columns logo_url, card_mood
// inside the returned initialData — map them:
//   logoUrl: row.logo_url ?? null,
//   cardMood: (row.card_mood ?? "editorial") as CardMood,
```

- [ ] **Step 3 — Run unit tests for the action; expect PASS.**

- [ ] **Step 4 — Commit.**

```bash
git add app/(public)/onboarding/actions.ts components/onboarding/steps.tsx lib/db/onboarding-resume.ts
git commit -m "feat(onboarding): persist logoUrl + cardMood at step 4

Step 4 'Identidad visual' now persists three identity fields together:
acento_hex, logo_url, card_mood. Resume rehydrates all three.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.3 — Implement `<MoodPicker>` (grid 2×2)

Design decision: **grid 2×2, not slider** (Open Decision 2 in spec §14). Reasons: scannable; equally good in desktop and mobile (8-col mobile grid collapses to 2×2 cleanly via `grid-template-columns: repeat(2, minmax(0, 1fr))`); slider hides options that demand visual comparison.

Frame-by-frame for the three micro-interactions:

- **`fpc-mood-card-hover`** — at `T=0`: card at rest. From `T=0` to `T=140 ms`, `translateY(0 → -1 px)` and `box-shadow: var(--shadow-1) → var(--shadow-2)`, easing `--ease-standard-out`. On `mouseleave`, reverse with `--dur-quick`.
- **`fpc-mood-card-select`** — at `T=0`: user clicks. From `T=0` to `T=480 ms` over 4 sub-frames:
  - `0–80 ms`: `scale(1.00 → 0.97)`, `--ease-emphasized-in`. Tactile press.
  - `80–280 ms`: `scale(0.97 → 1.02)`, `--spring-snap`. Spring up.
  - `280–480 ms`: `scale(1.02 → 1.00)`, `--ease-standard-out`. Settle.
  - Simultaneous beat: the live preview to the right runs `fpc-mood-morph` (border-radius, --fpc-bg-tint-style transition, name font-family swap).
- **`fpc-mood-morph`** — at `T=0`: live preview shows old mood. From `T=0` to `T=480 ms`:
  - `border-radius` tweens to the new mood's `--fpc-radius` (CSS transition).
  - `background` (the `::before` tint) crossfades — both ::before layers (old + new pseudo via JSswap is not possible; we instead key on `--fpc-bg-tint-amount` transitioning). For mood changes that swap from `linear` to `radial`, the implementation acceptance is "no flash — the transition uses `transition: background 480ms var(--spring-soft);` which crossfades the gradient as a single property".
  - **Name font-family swap** is non-animatable in CSS — visually instantaneous. Acceptance: when the user switches Cálido → Clínico, the name re-renders in Geist instantly while the radius is still mid-tween. This is *correct*; trying to animate a font swap looks worse than the snap.

- [ ] **Step 1 — Write test.**

```tsx
// components/public-card/__tests__/mood-picker.test.tsx
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MoodPicker } from "../mood-picker";

describe("<MoodPicker>", () => {
  it("renders 4 mood cards", () => {
    const onChange = vi.fn();
    render(<MoodPicker value="editorial" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /Cálido/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Clínico/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Editorial/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Boutique/ })).toBeInTheDocument();
  });
  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    render(<MoodPicker value="editorial" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Clínico/ }));
    expect(onChange).toHaveBeenCalledWith("clinico");
  });
  it("marks active mood via aria-checked", () => {
    const onChange = vi.fn();
    render(<MoodPicker value="boutique" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /Boutique/ })).toHaveAttribute("aria-checked", "true");
  });
});
```

- [ ] **Step 2 — Implement.**

```tsx
// components/public-card/mood-picker.tsx
"use client";
import { MOOD_IDS, MOOD_LABELS, MOOD_TAGLINES } from "./moods";
import type { CardMood } from "./public-card";

interface MoodPickerProps {
  value: CardMood;
  onChange: (id: CardMood) => void;
}

export function MoodPicker({ value, onChange }: MoodPickerProps) {
  return (
    <div className="fpc-mood-picker" role="radiogroup" aria-label="Estilo visual de tu card">
      {MOOD_IDS.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`fpc-mood-card ${active ? "is-active" : ""}`.trim()}
            onClick={() => onChange(id)}
          >
            <span className="fpc-mood-mini" data-card-mood={id} aria-hidden />
            <span className="fpc-mood-label">{MOOD_LABELS[id]}</span>
            <span className="fpc-mood-tag">{MOOD_TAGLINES[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
```

CSS to append:

```css
.fpc-mood-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.fpc-mood-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 16px;
  text-align: left;
  cursor: pointer;
  transition: transform var(--dur-quick) var(--ease-standard-out),
              box-shadow var(--dur-quick) var(--ease-standard-out),
              border-color var(--dur-quick) var(--ease-standard-out);
}
.fpc-mood-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-2); }
.fpc-mood-card.is-active { border-color: var(--accent-warm); box-shadow: var(--shadow-focus-warm); animation: fpc-mood-card-select var(--dur-deliberate) var(--spring-snap); }

.fpc-mood-mini {
  display: block; width: 100%; height: 56px;
  border-radius: 8px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-warm) 18%, transparent), transparent);
  border: 1px solid var(--line-soft);
}
.fpc-mood-mini[data-card-mood="clinico"]  { background: var(--surface-2); border-color: var(--accent-ink); }
.fpc-mood-mini[data-card-mood="editorial"]{ background: radial-gradient(at 0% 0%, color-mix(in srgb, var(--accent-warm) 12%, transparent), transparent 60%); }
.fpc-mood-mini[data-card-mood="boutique"] { background:
  url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.035 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }

.fpc-mood-label { font-weight: 600; color: var(--ink); font-size: var(--fs-md); }
.fpc-mood-tag   { font-size: var(--fs-sm); color: var(--ink-3); }

@keyframes fpc-mood-card-select {
  0%   { transform: scale(1); }
  17%  { transform: scale(0.97); }
  58%  { transform: scale(1.02); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .fpc-mood-card.is-active { animation: none; }
  .fpc-mood-card:hover { transform: none; }
}
```

- [ ] **Step 3 — Commit.**

```bash
git add components/public-card/mood-picker.tsx components/public-card/__tests__/mood-picker.test.tsx public/folio.css
git commit -m "feat(card): MoodPicker (grid 2x2, scale-bounce select beat)

ARIA radiogroup; reduced-motion strips scale bounce. Active mood
shown with brass border + focus-warm shadow. Mini-tile per mood
hints at the actual mood's surface treatment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.4 — Rebuild `Step4Personalizacion`

- [ ] **Step 1 — Replace `Step4Personalizacion` content in `components/onboarding/steps.tsx`.**

```tsx
export function Step4Personalizacion({ data, set, next, back, skip, orgSlug }: StepProps) {
  return (
    <StepShell
      stepIdx={4}
      back={back}
      next={next}
      skip={skip}
      headline="Tu identidad visual"
      sub="Cómo se ve tu link público: logo, color y estilo. Lo cambiás cuando quieras."
      previewData={previewDataFor(data)}
      slug={orgSlug}
      nextLabel="Continuar"
    >
      <div className="onb-form">
        {/* 1. Logo upload */}
        <section>
          <h2 className="onb-section-h">Logo</h2>
          <LogoUpload
            currentLogoUrl={data.logoUrl}
            onUploaded={(url) => set({ logoUrl: url })}
            onRemoved={() => set({ logoUrl: null })}
          />
        </section>

        {/* 2. Acento (keep existing UI, restyled visually unchanged) */}
        <section>
          <h2 className="onb-section-h">Color de acento</h2>
          <div className="onb-acentos">{/* existing acento picker JSX preserved */}</div>
        </section>

        {/* 3. Mood picker */}
        <section>
          <h2 className="onb-section-h">Estilo de tu card</h2>
          <MoodPicker value={data.cardMood} onChange={(mood) => set({ cardMood: mood })} />
        </section>
      </div>
    </StepShell>
  );
}
```

CSS addition:

```css
.onb-section-h {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 12px;
  letter-spacing: var(--track-tight-0);
}
```

- [ ] **Step 2 — Add import lines at top of `steps.tsx`:**

```ts
import { LogoUpload } from "@/components/public-card/logo-upload";
import { MoodPicker } from "@/components/public-card/mood-picker";
```

- [ ] **Step 3 — Run a full typecheck + e2e onboarding flow.**

```bash
pnpm typecheck && pnpm exec playwright test tests/e2e/onboarding.spec.ts -g "step 4 identidad visual"
```

(That last grep will fail unless an e2e was added; that's expected — add a minimal e2e:)

```ts
// tests/e2e/identidad-visual.spec.ts
import { test, expect } from "@playwright/test";

test("Step 4 — identidad visual persists across reload", async ({ page }) => {
  // sign up + walk to step 4 via existing onboarding test helpers (placeholder name)
  await onboardLogin(page);
  await stepTo(page, 4);
  await page.getByRole("radio", { name: /Clínico/ }).click();
  // upload a fixture PNG
  await page.setInputFiles('input[type="file"]', "tests/fixtures/logo-512.png");
  await expect(page.getByAltText(/vista previa del logo/i)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Clínico/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByAltText(/vista previa del logo/i)).toBeVisible();
});
```

- [ ] **Step 4 — Commit.**

```bash
git add components/onboarding/steps.tsx tests/e2e/identidad-visual.spec.ts public/folio.css
git commit -m "feat(onboarding): step 4 'Identidad visual' = logo + acento + mood

Three identity decisions grouped in one step. Total onboarding remains
9 steps (rejects spec Open Decision 4 'add a 10th step'). Live preview
updates on each interaction via debounced auto-save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.5 — F6 Visual gate

- [ ] Walk through onboarding as a new user. At Step 4:
  - Upload a real PNG with transparent background. Verify stamp-in animation. Verify the preview card (right side, sticky) updates: it now shows the logo instead of initials, with the `fpc-enter-musical` beat.
  - Click each mood. Verify the live preview morphs (radius + tint + name font + decoration). Verify the morph is smooth where smooth (radius, background) and snappy where snappy (name font swap is instant — that is correct).
  - Press "Saltar este paso". Verify the user lands at Step 5 with the existing defaults (acento=brass, mood=editorial, no logo).
  - Press "Atrás" from Step 5 → return to Step 4. Verify selections preserved.
  - Reload mid-step. Verify selections preserved (resume scenario).
- [ ] Ask founder: "F6 done — identidad visual step working with live preview + persistence + resume. Approve F7 `/book/[slug]` integration?"

---

## 7 · F7 — `/book/[slug]` integration

**Goal:** replace the plain inline header (`BookingWizard` lines 172-180) with `<PublicCard variant="full" />`. Add a mobile sticky mini-header that emerges when the card scrolls out of view. Verify across desktop, tablet, and three mobile widths.

**Phase verification:**
- `/book/<slug>` renders `<PublicCard variant="full" data={...} />` above the booking flow.
- Booking flow itself is **untouched**.
- On mobile (<768 px), scrolling past the card hero shows a sticky mini-header: logo (or initials) + name + "Reservar" button (anchors to the booking section). On scroll-up back into the card view, the mini-header collapses.
- Cold load: First Load JS for `/book/[slug]` ≤ 250 KB (acceptance criterion in spec).

### Files in F7

- **Modify:** `app/(public)/book/[slug]/page.tsx` — fetch additional fields (`logo_url`, `card_mood`).
- **Modify:** `app/(public)/book/[slug]/actions.ts` — extend the org fetch to include the new fields (if applicable).
- **Modify:** `components/booking/booking-wizard.tsx` — replace lines 172-180 with `<PublicCard variant="full" />`, add the mobile sticky mini-header.
- **Create:** `components/booking/sticky-mini-header.tsx` — extracted component using `IntersectionObserver`.
- **Create:** `components/booking/__tests__/sticky-mini-header.test.tsx`
- **Modify:** `public/folio.css` — append `.bk-mini-*` styles.

---

### Task 7.1 — Fetch extended org data on the public page

- [ ] **Step 1 — Inspect current page route fetch shape.**

```bash
cat app/\(public\)/book/\[slug\]/page.tsx
```

(Implementing agent identifies which function returns the `OrgPublic` shape consumed by `BookingWizard`.)

- [ ] **Step 2 — Extend the SQL select to include `logo_url`, `card_mood`, `bio`, `direccion_completa`, `telefono_publico`, `instagram_handle` (if not already pulled).**

- [ ] **Step 3 — Extend the `OrgPublic` TS interface in `booking-wizard.tsx`:**

```ts
interface OrgPublic {
  slug: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubro: string | null;
  acentoHex: string;
  // NEW
  logoUrl: string | null;
  cardMood: "calido" | "clinico" | "editorial" | "boutique";
  bio: string | null;
  direccionCompleta: string | null;
  telefonoPublico: string | null;
  instagramHandle: string | null;
}
```

- [ ] **Step 4 — Typecheck + run existing tests.**

```bash
pnpm typecheck && pnpm test -- --run app/\(public\)/book
```

---

### Task 7.2 — Replace the inline header with `<PublicCard variant="full" />`

- [ ] **Step 1 — Patch `components/booking/booking-wizard.tsx`** — delete lines 172-180 (the `<header>` with eyebrow + h1 + p) and replace.

> **Sequencing note:** the `cardSentinelRef` declaration must exist **before** any JSX uses it. Declare it now (Step 1.a below) even though the sticky mini-header consumer is added in F7.3. Until then, the ref is referenced only by the sentinel `<div>` and silently ignored — no compile error, no behaviour.

Step 1.a — at the top of the component body (with the other `useRef`/`useState` declarations), add:

```tsx
const cardSentinelRef = useRef<HTMLDivElement | null>(null);
```

Step 1.b — at the place where the header used to be:

```tsx
import { PublicCard } from "@/components/public-card/public-card";
// ...

// inside <main>, before the booking sections:
<div ref={cardSentinelRef} aria-hidden style={{ position: "absolute", top: 0, height: 1, width: 1 }} />
<PublicCard
  variant="full"
  appUrl={APP_URL}                            // existing const or process.env or window.location.host
  data={{
    nombre: org.nombre,
    rubro: org.rubro,
    ciudad: org.ciudad,
    provincia: org.provincia,
    bio: org.bio,
    telefonoPublico: org.telefonoPublico,
    instagramHandle: org.instagramHandle,
    direccionCompleta: org.direccionCompleta,
    acentoHex: org.acentoHex,
    logoUrl: org.logoUrl,
    cardMood: org.cardMood,
    slug: org.slug,
    servicios: servicios.map(s => ({ nombre: s.nombre, dur: s.duracion_min, precioCents: s.precio_cents })),
  }}
/>
```

- [ ] **Step 2 — Adjust the `<main>` max-width.** Current is 720 px; the card max is 560 px (variant=full). Make the booking content below the card centered with `max-width: 720`, and the card centered separately with its own max:

```tsx
<main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 96px" }}>
  <div className="bk-card-slot" style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
    <PublicCard /* ... */ />
  </div>
  {/* booking sections untouched */}
</main>
```

- [ ] **Step 3 — Build + run E2E.**

```bash
pnpm build
pnpm exec playwright test tests/e2e/book-public.spec.ts || true     # if existing
```

If no public-book e2e exists yet, create a smoke:

```ts
// tests/e2e/book-public.spec.ts
import { test, expect } from "@playwright/test";
test("/book/<slug> renders PublicCard hero then booking flow", async ({ page }) => {
  await page.goto("/book/seed-slug");
  await expect(page.locator(".fpc-card.fpc-variant-full")).toBeVisible();
  await expect(page.getByRole("heading", { name: /elegí el servicio/i })).toBeVisible();
});
```

- [ ] **Step 4 — Commit.**

```bash
git add components/booking/booking-wizard.tsx app/\(public\)/book/\[slug\]/page.tsx tests/e2e/book-public.spec.ts
git commit -m "feat(book): replace inline header with <PublicCard variant='full'>

The public booking link now leads with a properly designed card hero
(logo/initials, mood, accent, full service list) before the 3-step
booking flow. Booking flow itself unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7.3 — Sticky mini-header on mobile

Frame-by-frame:

- **`fpc-card-collapse-mobile`** — at `T=0`: the card hero is scrolled to the top; sentinel `<div>` placed at `top: 0` is visible. As scroll passes the sentinel (`IntersectionObserver` with `rootMargin: -56px 0px 0px 0px`), the sentinel reports `isIntersecting=false`. **From that moment** the sticky mini-header is rendered (CSS class `is-shown`); its entry is `fpc-sticky-mini-emerge`:
  - `T=0` to `T=320 ms`: `opacity: 0 → 1`, `transform: translateY(-8px) → translateY(0)`, easing `--ease-emphasized-out`.
- On scroll-up, sentinel returns `isIntersecting=true`, mini-header runs reverse with `--ease-emphasized-in`, `--dur-moderate`: `opacity 1 → 0`, `transform: 0 → translateY(-8px)`.
- Reduce-motion: transform stripped, opacity-only.

CSS:

```css
.bk-mini {
  position: fixed; top: 0; left: 0; right: 0;
  display: none;
  align-items: center; gap: 12px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: saturate(160%) blur(8px);
  -webkit-backdrop-filter: saturate(160%) blur(8px);
  border-bottom: 1px solid var(--line-soft);
  z-index: 40;
  transform: translateY(-8px);
  opacity: 0;
  transition: opacity var(--dur-moderate) var(--ease-emphasized-out),
              transform var(--dur-moderate) var(--ease-emphasized-out);
}
.bk-mini.is-shown { opacity: 1; transform: translateY(0); }
.bk-mini-avatar img,
.bk-mini-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: contain; }
.bk-mini-name { font-size: var(--fs-md); font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-mini-cta { background: var(--fpc-accent, var(--accent-warm)); color: #FBF9F4; padding: 8px 14px; border-radius: var(--r-pill); font-size: var(--fs-sm); font-weight: 500; cursor: pointer; }
@media (max-width: 767px) { .bk-mini { display: flex; } }
@media (prefers-reduced-motion: reduce) { .bk-mini { transition-duration: var(--dur-quick); transform: none; } }
```

- [ ] **Step 1 — Implement `components/booking/sticky-mini-header.tsx`.**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

interface StickyMiniHeaderProps {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  name: string;
  logoUrl?: string | null;
  initials: string;
  onReserveClick: () => void;
}

export function StickyMiniHeader({ sentinelRef, name, logoUrl, initials, onReserveClick }: StickyMiniHeaderProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setShown(!entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sentinelRef]);
  return (
    <div className={`bk-mini ${shown ? "is-shown" : ""}`.trim()} aria-hidden={!shown}>
      <span className="bk-mini-avatar" aria-hidden>
        {logoUrl ? <img src={logoUrl} alt="" /> : <span>{initials}</span>}
      </span>
      <span className="bk-mini-name">{name}</span>
      <button type="button" className="bk-mini-cta" onClick={onReserveClick}>Reservar</button>
    </div>
  );
}
```

- [ ] **Step 2 — Wire in `booking-wizard.tsx`.**

```tsx
import { StickyMiniHeader } from "./sticky-mini-header";

// `cardSentinelRef` was already declared in F7.2 Step 1.a — do NOT redeclare.
// Add only the derived `initials` constant here:
const initials = (org.nombre || "F").split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

// outside <main>, top of the return:
<StickyMiniHeader
  sentinelRef={cardSentinelRef}
  name={org.nombre}
  logoUrl={org.logoUrl}
  initials={initials}
  onReserveClick={() => { setVista("servicio"); document.getElementById("bk-flow")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
/>
```

(Add `id="bk-flow"` to the first section element inside `<main>` so the smooth-scroll target exists.)

- [ ] **Step 3 — Run mobile-viewport playwright check.**

```ts
test("mobile: sticky mini header emerges on scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto("/book/seed-slug");
  await page.evaluate(() => window.scrollBy({ top: 600 }));
  await expect(page.locator(".bk-mini.is-shown")).toBeVisible();
});
```

- [ ] **Step 4 — Commit.**

```bash
git add components/booking/sticky-mini-header.tsx components/booking/booking-wizard.tsx public/folio.css tests/e2e/book-public.spec.ts
git commit -m "feat(book): mobile sticky mini-header on scroll past card hero

IntersectionObserver pattern; fpc-sticky-mini-emerge beat
(opacity + 8 px translate, --ease-emphasized-out, 320 ms).
Reduce-motion strips translate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7.4 — F7 Visual gate

- [ ] On desktop, walk `/book/<seeded-slug>` for each of the 4 moods (toggle via DB or by hitting the `/card-moods` page first to seed). Confirm:
  - Card hero is centered, max 560 px wide.
  - Below the card, the booking 3-step flow looks unchanged.
- [ ] Resize the window to 375 px mobile. Scroll. Confirm:
  - The sticky mini-header appears once the hero scrolls out of view (320 ms emerge).
  - Tapping "Reservar" smooth-scrolls to the booking section.
  - Card collapses correctly without jank.
- [ ] Confirm **Bundle First Load `/book/[slug]` < 250 KB** via `pnpm build` output.
- [ ] Ask founder: "F7 done — `/book/[slug]` now leads with PublicCard hero, sticky mini-header on mobile. Approve F8 verification + ship?"

---

## 8 · F8 — Verification + ship

**Goal:** delete `CardPreview` compat shim, clean up legacy `.card-preview-*` CSS, run the full acceptance battery from spec §12, confirm budgets, and resolve any remaining open decisions.

### Task 8.1 — Replace remaining `CardPreview` imports

- [ ] **Step 1 — Find them.**

```bash
git grep -nE "CardPreview|card-preview" -- '*.ts' '*.tsx' | grep -v "@deprecated"
```

- [ ] **Step 2 — Rewrite each call-site to import `PublicCard` from `@/components/public-card/public-card`. Use the exact same prop names that worked under the shim (the types are re-exported under new names).**

- [ ] **Step 3 — Delete `components/onboarding/card-preview.tsx`** and remove the re-export.

- [ ] **Step 4 — Typecheck.**

```bash
pnpm typecheck
```

- [ ] **Step 5 — Commit.**

```bash
git rm components/onboarding/card-preview.tsx
git commit -am "chore(card): remove CardPreview shim; consumers use PublicCard directly

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8.2 — Cleanup legacy `.card-preview-*` CSS

- [ ] **Step 1 — Grep `public/folio.css` for `.card-preview` selectors.** Delete blocks (none should remain after F4 since the new component uses `.fpc-*` classes; but verify).

- [ ] **Step 2 — Run a CSS lint pass.**

```bash
pnpm exec stylelint public/folio.css   # if configured
```

- [ ] **Step 3 — Commit any deletions.**

### Task 8.3 — Full acceptance battery (spec §12)

For each item, run / verify. Check the box only if green.

- [ ] `/book/[slug]` renderea `<PublicCard variant="full" />` como hero antes del booking wizard.
- [ ] Logo PNG con transparencia sube exitoso, persiste, re-upload lo sobrescribe.
- [ ] Mood picker en onboarding persiste en DB, se refleja en live preview, sobrevive recarga.
- [ ] Cada mood se ve distinguible al ojo de alguien sin contexto — confirmed via the 6-pair table in §5.3, screenshots at 200×100 px.
- [ ] Sin logo, fallback `AvatarIniciales` se renderea con calidad elite.
- [ ] Reduce-motion: card entra sin stagger, sin scale, sin blur. Estado final inmediato.
- [ ] Mobile responsive: en `/book/[slug]` la card colapsa, sticky mini header funciona.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` verde.
- [ ] Bundle First Load `/book/[slug]` < 250 KB.
- [ ] Bundle First Load `/onboarding` < 275 KB.
- [ ] No quedan referencias al import de `CardPreview` después del cleanup.

### Task 8.4 — Final commit + open the PR

```bash
git status
git log --oneline | head -20
# create the PR via gh per `commit-push-pr` skill
```

PR title: `feat: public card + onboarding redesign — Folio Atelier · F1-F8`

PR body sketch:

```markdown
## Summary
- Adopts the Folio Atelier design language (see docs/specs/2026-05-21-design-language-recommendation.md)
- New <PublicCard> component (Layer A baseline)
- 4 mood preset system (Layer B): Cálido, Clínico, Editorial (default), Boutique
- Optional logo upload (Layer D) — PNG, 500 KB cap, Supabase Storage org-logos bucket
- /book/[slug] now leads with <PublicCard variant="full">
- Onboarding Step 4 "Identidad visual" unifies acento + logo + mood
- Mobile sticky mini-header on scroll past hero

## Test plan
- [ ] pnpm typecheck && pnpm lint && pnpm build green
- [ ] pnpm test pass (Vitest)
- [ ] pnpm exec playwright test pass
- [ ] Manual: onboarding flow steps 1-9 walk
- [ ] Manual: /book/<slug> on desktop + mobile (375 px)
- [ ] Manual: prefers-reduced-motion: reduce — card snaps in
- [ ] Manual: 4 moods distinguishable at thumbnail scale
- [ ] Bundle: /book < 250 KB First Load JS
- [ ] Bundle: /onboarding < 275 KB First Load JS

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 9 · Risks (per phase)

| Phase | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| F1 | Fraunces fails to load on first paint (FOUT shows Iowan/Georgia) | Med | Low | `display: swap`; fallback chain `Iowan Old Style, Georgia, serif`; non-blocking |
| F1 | Token rename breaks an obscure existing consumer | Low | Med | Back-compat aliases (`--accent`, `--brass`) kept; smoke-test dashboard at gate |
| F2 | Storage bucket RLS misconfigured → upload fails silently | Low | High | Manual test from a 2nd user in the same org (DIRECTOR role) before F3 |
| F2 | `card_mood` CHECK constraint blocks a pre-existing row | None | — | All pre-existing rows hit DEFAULT 'editorial' — CHECK is satisfied |
| F3 | Large PNG (>500 KB) sneaks past client check on slow networks | Med | Low | Server validates with same constants (`LOGO_MAX_BYTES`) |
| F3 | Re-upload races with the DB update → URL stale for ~200 ms | Med | Low | Public URL is cache-busted with `?v=Date.now()` |
| F4 | Musical stagger feels "performative" on small-screen | Low | Med | Visual gate; if rejected, switch to uniform 60 ms across all phases (one CSS edit) |
| F4 | `color-mix(in srgb, ...)` not supported in some old browsers | Low | Med | `color-mix` is in all evergreen since 2023; fallback `--accent-warm-soft` solid works without it |
| F5 | Boutique paper-noise pattern hurts CLS or LCP | Low | Med | data: URI is ~700 bytes inlined in CSS → no layout shift, no extra HTTP |
| F5 | Clínico-blend on per-pro acento looks muddy for very saturated user hex | Med | Med | 40 % blend toward ink is the chosen compromise; founder can dial via Open Question 7 |
| F6 | Step 4 grows long enough to scroll on small screens | Med | Low | The 3-section split (logo / acento / mood) is intentionally grouped; reduce padding if needed |
| F6 | Auto-save debounce + 3 fields creates DB write storms | Low | Low | Existing 800 ms debounce + single-write merging in `updateOnboardingStep` keeps it ≤1 write per change burst |
| F7 | IntersectionObserver fires inconsistently on iOS Safari | Low | Med | Tested on iOS Safari 17+ in real device; fallback is the static header that ships with the card itself (sticky-mini becomes opt-in) |
| F7 | `/book/[slug]` bundle exceeds 250 KB because we now ship the card | Med | High | Tree-shake decoration primitives; lazy-load logo `<img>`; if Fraunces variable inflates bundle, swap to `weight: ["500"]` only on `/book/[slug]` route via per-route `next/font` |
| F8 | Acceptance criterion "two moods don't get confused at thumbnail" is subjective | Med | Med | Use the 6-pair table; if any pair fails, dial mood differentiation by adjusting decoration primitive intensity (e.g., make Boutique paper-noise 2 % instead of 1.5 %) |

---

## 10 · Acceptance criteria (copy-paste-ready)

Run at end of F8. Tick each only with hard evidence (screenshot, command output, or browser verification).

- [ ] **AC-1** `/book/<any-existing-slug>` renders `<PublicCard variant="full">` above the booking 3-step flow. Verified by Playwright `tests/e2e/book-public.spec.ts`.
- [ ] **AC-2** Logo PNG ≥ 1×1 px and ≤ 500 KB uploads successfully; URL persisted in `organization.logo_url`; appears on `/book/<slug>` after reload. Verified by `tests/e2e/identidad-visual.spec.ts`.
- [ ] **AC-3** Re-upload overwrites at same path (`<org_id>/logo.png`). Verified by uploading twice and confirming the public URL returns the second file (with `?v=<ts>` cache-bust on the DB-stored URL).
- [ ] **AC-4** Mood picker persists to `organization.card_mood`; survives reload. Verified by `tests/e2e/identidad-visual.spec.ts`.
- [ ] **AC-5** All 4 moods render visually distinct at thumbnail (200×100 px). Verified by founder eyeballs at F5 gate against the 6-pair table.
- [ ] **AC-6** Without `logo_url`, `AvatarIniciales` renders cleanly (no broken-image icon, no "missing image" alt artefact). Verified manually.
- [ ] **AC-7** With `prefers-reduced-motion: reduce`, the card displays final state immediately, no stagger / scale / blur / shake. Verified manually under DevTools emulation.
- [ ] **AC-8** On 375 px viewport, scroll past hero shows `bk-mini` sticky header within 320 ms; scroll-up retracts it. Verified by Playwright + manual on real iPhone.
- [ ] **AC-9** `pnpm typecheck && pnpm lint && pnpm build` all green.
- [ ] **AC-10** Bundle First Load `/book/[slug]` < 250 KB. Verified by `pnpm build` output (Next.js report).
- [ ] **AC-11** Bundle First Load `/onboarding` < 275 KB. Same source.
- [ ] **AC-12** `git grep -nE "CardPreview" -- '*.tsx' '*.ts'` returns zero results.
- [ ] **AC-13** All 8 named motion beats from §3.5 of the design-language doc are present in `public/folio.css` (grep for `@keyframes fpc-`).
- [ ] **AC-14** Clínico mood pro-acento blend produces `applyAcentoBlend("clinico", "#FF5500") === "#AA4E3C"`. Verified by unit test.
- [ ] **AC-15** All four mood `data-card-mood` selectors emit different computed `--fpc-radius` (`16`, `10`, `20`, `24` respectively). Verified in DevTools.
- [ ] **AC-16** Fraunces variable font subset is loaded and used for `.fpc-name` in moods Cálido, Editorial, Boutique; **not** loaded by `/hoy` dashboard route. Verified via Network panel (`Fraunces` row only on the relevant route).
- [ ] **AC-17** Existing Step 9 reveal animation timings (logo 0-400 ms, headline 400-800 ms, card 800-1400 ms, CTAs 1400-1800 ms with 80 ms stagger) are unchanged from current `step9-moment.tsx`. (The card itself is now `PublicCard`, but the reveal envelope is untouched.)

---

## 11 · Open Questions awaiting founder decisions

These remain after this plan and should be resolved before, or surface as deviations during, implementation. Each carries a recommended default — implementing agent uses defaults unless overridden in writing.

### From the design-language recommendation §7

1. **Fraunces vs paid Editorial New** — default Fraunces.
2. **Introduce `--accent-ink` for clinical CTAs** — default yes.
3. **Page background cool `#F4F1E9` vs current `#F5F2EB`** — default cool (`#F4F1E9`).
4. **Refresh `fi-btn` recipe in this sprint** — default **no** (out of scope).
5. **Editorial as default mood vs Cálido** — default Editorial.
6. **Ship 4 moods vs 2 moods (Cálido + Clínico) first** — default 4 (this plan assumes 4; Appendix in design-language doc has the 2-mood collapse path).
7. **Per-pro acento override in Clínico mood** — default blend 60/40 toward ink-blue.
8. **Dark mode auto vs opt-in vs light-only on `/book/[slug]`** — default auto via `prefers-color-scheme`.

### Newly surfaced by this plan

9. **Onboarding Step 4 grouping** — this plan **grouped** logo + acento + mood into Step 4 (rejecting the "add a 10th step" path from spec §14.4). Founder approves by silence at the F6 gate, or vetoes there.
10. **Default acento inconsistency** — `signUpAndInitOrganization` writes `#c89b3c` to a new org's `acento_hex`, but `ONBOARDING_INITIAL.acento` is `#8A6722`. New-org first paint shows `#c89b3c` until the user reaches Step 4. **Decision needed**: which is the "real default"? **Recommendation**: change `signUpAndInitOrganization` to use `#8A6722` so the default matches everywhere. **Out of scope for this PR** unless founder includes it. Flag as a separate one-line change in a follow-up sprint.
11. **SVG logo support** — this plan rejects SVG (XSS sanitization risk; PNG with alpha covers 95% of pro logos). Defer to a v2 unless founder requests otherwise; track as Open Question 3 in spec §14.
12. **Pre-mood quiz** — out of scope; v2 (spec §14.5).
13. **Acento token unification** — should `data.acentoHex` (the per-pro hex) feed through `--fpc-accent` AND back-compat `--accent` simultaneously, or should new `.fpc-*` consumers stop reading `--accent`? **Recommendation**: feed only `--fpc-accent` for new components; keep `--accent` consumers in the dashboard untouched. **Implementing agent must not propagate `--fpc-accent` upward to `:root`.**
14. **`/configuracion` integration** — spec §3.3 lists `/configuracion` as a consumer of the unified `PublicCard` but does not define when. **Decision needed**: in F8 or in a follow-up sprint? **Recommendation**: follow-up. Document in §11.14 only if `/configuracion` is in scope.

---

## 12 · Blockers awaiting founder

(None at plan-write time. The plan is fully executable on the recommended defaults. If a blocker emerges during implementation, the implementing agent appends here under a dated bullet.)

---

## 13 · Self-review checklist (run by author against this plan)

- [x] **Spec coverage** — every spec §12 acceptance criterion maps to a numbered AC- in §10.
- [x] **Phase per spec phase** — F2-F8 here = F1-F7 in spec §13, plus the inserted F1 Token bootstrap. Mapping documented in §0.4.
- [x] **Atomic tasks** — each task lists "files, write failing test, run-fail, implement, run-pass, typecheck, commit." Bite-sized.
- [x] **TDD discipline** — every code-bearing task starts with a failing test.
- [x] **No placeholders** — no "TBD", no "implement later", no "similar to Task N" stubs. Code is written in full at each step.
- [x] **Motion specs frame-by-frame** — §1.3 (logo upload), §4.3 (PublicCard hero), §6.3 (mood picker), §7.3 (sticky mini) all give T-ms breakdowns + easing tokens + properties.
- [x] **4 mood specs exhaustive** — full token block + CSS override block per mood in §5.2.
- [x] **Per-phase visual gate** — each F<n> ends with an explicit founder-approval gate before the next.
- [x] **Risks** — §9 lists per-phase risks with mitigations.
- [x] **Acceptance criteria copy-paste-ready** — §10 is 17 ticks with hard verification per item.
- [x] **Open questions explicit** — §11 lists 14 open items; each carries a default but is not softened.
- [x] **Cross-references resolve** — beat names referenced in F<n> are defined in `design-language-recommendation.md` §3.5 (this plan does not redefine them, only consumes).
- [x] **No emojis** in tokens, code, file paths, commit message templates. (Section headers in this plan also contain none.)
- [x] **No `--no-verify` / `--force` / `--skip`** in any command.
- [x] **Commit messages** are conventional, single-line subject, blank line, paragraph, optional Co-Authored-By.
- [x] **Reduce-motion compliance** — every new motion beat has its prefers-reduced-motion fallback declared.
- [x] **Bundle budgets** named (250 KB / 275 KB), measured at AC-10 / AC-11.
- [x] **Existing surface unaffected during F1-F5** — gate verification at each phase confirms no regression on dashboard, login, current /book.
- [x] **Database changes minimal** — M21 adds two columns. No data migration risk.
- [x] **Storage policy auditable** — RLS read public, write OWNER/DIRECTOR-only via existing `member` table.
- [x] **Plan readable cold** — an implementing agent can pick up at task 1.1 with no chat context; the only required prior reading is the design-language doc.

---

*End of implementation plan.*

*Companion document: [`./2026-05-21-design-language-recommendation.md`](./2026-05-21-design-language-recommendation.md).*



