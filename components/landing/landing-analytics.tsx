"use client";

/**
 * Folio · Landing — island de analytics del funnel de marketing (Fase B · B3).
 *
 * Sin UI (devuelve null). Se monta UNA vez en la página del landing y captura
 * vía posthog-js (browser):
 *   - `landing.viewed`          → on mount (una vez por visita).
 *   - `landing.section_viewed`  → IntersectionObserver sobre [data-fl-section]
 *                                 (una vez por sección, ~40% visible; para
 *                                 secciones más altas que el viewport alcanza
 *                                 con ~40% del viewport cubierto).
 *   - `landing.cta_clicked`     → delegación de click sobre [data-fl-cta]
 *                                 (section = valor del atributo, target = href).
 *   - `landing.faq_opened`      → evento `toggle` (capture phase: no burbujea)
 *                                 sobre <details data-fl-faq> abiertos, dedup
 *                                 por índice.
 *
 * Guard de consent: PostHog solo se inicializa si el user aceptó cookies
 * (lib/observability/posthog-client.tsx). Acá NO asumimos nada al montar:
 * cada captura chequea `posthog.__loaded` en el momento — si no hay consent
 * (o no hay NEXT_PUBLIC_POSTHOG_KEY), todo es no-op silencioso. Si el consent
 * llega DESPUÉS del mount (hoy el CookieBanner recarga la página, pero no
 * dependemos de eso), la primera captura exitosa hace backfill de
 * `landing.viewed` para que el funnel no quede sin su evento raíz.
 *
 * Tipos importados SOLO con `import type` — events.ts arrastra posthog-node
 * (server-only) y no debe entrar al bundle del browser por valor.
 */

import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useRef } from "react";

import type {
  LandingCtaSection,
  LandingEventMap,
  LandingEventName,
} from "@/lib/observability/events";

/** Fracción del target (o del viewport, para secciones altas) que cuenta como "vista". */
const SECTION_VIEW_RATIO = 0.4;

export function LandingAnalytics() {
  const posthog = usePostHog();
  // Ref para que los listeners/observers de larga vida vean siempre la
  // instancia actual sin re-suscribirse.
  const phRef = useRef(posthog);
  phRef.current = posthog;

  const viewedSent = useRef(false);
  const seenSections = useRef<Set<string>>(new Set());
  const openedFaqs = useRef<Set<number>>(new Set());

  /**
   * Backfill del evento raíz: si `landing.viewed` no salió al montar (sin
   * consent en ese momento), lo emitimos antes de la primera captura exitosa.
   */
  const sendViewed = useCallback(() => {
    if (viewedSent.current) return;
    const ph = phRef.current;
    if (!ph || !ph.__loaded) return;
    viewedSent.current = true;
    ph.capture("landing.viewed", {});
  }, []);

  /**
   * Captura tipada contra LandingEventMap. Devuelve true si el evento salió
   * (PostHog inicializado), false si fue no-op (sin consent / sin key / sin
   * provider) — los call sites usan el booleano para decidir si dedupear.
   */
  const capture = useCallback(
    <E extends LandingEventName>(event: E, props: LandingEventMap[E]): boolean => {
      const ph = phRef.current;
      // __loaded solo es true tras posthog.init() — que está gated por consent.
      if (!ph || !ph.__loaded) return false;
      if (event !== "landing.viewed") sendViewed();
      else viewedSent.current = true;
      ph.capture(event, props);
      return true;
    },
    [sendViewed],
  );

  // landing.viewed — on mount, una vez. Si todavía no hay consent es no-op;
  // el backfill de `sendViewed` cubre consent tardío en la misma sesión.
  useEffect(() => {
    capture("landing.viewed", {});
  }, [capture]);

  // landing.section_viewed — IO sobre [data-fl-section], una vez por sección.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-fl-section]"));
    if (sections.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = (entry.target as HTMLElement).dataset.flSection;
          if (!section || seenSections.current.has(section)) continue;

          // Secciones más altas que el viewport nunca alcanzan ratio 0.4 de
          // sí mismas → para ellas cuenta cubrir ~40% del viewport.
          const viewportH = window.innerHeight || 1;
          const tall = entry.boundingClientRect.height > viewportH;
          const visibleEnough = tall
            ? entry.intersectionRect.height >= viewportH * SECTION_VIEW_RATIO
            : entry.intersectionRatio >= SECTION_VIEW_RATIO;
          if (!visibleEnough) continue;

          // Solo dedupear si la captura realmente salió (con consent): si fue
          // no-op, la sección puede volver a calificar más adelante.
          if (capture("landing.section_viewed", { section })) {
            seenSections.current.add(section);
            io.unobserve(entry.target);
          }
        }
      },
      // 0.05 dispara el callback también en secciones altas (que nunca cruzan 0.4).
      { threshold: [0.05, SECTION_VIEW_RATIO] },
    );

    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [capture]);

  // landing.cta_clicked — delegación de click sobre [data-fl-cta].
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-fl-cta]");
      if (!el) return;
      const section = el.getAttribute("data-fl-cta");
      if (!section) return;
      const target = el.getAttribute("href") ?? "";
      capture("landing.cta_clicked", {
        section: section as LandingCtaSection,
        target,
      });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [capture]);

  // landing.faq_opened — `toggle` no burbujea: listener en capture phase
  // sobre document. Dedup por índice (abrir/cerrar repetido no spamea).
  useEffect(() => {
    const onToggle = (e: Event) => {
      const details = e.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      if (!details.hasAttribute("data-fl-faq") || !details.open) return;
      const raw = details.getAttribute("data-fl-faq") ?? "";
      let index = Number(raw);
      if (!Number.isFinite(index)) {
        // Fallback: posición del item entre todos los [data-fl-faq].
        index = Array.from(document.querySelectorAll("details[data-fl-faq]")).indexOf(details);
        if (index < 0) return;
      }
      if (openedFaqs.current.has(index)) return;
      if (capture("landing.faq_opened", { index })) {
        openedFaqs.current.add(index);
      }
    };
    document.addEventListener("toggle", onToggle, true);
    return () => document.removeEventListener("toggle", onToggle, true);
  }, [capture]);

  return null;
}
