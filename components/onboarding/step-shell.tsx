"use client";

/**
 * Folio · Onboarding · helper de layout para cada paso.
 *
 * Port de `onbStepShell` en folio/onboarding-steps.jsx. Envuelve el cuerpo
 * del paso con header (paso N de 9 + headline + sub) y footer (atrás +
 * saltar + continuar). En F1 solo Step1 está implementado; los demás se
 * agregan en F3.
 */

import type { ReactNode } from "react";

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
  isFinal?: boolean;
  children: ReactNode;
}

export function StepShell({
  stepIdx,
  headline,
  sub,
  back,
  next,
  skip,
  canSkip = true,
  nextLabel = "Continuar",
  isFinal = false,
  children,
}: StepShellProps) {
  return (
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
            <button type="button" className="fi-btn fi-btn-ghost" onClick={back}>
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
          <button type="button" className="fi-btn fi-btn-primary" onClick={next}>
            {nextLabel}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </footer>
      ) : null}
    </div>
  );
}
