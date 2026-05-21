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
 * Footer: muestra hint "↵ continuar" en desktop como guía sutil de keyboard.
 */

import type { ReactNode } from "react";
import { useState } from "react";

import {
  PublicCard,
  type PublicCardData,
} from "@/components/public-card/public-card";

export const ONB_TOTAL = 9;

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
  /** URL base (folio-app-ten.vercel.app) para el link del preview. */
  appUrl?: string;
  /** Slug actual de la org (sirve también para el link del preview). */
  slug?: string;
  children: ReactNode;
}

const APP_URL_DEFAULT =
  typeof window !== "undefined" ? window.location.host : "folio-app-ten.vercel.app";

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
              <span className="onb-step-num fm-mono">
                Paso {stepIdx} de {ONB_TOTAL}
              </span>
              <h1>{headline}</h1>
              {sub ? <p className="onb-step-sub">{sub}</p> : null}
            </header>
          ) : null}

          <div className="onb-step-body">{children}</div>

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
