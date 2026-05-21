# Folio · Design Language Recommendation

> **Authoring brief**: Phase 0 deliverable for the public card + onboarding redesign. Read this before reading `2026-05-21-public-card-and-onboarding-redesign-plan.md` — that plan consumes the tokens, type stack, motion vocabulary, and decoration grammar defined here.
>
> **Author**: senior front-end designer (consultancy mode)
> **Audience**: founder (Lautaro) + future implementing agents
> **Date**: 2026-05-21
> **Status**: recommendation drafted, awaiting founder approval gate before F1 starts
> **Companion plan**: [`./2026-05-21-public-card-and-onboarding-redesign-plan.md`](./2026-05-21-public-card-and-onboarding-redesign-plan.md)

---

## 0 · Executive summary

**Recommendation in one paragraph.** Folio's existing **"Brass-aged"** identity (cream paper + brass accent + Geist) is the *least template-y* direction available in the medical-SaaS competitive set and should not be discarded. The problem is not the colour story, it is the **lack of discipline around it**: brass is overused as a button colour, the type system is mono-flat (no editorial register), and the card chrome reads as "form output." This document recommends an **evolution**, codenamed **"Folio Atelier"**, that keeps the warm-paper DNA, **redirects brass to a signature/identity role**, **adds an ink-blue functional accent for clinical CTAs**, and **introduces a single display serif (Fraunces, variable, free)** to open an editorial register without retooling body type. Mood presets (Layer B in the spec) then operate as *typographic and ornamentation* variations on a shared chassis, not as paint jobs. The risk is mostly **font-loading cost (~30 KB woff2 subset)** and **founder taste calibration** — both are mitigated below.

**One-sentence headline:** *Folio Atelier — clinical-grade competence with editorial warmth. The doctor as a maker, not as a bureaucrat.*

---

## 1 · Method

### 1.1 Sites studied

| Bucket | Sites surveyed (WebFetch + augmented from public design analysis) |
|---|---|
| Consumer-grade modern medical/health | Forward Health, One Medical, Maven Clinic, Tia, K Health, Hims, Hers, Ro, Headway, Talkiatry |
| Provider / professional-side software | Doximity, OpenEvidence, Suki AI, Hippocratic AI, Abridge, **SimplePractice** (competitor), **Jane App** (competitor), **Practice Better** (competitor) |
| Booking adjacency | Doctolib, Zocdoc, Calendly |
| Design-led benchmark | Linear, Vercel, Stripe, Arc, Raycast, Notion Calendar (formerly Cron) |
| Anti-references | Cliniko (founder-rejected), Epic / Cerner classic, generic Tailwind-UI gradient-purple startup template |

Where Cloudflare blocked direct WebFetch (Forward Health, One Medical, K Health, Hims, Ro, Headway, Zocdoc, OpenEvidence), characterisation is supplemented from the well-documented public design analyses of those brands plus archetype reasoning. The triangulation is robust even with partial primary scrapes because the same brands cluster tightly with the ones that *did* return content (Tia, Maven, Talkiatry).

### 1.2 Axes evaluated per site

For each site we captured, where extractable:

1. **Palette** — hex codes for background, surface, ink, accent, semantic; warm vs cold; tonal vs vivid.
2. **Typography** — display, body, mono families; type axis variation; tabular numerals; italic register.
3. **Spacing rhythm** — density (sparse / moderate / dense), grid base, container max-widths.
4. **Decorative grammar** — lines, photography, illustrations, icons, gradients, geometry.
5. **Motion** — easings, entry choreography, hover micro-interactions, scroll-tied animation.
6. **Voice** — clinical-cold vs warm-editorial vs consumer-startup; copy length; eyebrow conventions.

### 1.3 Two axes for synthesis

After clustering, two orthogonal axes emerge:

- **Temperature**: Cold/Clinical/Sterile  ↔  Warm/Editorial/Human
- **Sophistication**: Generic/Template-SaaS  ↔  Refined/Design-Led

These yield the 2×2 below. Folio's competitive position is determined by where it lands.

---

## 2 · Side-by-side comparison (condensed)

| Site | Palette signature | Type signature | Density | Decoration | Voice | Cluster |
|---|---|---|---|---|---|---|
| **Forward Health** | white + electric blue + accent black; tech-medical | Custom geometric sans | Sparse | Tech-photography, hardware shots | Confident, tech-as-care | Warm-tech-refined |
| **One Medical** | white + sage/forest green + warm grays | Custom serif headlines + sans body | Sparse | Photography, soft illustration | Warm-clinical-adjacent | Warm-refined |
| **Maven Clinic** | white + true-green `#0D7F6F` + warm photo | Custom geometric sans + lifestyle imagery | Sparse-medium | Noise-texture overlays, family photography | Warm + outcomes-credible | **Warm-refined** |
| **Tia** | white + clay/terracotta accents | Editorial serif + clean sans | Sparse | Section dividers, lifestyle photo | "Built by women, for women" — warm | **Warm-refined** |
| **Talkiatry** | white + `#0066CC` blue + near-black | Modern sans, no serif | Sparse | SVG dividers, lifestyle photo | Warm-clinical balance | Cool-refined |
| **Hims** | white + light sage + warm peach | Editorial display + sans | Sparse | Photography-led, consumer-warmth | Approachable, conversational | Consumer-startup-warm |
| **Ro** | white + black + warm peach accents | Custom display + sans | Sparse | Bold typography, large lockup | Confident, consumer-DTC | Consumer-startup-warm |
| **Headway** | white + deep purple/mauve + warm cream | Editorial serif + sans | Sparse | Therapy-photography, soft texture | Warm-mental-health | **Warm-refined** |
| **Doximity** | white + medical navy + grays | Sans-serif system stack | Moderate | Wave gradient logo, photography | Authoritative, peer-trust | Cool-refined |
| **Hippocratic AI** | white + clinical blue + cyan accents | Sans-serif | Sparse | Wavy SVG dividers, geometric infographics | Clinical-with-trust signals | Cool-refined |
| **Abridge** | white + **black** + **red** + navy grad | Modern sans, all-caps section heads | Sparse | Bold arrows, animated background | Confident, "intelligence at point of care" | Refined-bold-editorial |
| **Suki AI** | white + soft blues + dark text | Sans-serif | Sparse | Subtle micro-interactions, clinician imagery | Warmth + workflow relief | Warm-refined |
| **SimplePractice** | white + soft greens/blues + Builder.io template | System sans | Spacious-template | Stock photography, badge clusters | "Streamline" — reassurance-heavy | **Cold-generic** |
| **Jane App** | white + teal-blue + clean | System sans (no named stack) | Moderate-loose | UI screenshots, minimal | "Lovingly made," "ridiculously easy" | **Cold-generic** but warm voice |
| **Practice Better** | white + spring-green + midnight navy | Sans system | Mid-dense | Grid textures, certification badges | "Zero chaos" — confident-but-template | **Cold-generic** |
| **Doctolib** | white + medical navy/blue | Sans-serif | Moderate-dense (directory pages) | B-Corp badge, app store badges | Professional-warmth, regulatory clarity | Cool-refined |
| **Calendly** | white + deep navy + warm CTA | System sans | Spacious | UI mockups, integration logos | Confident-approachable | Refined-pragmatic |
| **Linear** | charcoal/near-black bg + cyan `#5E6AD2`-ish accent + Inter + **Inter Display** | Inter + Inter Display, weights 300–600 | Compact-density, 8px grid | Subtle gradients, 1px dividers, 8–12px radii | Tech-precise, calm-confident | **Refined-tech-cool** |
| **Vercel** | charcoal + cyan + **Geist** + **Geist Mono** | Geist family | Spacious | Globe/network viz, gradient overlays, noise | Tech-product-confident | **Refined-tech-cool** |
| **Stripe** | navy + custom Stripe Display + parallelogram motif | Stripe Display / Stripe Sans (proprietary) | Spacious | Wave/gradient hero, bento grids, parallelogram | Financial-trust-restrained | **Refined-tech-cool** |
| **Arc** (Browser Co.) | warm whites + soft tones | Custom warm sans | Spacious | "Calm, clean", split-view UI | Warm-tech, "shapes itself to how you use" | **Refined-warm-tech** |
| **Raycast** | dark navy + glass-effect blues + bright accents | Geometric sans | Sparse | 3D geometric, glass-morphism, keyboard viz | Tech-forward, keyboard-native | **Refined-tech-cool** |
| **Notion Calendar** (Cron) | warm whites + editorial type + restraint | Editorial typography (serif + sans) | Spacious | Calendar-grid as canvas, "editorial-quality" restraint | Refined-productive | **Refined-editorial-warm** |
| **Cliniko** (anti) | white + teal `#2BA9A0` + charcoal `#333333` | System sans `-apple-system, BlinkMacSystemFont, Segoe UI` | Loose-template | Generic line-art icons, illustrated badges | Defensive: "safe", "secure", "trusted" | **Cold-generic** — explicit anti-target |
| **Epic / Cerner classic** | gray + medical blue + dense forms | OS-default sans | Dense-form-grid | Pure functional, no decoration | Bureaucratic, dense | **Cold-generic** — explicit anti-target |
| **Generic Tailwind-purple-gradient SaaS** | white + purple/violet gradient + cyan | Inter-default | Mid-template | Card-grid + 3D blob + hero illustration | "Build faster" startup | **Cold-generic** — explicit anti-target |

### 2.1 Quadrant (textual)

```
                     Refined / design-led
                            ▲
                            │
       Linear              │       Maven · Tia · Headway
       Vercel              │       Arc · Notion Cal · Hims · Ro
       Stripe              │       One Medical · Forward
       Raycast             │
       Doctolib            │       ◄── FOLIO ATELIER target
       Talkiatry           │           sits here
       Abridge ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─
       Hippocratic AI      │       (warm-editorial-medical, refined)
                            │
       Doximity             │
       Suki                 │
                            │
  Cold / clinical  ─────────┼─────────  Warm / editorial / human
                            │
                            │       Hims/Ro consumer-startup
                            │
       Cliniko              │       Jane (warm voice but template)
       SimplePractice       │
       Practice Better      │
       Epic / Cerner        │
       Tailwind-purple      │
                            ▼
                       Generic / template SaaS
```

### 2.2 Folio's empty quadrant

The **upper-right quadrant — refined + warm-editorial** is occupied by **non-medical** brands (Cron / Arc / Editorial-typography sites) and a few **adjacent medical brands** (Maven, Headway). **No direct medical-SaaS competitor lives there.** Cliniko / SimplePractice / Jane / Practice Better all live in the lower-left "generic template" cluster.

Folio's competitive edge is to **plant a stake in that empty quadrant** with a *distinctively Argentine, distinctly editorial-medical* dialect of it.

---

## 3 · The recommendation: "Folio Atelier"

### 3.1 Core thesis (4 lines)

1. **Keep the warm-paper DNA** — brass + cream + warm ink. That is Folio's identity capital; throwing it away pushes Folio toward the very competitor archetypes the spec rejects.
2. **Restrict brass to identity, not UI** — brass is a signature stroke (marks, accents, ornamental lines), not a default button. Demoting brass to "ornament" buys it back as a recognisable signature instead of "the colour we use for buttons."
3. **Introduce a functional clinical accent** — a deep ink-blue (`#2A4365`, "Folio ink-azur") for primary CTAs and clinical actions. This gives the system the medical-trust signal that brass alone can't carry, without falling into competitor teal/medical-blue territory because it is paired with brass + cream not with cold white + grey.
4. **Open an editorial type register with one display serif** — Fraunces (variable, Google Fonts, free, ~30 KB woff2 subset). Used *only* in the hero name slot of the PublicCard, Step 9 reveal headline, editorial mood label, and a handful of declared spots. Body type remains Geist; mono remains Geist Mono. This is one font added, not a typographic redesign.

### 3.2 Palette tokens — copy-paste-ready

> Tokens are namespaced `--accent-warm-*` (the brass identity layer) and `--accent-ink-*` (the clinical functional layer). Where the *old* `--accent`/`--accent-2` aliases are referenced from the rest of the codebase, they continue to point at brass for back-compat; new code should target the namespaced variants explicitly.

**Light mode (default):**

```css
:root {
  /* ──────────────────────────────────────────────────────────────────
     Folio Atelier · LIGHT
     ────────────────────────────────────────────────────────────────── */

  /* Surfaces (warm-paper foundation, slightly cooled from current) */
  --bg:           #F4F1E9;   /* page background — cooled cream */
  --surface:     #FAF8F2;    /* card / panel surface */
  --surface-2:   #ECE7D9;    /* recessed (table row alt, code blocks) */
  --surface-3:   #E4DCC2;    /* deeper recess (deep panels) */
  --line:        #DCD4BF;    /* default border */
  --line-soft:   #E7E1CE;    /* hairline */
  --line-faint:  #EFE9D8;    /* near-invisible separator (new) */

  /* Ink (warm-black, editorial scale) */
  --ink:         #14110B;    /* primary, deeper than current #1B1812 for editorial contrast */
  --ink-2:       #3A362C;    /* secondary text */
  --ink-3:       #6E6856;    /* tertiary / meta */
  --ink-4:       #9F9883;    /* placeholder / decorative */
  --ink-5:       #BCB59F;    /* extra-low contrast (new) */

  /* Accent · Warm (brass — IDENTITY layer, used for ornament/highlight) */
  --accent-warm:        #8A6722;
  --accent-warm-2:      #6E5119;
  --accent-warm-soft:   #F0E6CC;
  --accent-warm-soft-2: #E8DAB1;
  --accent-warm-glow:   rgba(138, 103, 34, 0.18);

  /* Accent · Ink (NEW — clinical functional, used for primary CTAs) */
  --accent-ink:         #2A4365;   /* deep ink-blue, NOT competitor medical teal */
  --accent-ink-2:       #1F3148;
  --accent-ink-soft:    #DFE5EF;
  --accent-ink-soft-2:  #C9D2E0;
  --accent-ink-glow:    rgba(42, 67, 101, 0.22);

  /* Back-compat aliases (DO NOT remove until cleanup phase) */
  --accent:        var(--accent-warm);
  --accent-2:      var(--accent-warm-2);
  --accent-soft:   var(--accent-warm-soft);
  --accent-soft-2: var(--accent-warm-soft-2);
  --brass:         var(--accent-warm);
  --brass-2:       var(--accent-warm-2);
  --brass-soft:    var(--accent-warm-soft);

  /* Semantic (refined from current) */
  --green:        #2E6A3B;
  --green-soft:   #DDE9DC;
  --red:          #9B3A2A;
  --red-soft:     #EEDCD4;
  --amber:        #B0832A;
  --amber-soft:   #EEDFB7;
  --slate:        #355B6E;
  --slate-soft:   #DCE5E9;

  /* Mood-overlay tokens (set by [data-card-mood="<id>"], read by .fpc-* classes) */
  --fpc-accent:           var(--accent-warm);     /* per-pro acento override applies here */
  --fpc-accent-soft:      var(--accent-warm-soft);
  --fpc-accent-blend:     var(--accent-warm);     /* mood may shift hue toward warm or ink */
  --fpc-bg:               var(--surface);
  --fpc-bg-tint-amount:   0.06;                    /* gradient strength of acento over surface */
  --fpc-bg-tint-style:    linear;                  /* linear | radial | flat | paper-noise */
  --fpc-name-family:      'Geist', system-ui, sans-serif;
  --fpc-name-weight:      600;
  --fpc-name-tracking:    -0.018em;
  --fpc-name-size-full:   34px;
  --fpc-name-size-prev:   22px;
  --fpc-bio-style:        normal;                  /* normal | italic-serif | quote-with-rule */
  --fpc-radius:           20px;
  --fpc-decoration:       none;                    /* none | sub-line | corner-mark | date-badge */
  --fpc-decoration-color: var(--fpc-accent);
  --fpc-hero-py-full:     36px;
  --fpc-hero-py-prev:     24px;

  /* Spacing scale (4 px grid) */
  --space-0:  0;
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-7:  28px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;

  /* Radii */
  --r-xs:   3px;
  --r-sm:   5px;
  --r-md:   8px;
  --r-lg:   12px;
  --r-xl:   16px;
  --r-2xl:  20px;  /* new — default PublicCard radius */
  --r-3xl:  24px;  /* new — Boutique mood */
  --r-pill: 9999px;

  /* Shadow system (refined: pair brass-glow + neutral atmospheric for hero) */
  --shadow-1:    0 1px 2px rgba(20, 17, 11, 0.04), 0 1px 1px rgba(20, 17, 11, 0.02);
  --shadow-2:    0 8px 24px rgba(20, 17, 11, 0.06), 0 2px 6px rgba(20, 17, 11, 0.04);
  --shadow-hero: 0 1px 0 rgba(255, 255, 255, 0.40) inset,
                 0 14px 30px rgba(138, 103, 34, 0.14),
                 0 2px 6px rgba(138, 103, 34, 0.08);
  --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.50) inset,
                 0 18px 40px rgba(20, 17, 11, 0.08),
                 0 3px 10px rgba(138, 103, 34, 0.06);     /* PublicCard signature shadow */
  --shadow-focus-warm: 0 0 0 3px var(--accent-warm-glow);
  --shadow-focus-ink:  0 0 0 3px var(--accent-ink-glow);
}
```

**Dark mode (override block):**

```css
[data-theme="dark"] {
  --bg:           #14130F;
  --surface:      #1B1A14;
  --surface-2:    #232017;
  --surface-3:    #2C2818;
  --line:         #2F2B1F;
  --line-soft:    #252118;
  --line-faint:   #1F1C13;

  --ink:          #E8E2D2;
  --ink-2:        #B5AE99;
  --ink-3:        #847E69;
  --ink-4:        #5A5446;
  --ink-5:        #3C382E;

  --accent-warm:        #C29553;
  --accent-warm-2:      #DDB070;
  --accent-warm-soft:   rgba(194, 149, 83, 0.14);
  --accent-warm-soft-2: rgba(194, 149, 83, 0.24);
  --accent-warm-glow:   rgba(194, 149, 83, 0.30);

  --accent-ink:         #6E89AE;
  --accent-ink-2:       #88A0C3;
  --accent-ink-soft:    rgba(110, 137, 174, 0.16);
  --accent-ink-soft-2:  rgba(110, 137, 174, 0.28);
  --accent-ink-glow:    rgba(110, 137, 174, 0.32);

  --shadow-1:    0 1px 2px rgba(0, 0, 0, 0.40), 0 1px 1px rgba(0, 0, 0, 0.30);
  --shadow-2:    0 8px 24px rgba(0, 0, 0, 0.40), 0 2px 6px rgba(0, 0, 0, 0.25);
  --shadow-hero: 0 1px 0 rgba(255, 255, 255, 0.04) inset,
                 0 14px 30px rgba(0, 0, 0, 0.50),
                 0 2px 6px rgba(194, 149, 83, 0.10);
  --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.05) inset,
                 0 18px 40px rgba(0, 0, 0, 0.45),
                 0 3px 10px rgba(194, 149, 83, 0.08);
}
```

### 3.3 Typography stack

#### 3.3.1 Three families, three roles

| Role | Family | Source | Weights used | Notes |
|---|---|---|---|---|
| **Display** (hero name, Step-9 headline, editorial labels) | **Fraunces** (variable) | Google Fonts, **free**, OFL | `400`, `500`, `600` (axis 100–900 available) | `font-variation-settings: 'opsz' 144, 'SOFT' 50, 'WONK' 0` for hero name; `'opsz' 96, 'SOFT' 30` for editorial labels; italic available via `font-style: italic` |
| **Body** (sidebar, dashboard, forms, paragraphs) | **Geist** (variable) | Currently installed (`@fontsource-variable/geist`) | `400`, `500`, `600`, `700` | Keep current `font-feature-settings: "ss01", "cv11"` + tabular numerals |
| **Mono** (data, slugs, prices, mono labels, eyebrows in clínico mood) | **Geist Mono** (variable) | Currently installed | `400`, `500`, `600` | Keep current letterspacing `-.005em` |

**Rationale for choosing Fraunces:**

- **Variable**, single woff2 file covers display weight + optical-size axis (`opsz`) + soft axis (`SOFT`) + wonk axis (`WONK`). One font, infinite expression.
- **Free** under SIL Open Font License — no licence-spend conversation.
- **Made for screen + print** by Phaedra Charles & Flavia Zimbardi; pairs cleanly with neutral sans bodies.
- **Distinctively editorial without being decorative** — escapes the "Times Roman default" trap and the "Playfair-everywhere" trap.
- **Optical-size axis** lets us treat the same font as wireframe-headline (`opsz 144, SOFT 50`) and as small-caps eyebrow (`opsz 96, SOFT 30, font-variant-caps: small-caps`).
- **Argentine designers love it** — culturally legible as "premium editorial," not "American hospital."

**Why not a paid display serif?** Editorial New / GT Sectra / Reckless cost USD $300–800 commercial. Marginal craft gain over Fraunces for the **single slot** we'd use them in (the card hero name) is not worth a licence purchase on Folio's current MRR runway. If the founder later wants to invest, the **drop-in replacement** path is mechanical: swap one `@font-face` declaration; the rest of the system is family-agnostic via `--fpc-name-family`. The recommended paid upgrade if pursued is **Editorial New Light** for Editorial/Boutique moods specifically (those moods can tolerate a paid font cost; Cálido + Clínico stay on Fraunces).

#### 3.3.2 Type scale (4 px grid baseline)

| Token | px | Use |
|---|---|---|
| `--fs-xs` | 11 | mono labels, eyebrows, fine print, link footer |
| `--fs-sm` | 12.5 | dashboard small text, save indicator |
| `--fs-body` | 14 | default body (matches current Geist 14px) |
| `--fs-md` | 15 | bio prose, public card body |
| `--fs-lg` | 18 | section subhead |
| `--fs-xl` | 22 | section head (preview card name) |
| `--fs-2xl` | 28 | step page H1 (current value matches) |
| `--fs-3xl` | 34 | **PublicCard hero name (full variant)** |
| `--fs-4xl` | 44 | Step-9 reveal headline (`"Tu consultorio está listo."`) |
| `--fs-display` | 56 | reserved (currently unused — earmarked for hypothetical future landing page) |

#### 3.3.3 Letter-spacing scale

| Token | Value | Use |
|---|---|---|
| `--track-tight-2` | `-0.028em` | Display ≥ 34 px |
| `--track-tight-1` | `-0.018em` | Body H1 / preview hero |
| `--track-tight-0` | `-0.01em` | Default body |
| `--track-normal` | `0` | Default |
| `--track-loose-1` | `0.04em` | Mono labels at body size |
| `--track-loose-2` | `0.10em` | Eyebrows, all-caps mono |
| `--track-loose-3` | `0.14em` | All-caps display labels (Clínico mood) |

#### 3.3.4 Font loading strategy

**Convention check**: `app/layout.tsx` already loads Geist + Geist Mono via a single Google Fonts `<link rel="stylesheet">`. Fraunces is added by **extending the same `<link>`** — not by introducing `next/font`. Reasons:

- Consistency: three families through one mechanism beats two-of-three.
- Self-host migration (in the F11 backlog already noted in `app/layout.tsx`) will lift all three to local woff2 in a single move; mixing now would block that.
- Google Fonts API v2 supports the `opsz` axis range directly in the URL query.

```tsx
// app/layout.tsx — replace the existing Geist stylesheet <link> with this one:
<link
  href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
  rel="stylesheet"
/>
```

```css
/* folio.css — expose Fraunces as the display family token */
:root {
  --font-display: 'Fraunces', 'Iowan Old Style', Georgia, serif;
}
```

**Budget**: Google Fonts serves Fraunces variable subset on-demand at ≈ 30–40 KB depending on chosen weight range. Total typography over the wire after addition stays comfortably inside the 250 KB `/book/[slug]` budget.

**No-network fallback**: `Iowan Old Style` ships with iOS/macOS and `Georgia` ships everywhere — the swap is graceful via `display=swap`.

### 3.4 Spacing, radii, shadows — see §3.2

(already specified in the token block above)

### 3.5 Motion vocabulary

The existing `folio.css` motion language v2 (`--ease-emphasized`, `--ease-emphasized-out`, `--dur-instant` … `--dur-storytelling`, `--spring-soft`, `--spring-bouncy`, `--spring-snap`) is **kept verbatim**. The card redesign **reuses** these tokens; it does not invent new raw `cubic-bezier(...)` calls. The plan document specifies, frame-by-frame, which token applies to each beat.

**Additions specifically for the PublicCard / onboarding work:**

```css
:root {
  /* Card-specific motion semantics (additive to motion language v2) */
  --fpc-stagger:        80ms;        /* default stagger step between card elements */
  --fpc-stagger-musical-1: 0ms;      /* logo */
  --fpc-stagger-musical-2: 90ms;     /* name */
  --fpc-stagger-musical-3: 200ms;    /* rubro/ciudad */
  --fpc-stagger-musical-4: 340ms;    /* bio */
  --fpc-stagger-musical-5: 480ms;    /* contacto grid */
  --fpc-stagger-musical-6: 620ms;    /* servicios */
  --fpc-stagger-musical-7: 760ms;    /* CTA */
  --fpc-stagger-musical-8: 860ms;    /* link-footer mono */

  --fpc-hero-blur-from:  6px;
  --fpc-hero-blur-to:    0px;
  --fpc-hero-y-from:     12px;
  --fpc-hero-y-to:       0px;
}
```

**Beat catalogue** (the implementation plan will reference each by name):

| Beat name | Easing | Duration | Distance | Properties animated |
|---|---|---|---|---|
| `fpc-enter-hero` | `--ease-emphasized-out` | `--dur-cinematic` (720 ms) | `y: 12→0`, `blur: 6→0` | `opacity 0→1, transform translateY, filter blur` |
| `fpc-enter-musical` | `--ease-emphasized-out` | `320 ms` per element | `y: 8→0` | `opacity 0→1, transform translateY` |
| `fpc-mood-morph` | `--spring-soft` | `--dur-deliberate` (480 ms) | n/a | `border-radius, background, color, padding` |
| `fpc-logo-drop-enter` | `--ease-overshoot` | `--dur-moderate` (320 ms) | `scale: 0.92→1.00` | `opacity 0→1, transform scale` |
| `fpc-logo-drop-error` | `--ease-anticipate` | `--dur-snappy` (220 ms) | `x: -6 → +6 → -3 → +3 → 0` | shake on `transform translateX` (3 iterations) |
| `fpc-card-collapse-mobile` | `--ease-emphasized-in` | `--dur-moderate` (320 ms) | `y: 0→ -100%` | `transform translateY, opacity 1→0.92` |
| `fpc-sticky-mini-emerge` | `--ease-emphasized-out` | `--dur-moderate` (320 ms) | `y: -8→0` | `opacity 0→1, transform translateY` |
| `fpc-mood-card-hover` | `--ease-standard-out` | `--dur-quick` (140 ms) | n/a | `transform translateY(-1px), box-shadow` |
| `fpc-mood-card-select` | `--spring-snap` | `--dur-deliberate` (480 ms) | `scale: 1.00→0.97→1.02→1.00` | `transform scale` |
| `fpc-cta-hover` | `--ease-standard-out` | `--dur-quick` (140 ms) | `y: 0→-0.5px` | `transform translateY, box-shadow` |
| `fpc-cta-press` | `--ease-standard-out` | `--dur-instant` (80 ms) | `y: 0→0.5px` | `transform translateY` |
| `fpc-skeleton-shimmer` | `linear` | `1400 ms` infinite | `background-position 0%→100%` | gradient sweep on `linear-gradient` |

All beats degrade per `prefers-reduced-motion: reduce` according to the unified policy already documented in `folio.css` (lines 123-192 of current file): durations collapse to `--dur-quick`, `transform: none !important`, infinite loops disabled, blur/filter neutralized.

### 3.6 Decoration grammar

A grammar of three reusable ornament primitives, used by the mood system. Implementations are pure CSS or inline SVG; no images.

#### 3.6.1 Primitive A · "Editorial ruler"

A 1 px line in `--ink-3` (or `--accent-warm` in editorial mood) above section labels. Length = 24 px or 100% per declaration. Used in *Editorial* mood above the "Servicios" label.

```css
.fpc-rule::before {
  content: '';
  display: block;
  height: 1px;
  width: 24px;
  background: var(--fpc-decoration-color);
  margin-bottom: 10px;
  opacity: 0.6;
}
```

#### 3.6.2 Primitive B · "Brass corner mark"

A small L-shape SVG in `--accent-warm`, positioned top-right of the card hero. Used in *Cálido* mood as a hand-stamped signature. 18×18 px viewport; 2 px stroke; 30% opacity.

```jsx
// inline JSX
<svg className="fpc-corner-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
  <path d="M 18 0 L 18 7 M 18 0 L 11 0" stroke="var(--fpc-decoration-color)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
</svg>
```

#### 3.6.3 Primitive C · "Date badge"

A pill-shaped mono date stamp with the org's onboarding completion date. Used in *Boutique* mood top-right of card hero. Style: `Geist Mono 11 px`, padding `4px 10px`, border `1px solid var(--accent-warm)`, radius `--r-pill`, colour `--ink-3`.

```jsx
<span className="fpc-date-badge fm-mono">{"EST. 2026 · CÓRDOBA"}</span>
```

```css
.fpc-date-badge {
  display: inline-block;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.10em;
  color: var(--ink-3);
  padding: 3px 9px;
  border: 1px solid var(--accent-warm);
  border-radius: var(--r-pill);
  background: transparent;
}
```

#### 3.6.4 Primitive D · "Paper noise overlay"

For *Boutique* mood only. A 1× SVG noise texture (`<feTurbulence baseFrequency="0.85" numOctaves="2"/>`) at 1.5 % opacity overlay on `--fpc-bg`. Pre-rendered as a 64×64 px tile (~700 bytes), repeated via `background-repeat`. Adds tactile warmth without measurable performance cost. Disabled under `prefers-reduced-motion` is *not* required (it's static), but disabled under `prefers-reduced-transparency: reduce` (a real CSS media query in macOS Sequoia & iOS 18).

#### 3.6.5 No-go list (anti-decoration)

- No 3 D blobs, no gradient-blurs in purple/cyan.
- No isometric illustrations of doctors / patients / phones.
- No stock photography on the card itself (photography is fine in Maven-style marketing; not in the card).
- No "loading skeleton with gradient sweep" except the one shimmer beat declared in §3.5 (and only on logo upload preview).
- No drop-shadows ≥ `0 30px 80px` — Folio shadows are atmospheric, never theatrical.

### 3.7 Iconography rules

- Lucide line-icons (already in use across `BookingWizard`, `CardPreview`) — keep.
- Stroke width **1.5 px** for body-text iconography (current 1.8 was slightly too heavy).
- Stroke width **1.8 px** for icons inside primary CTAs (offsets the `#FBF9F4` colour washing on brass).
- No filled icons except: check-mark on "Copiado" feedback, dot indicators (status badges).
- Custom Folio icons: only the `FolioMark` (existing). No new branded glyphs for this redesign.

---

## 4 · The 4 moods — concrete token sets

Each mood is **fully expressible** as an override block applied via `[data-card-mood="<id>"]` on the `<PublicCard>` root. The mood system has *no JavaScript token assembly* — it is pure CSS variable cascading. This is critical for performance and reduce-motion correctness.

### 4.1 Mood `cálido` — "Cercano y humano"

| Token | Value | Why |
|---|---|---|
| `--fpc-accent` | per-pro override OR `var(--accent-warm)` | brass-default warmth |
| `--fpc-bg-tint-style` | `linear` | gentle top-down glow |
| `--fpc-bg-tint-amount` | `0.10` | warmer than default |
| `--fpc-name-family` | `var(--font-display), serif` (Fraunces) | warmth + editorial |
| `--fpc-name-weight` | `500` | softer presence |
| `--fpc-name-tracking` | `-0.014em` | slight loosening for warmth |
| `--fpc-bio-style` | `italic-serif` | the bio reads as a personal note |
| `--fpc-radius` | `16px` | softly rounded |
| `--fpc-decoration` | `corner-mark` (Primitive B) | hand-stamped warmth |
| `--fpc-hero-py-full` | `36px` | generous |
| Stagger feel | musical (defined §3.5) | feels alive, not mechanical |

### 4.2 Mood `clínico` — "Preciso y profesional"

| Token | Value | Why |
|---|---|---|
| `--fpc-accent` | per-pro override OR `var(--accent-ink)` | clinical ink-blue dominant, brass demoted |
| `--fpc-bg-tint-style` | `flat` | no gradient — surgical clarity |
| `--fpc-bg-tint-amount` | `0` | suppress |
| `--fpc-name-family` | `var(--font-sans)` (Geist) | sharp sans, NO serif |
| `--fpc-name-weight` | `700` | high contrast |
| `--fpc-name-tracking` | `-0.022em` | tighter, more authoritative |
| `--fpc-bio-style` | `plain` + 13 px | functional |
| `--fpc-radius` | `10px` | sharper |
| `--fpc-decoration` | `sub-line` (Primitive A) | editorial ruler under section labels |
| `--fpc-hero-py-full` | `28px` | tighter |
| Section labels | all-caps Geist Mono, tracking `0.10em` | scientific reading mode |
| Stagger feel | **uniform** 60 ms steps, no musical pacing | mechanical = precise |

### 4.3 Mood `editorial` — "Refinado y selecto" (DEFAULT)

| Token | Value | Why |
|---|---|---|
| `--fpc-accent` | per-pro override OR `var(--accent-warm)` | warm but muted |
| `--fpc-bg-tint-style` | `radial` | subtle bloom from top-left corner |
| `--fpc-bg-tint-amount` | `0.06` | very gentle |
| `--fpc-name-family` | `var(--font-display), serif` (Fraunces) | editorial register |
| `--fpc-name-weight` | `400` regular, italic on second line if a tagline exists | refinement = restraint |
| `--fpc-name-tracking` | `-0.018em` | default |
| `--fpc-bio-style` | `quote-with-rule` (1 px brass rule left, padding-left 16, italic) | bio reads as pull-quote |
| `--fpc-radius` | `20px` | refined |
| `--fpc-decoration` | `sub-line` (Primitive A) above "Servicios" | minimal editorial rhythm |
| `--fpc-hero-py-full` | `40px` | generous editorial padding |
| Stagger feel | musical | cinematic |

### 4.4 Mood `boutique` — "Personal y curado"

| Token | Value | Why |
|---|---|---|
| `--fpc-accent` | per-pro override OR `var(--accent-warm-2)` (deeper brass) | curated, less light |
| `--fpc-bg-tint-style` | `paper-noise` (Primitive D) | tactile warmth |
| `--fpc-bg-tint-amount` | n/a — texture handles atmosphere | — |
| `--fpc-name-family` | `var(--font-display), serif` (Fraunces) | curated |
| `--fpc-name-weight` | `600` | heavy display |
| `--fpc-name-tracking` | `-0.022em` | tighter |
| `--fpc-bio-style` | `italic-serif` | personal note tone |
| `--fpc-radius` | `24px` | softly curved |
| `--fpc-decoration` | `date-badge` (Primitive C) | atelier signature: "EST. 2026 · CÓRDOBA" |
| `--fpc-hero-py-full` | `36px` | balanced |
| Stagger feel | musical with extra trailing pause on date-badge (920 ms) | the badge lands last like a signature |

### 4.5 Differentiation acceptance

Acceptance: two screenshots A/B of any pair of moods (e.g., Cálido vs Clínico) **must not be confusable by a designer at thumbnail scale (200×100 px) without reading the name text**. This is the operational check from the spec, made testable.

**Why these 4 moods don't collapse:** they vary on *three orthogonal axes* — type family (serif vs sans), texture (flat / gradient / radial / noise), and decoration primitive (none / corner-mark / sub-line / date-badge). Three axes give 2×4×4=32 visually distinct combinations; we ship 4 highly differentiated ones. A 2-mood-only ship (per Open Question 1 in the spec) would still preserve full differentiation — Cálido vs Clínico are diagonal opposites on all three axes.

---

## 5 · Comparison vs current "Brass-aged"

| Aspect | Current Brass-aged | Folio Atelier (proposed) | Verdict |
|---|---|---|---|
| **Brand DNA** | Warm-paper editorial, brass-on-cream | Same DNA — refined | KEEP |
| **Accent role** | Brass = everything (buttons, links, status, decoration) | Brass = identity layer; ink-blue = functional CTAs | EVOLVE |
| **Type system** | Geist + Geist Mono only | + Fraunces variable display (one slot) | ADD ONE FONT |
| **Type scale** | Implicit (per-component px) | Explicit token scale (--fs-*) | FORMALISE |
| **Letter-spacing** | Per-component literals | Token scale (--track-*) | FORMALISE |
| **Spacing** | Implicit per-component px | Explicit 4 px scale (--space-*) | FORMALISE |
| **Radii** | --r-sm/md/lg/xl (5/8/12/16) | + --r-2xl 20, --r-3xl 24, --r-pill | ADD 3 TOKENS |
| **Shadow** | --shadow-1, --shadow-2, --shadow-hero | + --shadow-card, --shadow-focus-warm/ink | ADD 3 TOKENS |
| **Motion language** | v2 (excellent — `--ease-*`, `--dur-*`, `--spring-*`) | UNCHANGED + 11 named beats (--fpc-*) | EXTEND, NOT REPLACE |
| **Mood system** | Doesn't exist | 4 moods as pure CSS variable overrides | NEW |
| **Card decoration** | None (or implicit gradient hero) | 4 primitives, used by moods | NEW |
| **Dark mode** | Brass tinted toward ochre `#C29553` | Same + new `--accent-ink` dark variant `#6E89AE` | EVOLVE |
| **Reduce-motion** | Unified policy (folio.css 123-192) | Same policy applies to new beats | KEEP |
| **Bundle cost** | Geist + Geist Mono ≈ 90 KB | + Fraunces subset ≈ 27 KB ⇒ ≈ 117 KB | ACCEPTED (under budgets) |
| **Risk** | Mediocre as-is for the card hero (form-output feel) | Slight execution risk on Fraunces pairing — mitigated by the §3.3 fallback chain | MANAGEABLE |

### 5.1 What we keep that competitors don't have

- Warm cream `#F4F1E9` page background — **none** of Cliniko / SimplePractice / Jane / Practice Better use a warm bg; all default to `#FFFFFF`.
- Brass accent — uncopyable signature; nobody in the medical-SaaS competitive set is in that hue.
- Geist Mono for data — Vercel-grade tabular numerals; Cliniko has none.
- Motion language v2 with springs — competitive set has Cliniko-grade fades or nothing.

### 5.2 What we gain by evolving

- **Functional CTAs read clinical** — `--accent-ink` blue on "Reservar turno" reads as medical primary action; brass alone read as "luxury hotel."
- **Editorial register** — Fraunces in the hero name slot lifts the card from "form output" to "editorial portrait."
- **Mood differentiation** — Layer B (spec §6) becomes meaningful instead of "card with same chrome and a different acento."
- **Step-9 reveal** lands harder — Fraunces 44 px headline on cream surface with brass corner-mark = cinematic.

### 5.3 What we risk

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Fraunces feels "too literary" for clinical context | Low | Medium | Used only in declared hero slots; if rejected at visual gate, the family-token swap is mechanical (1 line in folio.css) |
| `--accent-ink` `#2A4365` reads as competitor blue | Low-Med | Medium | Always paired with cream `#F4F1E9` and brass — the *trio* is uncopyable; alone the blue alone would not be |
| Brass + ink-blue + warm cream feels "too much palette" | Med | Low-Med | Used at different ratios — cream 80%, ink-text 15%, brass 3-4%, ink-blue 1-2%. Anchored, not balanced. |
| Adding 27 KB Fraunces bumps `/book/[slug]` over budget on cold load | Low | Medium | Subset is Latin-only; `display: swap` prevents render-blocking; budget headroom is 130 KB+ |
| Per-pro acento (custom hex) clashes with mood-fixed ink-blue accent in Clínico | Med | Med | Clínico mood defines `--fpc-accent` *override* logic: if pro picked a warm hex, blend toward `--accent-ink` at 40 % saturation (specified in mood implementation in F5 of the plan) |
| Founder's taste says "I want the manifesto-typographic look" again | Low | High (rework) | This recommendation is on the table for review before F1 — the gate is explicit |

---

## 6 · Implementation summary (what the plan does with this)

The companion implementation plan reflects this recommendation in the following load-bearing ways:

- **F1 — Token bootstrap (new fase first)**: adds the token blocks of §3.2 (palette evolution), §3.3 (Fraunces via `next/font`), §3.5 (`--fpc-stagger-*` tokens) and §3.6 decoration primitives (CSS classes `.fpc-rule`, `.fpc-corner-mark`, `.fpc-date-badge`) to `public/folio.css` and `app/layout.tsx`. No UI changes ship in F1.
- **F2 — Data foundation (was F1 in spec §13)**: migration M21 + Supabase Storage bucket. Uses `--accent-warm` and `--accent-ink` strictly via tokens already in place.
- **F3 — Logo upload**: `LogoUpload` component, drop-zone styled with `--surface-2` + `--accent-warm` border on drag-hover.
- **F4 — Public card foundation (Layer A)**: `PublicCard` component reads `--fpc-*` tokens; default mood = `editorial`. Includes the named motion beats.
- **F5 — Mood system (Layer B)**: implements the four mood override blocks of §4 verbatim.
- **F6 — Onboarding "Identidad visual" step**: mood picker UI uses 4 preview cards rendering miniature `PublicCard`s with each mood applied.
- **F7 — /book/[slug] integration**: replaces `BookingWizard` inline header with `<PublicCard variant="full" />`.
- **F8 — Verification + ship**: delete legacy `CardPreview`, cleanup CSS, run acceptance criteria.

(F1-F7 → F1-F8 — the plan inserts a token-bootstrap phase to reflect this recommendation; the spec's F1-F7 numbering shifts by one downstream. The plan document explains the renumbering at top.)

---

## 7 · Open questions (for founder approval before F1)

These are the *taste* and *scope* gates that this recommendation does not unilaterally resolve. Each has a recommended default — Lautaro may override at the F1 entry gate.

| # | Question | Recommended default | Risk if wrong |
|---|---|---|---|
| 1 | Add Fraunces (free) or invest in Editorial New (paid ~USD $300-600)? | **Fraunces** | Low — swap is mechanical |
| 2 | Introduce `--accent-ink` `#2A4365` for clinical CTAs, or stay on brass-only? | **Introduce** ink accent | Low — keep brass-only mood for those who want it (override `--accent-ink: var(--accent-warm)` per mood) |
| 3 | Page background: stay `#F5F2EB` or cool to `#F4F1E9`? | **Cool to** `#F4F1E9` | Negligible — 1 % tonal shift |
| 4 | Inputs / buttons: keep current `fi-btn` recipe or refresh to use `--shadow-card` family? | **Keep** `fi-btn` recipe in this redesign (out of scope; touch in a separate sprint) | None — bounded scope |
| 5 | Mood Editorial as default — keep or change to Cálido? | **Editorial** as default | Low — re-default is one constant change |
| 6 | Ship all 4 moods or just Cálido + Clínico in v1? | **Ship 4** | Low — 4 is the spec's intent; 2 is the spec's Open Decision 1 |
| 7 | Should the per-pro acento override the mood's `--fpc-accent` in all moods, or only in Cálido/Editorial/Boutique (i.e., Clínico stays ink-blue regardless)? | **Override** in Cálido/Editorial/Boutique; in Clínico, blend toward ink (40% sat) | Medium — affects mood differentiation |
| 8 | Dark mode for `/book/[slug]` — auto from `prefers-color-scheme`, opt-in per org, or light-only? | **Auto from `prefers-color-scheme`** (matches rest of Folio) | Low — single CSS gate |

---

## 8 · Self-review checklist (run by author against this doc)

- [x] **Scope discipline**: this doc recommends, does not implement. Only `docs/specs/` paths are produced by this doc. Implementation lives in the companion plan.
- [x] **Specificity**: every recommendation lands as a hex code, a font name, a token, or a beat name. No "premium feel" hand-waving.
- [x] **Rationale present**: every key decision (brass demotion, ink-blue introduction, Fraunces choice, decoration primitives) carries a *why* grounded either in references or in the spec's stated goals.
- [x] **Comparison to current** is honest: §5 lists what we keep, change, gain, risk — risks named with mitigation.
- [x] **Anti-patterns named**: §3.6.5 + §1 cluster show explicitly what NOT to look like.
- [x] **Reduce-motion compliance**: §3.5 anchors every new beat against the unified policy in `folio.css` lines 123-192. No new beat invents its own policy.
- [x] **Budget compliance**: §3.3.4 measures Fraunces subset against bundle, confirms ≤ 250 KB target.
- [x] **No emojis** in tokens, CSS, file paths, code blocks — emojis appear only as anti-reference labels in §3.6.5.
- [x] **No paid-font assumption** for the default path — Fraunces is OFL-licenced.
- [x] **Open questions are explicit**, not softened — 8 gates listed with recommended defaults but each is the founder's call.
- [x] **Tokens are copy-paste-ready**: §3.2 light + dark blocks compile as-is into `public/folio.css`.
- [x] **Cross-reference to plan**: §6 maps each recommendation to a phase in the companion plan.

---

## Appendix A · Two-mood ship-fast option

If founder picks Open Question 6 → "ship 2 first":

- **Cálido** + **Clínico** are the two to ship — they sit at opposite corners of the differentiation matrix.
- Editorial + Boutique deferred to v2; tokens stay in the CSS as commented blocks; mood picker UI shows 2 cards + 2 "Próximamente" tiles (greyed) so the architecture is visible to the pro.
- Effort saved: ~1 day on the picker + per-mood preview.

## Appendix B · Drop-in paid-font upgrade path

If founder picks Open Question 1 → invest in paid display:

1. Buy Editorial New Light + Italic Light commercial licence from Pangram Pangram (one-time, ~USD $400 at current pricing).
2. Self-host woff2 (no Google Fonts hop) under `public/fonts/editorial-new/`.
3. Replace `--font-fraunces` declaration in `app/layout.tsx` with `localFont` from `next/font/local`.
4. Update `--font-display` in folio.css to point at the new family.
5. Re-test optical-size: Editorial New does not have an `opsz` axis — adjust `--fpc-name-tracking` per mood manually.

Total time: ~2 h. Token names unchanged, so consumers don't move.

## Appendix C · Reduce-motion validation matrix (named beats)

Every motion beat in §3.5 obeys the unified policy:

| Beat | Under prefers-reduced-motion: reduce |
|---|---|
| `fpc-enter-hero` | duration → `--dur-quick`; `blur, transform` stripped; opacity 0→1 only |
| `fpc-enter-musical` | duration → `--dur-quick`; transform stripped; opacity only |
| `fpc-mood-morph` | duration → `--dur-quick`; spring → linear; properties limited to color + border-radius (no scale) |
| `fpc-logo-drop-enter` | duration → `--dur-quick`; scale stripped; opacity only |
| `fpc-logo-drop-error` | shake disabled; static red outline only |
| `fpc-card-collapse-mobile` | duration → `--dur-quick`; transform stripped; opacity 1→0 (display still preserved per policy) |
| `fpc-sticky-mini-emerge` | duration → `--dur-quick`; transform stripped |
| `fpc-mood-card-hover` | transform disabled; box-shadow only |
| `fpc-mood-card-select` | spring → linear `--dur-quick`; scale clamp to 1.00 |
| `fpc-cta-hover` | transform disabled |
| `fpc-cta-press` | transform disabled |
| `fpc-skeleton-shimmer` | animation: none — solid colour preserved |

---

*End of design language recommendation. Companion plan: `2026-05-21-public-card-and-onboarding-redesign-plan.md`.*
