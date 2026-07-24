"use client";

/**
 * Folio · Onboarding · Step shell con split layout + live preview.
 *
 * Desktop ≥1024px: split horizontal. Form a la izquierda (max 560px),
 * <PublicCardLive /> sticky a la derecha (360px).
 *
 * Mobile <1024px: form full-width. Botón flotante "Ver mi card" abre un
 * drawer con el preview. Footer sticky bottom para que "Continuar" siempre
 * quede visible.
 *
 * Step transitions: slide-X (16px) + fade simultáneo, 280ms. Respeta
 * prefers-reduced-motion. Maneja `direction` para slide forward/back.
 *
 * Keyboard: el shell es el dueño de Enter/Esc. Enter invoca `next` — el
 * MISMO handler que el botón Continuar (p.ej. handleNext del Step 3, que
 * persiste el slug) — y respeta `nextDisabled`. Antes el listener vivía en
 * OnboardingApp y llamaba al next() genérico: salteaba la validación del
 * paso y perdía el slug editado. Esc: cierra el drawer del preview si está
 * abierto; si no, vuelve un paso.
 *
 * Autofocus: al montar (cada paso remonta el shell por el key del wrapper)
 * enfoca el primer campo editable del body — cierra el loop
 * tipear→Enter→tipear que el hint "↵ continuar" promete.
 *
 * Footer: muestra hint "↵ continuar" en desktop como guía sutil de keyboard.
 */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  PublicCard,
  type PublicCardData,
} from "@/components/public-card/public-card";
import { getAppHost } from "@/lib/config/app-url";

export const ONB_TOTAL = 8;

interface StepShellProps {
  stepIdx: number;
  headline: string;
  sub?: string;
  back?: () => void;
  next?: () => void;
  skip?: () => void;
  canSkip?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  isFinal?: boolean;
  /** Datos para el <PublicCardLive />. Si no hay → no se muestra preview. */
  previewData?: PublicCardData;
  /** Host base (getAppHost(), sin protocolo) para el link del preview. */
  appUrl?: string;
  /** Slug actual de la org (sirve también para el link del preview). */
  slug?: string;
  children: ReactNode;
}

const APP_URL_DEFAULT = getAppHost();

// Campos que reciben el autofocus al montar un paso. Excluimos hidden/file/
// checkbox/radio (enfocar el file input del Step 4 haría ambiguo el Enter) y
// disabled (el email read-only del Step1Consent).
const FOCUSABLE_FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), select, textarea';

export function StepShell({
  stepIdx,
  headline,
  sub,
  back,
  next,
  skip,
  canSkip = true,
  nextLabel = "Continuar",
  nextDisabled = false,
  isFinal = false,
  previewData,
  appUrl,
  slug,
  children,
}: StepShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Autofocus del primer campo al montar el paso. preventScroll: el layout
  // ya posiciona el form arriba; no queremos saltos de scroll (tampoco con
  // prefers-reduced-motion).
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE_FIELD_SELECTOR);
    el?.focus({ preventScroll: true });
  }, []);

  // Enter = Continuar (mismo handler y mismo disabled que el botón).
  // Esc = cerrar drawer del preview, o Atrás.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      if (e.key === "Escape") {
        if (drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
          return;
        }
        if (back) {
          e.preventDefault();
          back();
        }
        return;
      }

      if (e.key !== "Enter") return;
      if (tag === "textarea" || target?.isContentEditable) return;
      // Botones/links/summary manejan su propio Enter (click nativo).
      if (tag === "button" || tag === "a" || tag === "summary") return;
      if (tag === "input") {
        const type = (target as HTMLInputElement).type;
        if (type === "file" || type === "button" || type === "submit") return;
      }
      if (!next || nextDisabled) return;
      e.preventDefault();
      next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, nextDisabled, drawerOpen]);

  const showPreview = !!previewData && !isFinal && stepIdx >= 3;
  const previewProps: PublicCardData | undefined = previewData
    ? { ...previewData, slug: slug ?? previewData.slug }
    : undefined;

  return (
    <div className={`onb-shell ${showPreview ? "onb-shell-split" : ""}`}>
      <div className="onb-shell-form">
        <div className="onb-step">
          {!isFinal ? (
            <header className="onb-step-head">
              <div
                className="onb-progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={ONB_TOTAL}
                aria-valuenow={stepIdx}
                aria-label={`Paso ${stepIdx} de ${ONB_TOTAL}`}
              >
                <span
                  className="onb-progress-fill"
                  style={{ width: `${((stepIdx - 1) / (ONB_TOTAL - 1)) * 100}%` }}
                />
              </div>
              <span className="onb-step-num fm-mono">
                Paso {stepIdx} de {ONB_TOTAL}
              </span>
              <h1>{headline}</h1>
              {sub ? <p className="onb-step-sub">{sub}</p> : null}
            </header>
          ) : null}

          <div className="onb-step-body" ref={bodyRef}>{children}</div>

          {!isFinal ? (
            <footer className="onb-step-foot">
              {back ? (
                <button
                  type="button"
                  className="fi-btn fi-btn-ghost onb-foot-back"
                  onClick={back}
                  title="Atrás (Esc)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Atrás
                </button>
              ) : (
                <span />
              )}
              <span className="onb-foot-grow" />
              {canSkip && skip ? (
                <button type="button" className="onb-skip" onClick={skip}>
                  Saltar este paso
                </button>
              ) : null}
              <button
                type="button"
                className="fi-btn fi-btn-primary onb-foot-next"
                onClick={next}
                disabled={nextDisabled}
                title="Continuar (Enter)"
              >
                {nextLabel}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                <span className="onb-foot-kbd" aria-hidden>↵</span>
              </button>
            </footer>
          ) : null}
        </div>
      </div>

      {showPreview && previewProps ? (
        <>
          <aside className="onb-shell-preview" aria-label="Vista previa de tu card pública">
            <div className="onb-preview-sticky">
              <span className="onb-preview-label">Tu card pública</span>
              <PublicCard
                data={previewProps}
                variant="preview"
                appUrl={appUrl ?? APP_URL_DEFAULT}
              />
              <p className="onb-preview-fine">
                Así te ven los pacientes en tu link público. Se actualiza mientras escribís.
              </p>
            </div>
          </aside>

          <button
            type="button"
            className={`onb-preview-fab ${drawerOpen ? "is-open" : ""}`}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? "Cerrar preview" : "Ver mi card"}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            <span>{drawerOpen ? "Cerrar" : "Ver mi card"}</span>
          </button>

          {drawerOpen ? (
            <div className="onb-preview-drawer" role="dialog" aria-modal="true">
              <div className="onb-preview-drawer-inner">
                <div className="onb-preview-drawer-head">
                  <span className="onb-preview-label">Tu card pública</span>
                  <button
                    type="button"
                    className="onb-preview-close"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Cerrar"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <PublicCard
                  data={previewProps}
                  variant="preview"
                  appUrl={appUrl ?? APP_URL_DEFAULT}
                />
              </div>
              <div className="onb-preview-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
