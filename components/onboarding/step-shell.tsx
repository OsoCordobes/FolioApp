"use client";

/**
 * Folio · Onboarding · Step shell con split layout + live preview.
 *
 * Desktop ≥1024px: split horizontal. Form a la izquierda (max 560px),
 * <PublicCardLive /> sticky a la derecha (360px).
 *
 * Mobile <1024px: form full-width. Un botón después del formulario abre
 * la vista previa en un diálogo modal. No tapa campos ni acciones.
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
 * El diálogo contiene el foco y al cerrarse lo devuelve a su apertura.
 */

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { BookLandingPreview } from "@/components/book-landing/book-landing-preview";
import type { PublicLandingViewData } from "@/components/book-landing/book-landing-view";

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
  compactFlow?: boolean;
  isFinal?: boolean;
  /** Datos para el <PublicCardLive />. Si no hay → no se muestra preview. */
  previewData?: PublicLandingViewData;
  /** Slug actual de la org (sirve también para el link del preview). */
  slug?: string;
  children: ReactNode;
}

// Campos que reciben el autofocus al montar un paso. Excluimos hidden/file/
// checkbox/radio (enfocar el file input del Step 4 haría ambiguo el Enter) y
// disabled/readOnly (el email de Step1Consent ya está confirmado).
const FOCUSABLE_FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])';

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
  compactFlow = false,
  isFinal = false,
  previewData,
  slug,
  children,
}: StepShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDialogElement | null>(null);
  const previewId = useId();

  useEffect(() => {
    const dialog = previewRef.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) dialog.showModal();
    if (!drawerOpen && dialog.open) dialog.close();
  }, [drawerOpen]);

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
      if (e.defaultPrevented || e.isComposing || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      if (drawerOpen && e.key === "Tab") {
        const controls = Array.from(previewRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first && last && ((e.shiftKey && target === first) || (!e.shiftKey && target === last))) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
        return;
      }

      // La selección nativa y sus popovers son dueños de Enter/Escape.
      // Tampoco consumimos teclas de navegación fuera de este asistente.
      if (!drawerOpen) {
        if (!target || !shellRef.current?.contains(target)) return;
        if (tag === "select") return;
        if (tag === "input" && ["date", "datetime-local", "month", "time", "week", "color", "range"].includes((target as HTMLInputElement).type)) return;
      }

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

      if (drawerOpen || e.key !== "Enter") return;
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
  const progressStep = compactFlow ? ({ 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 8: 6 } as Record<number, number>)[stepIdx] ?? stepIdx : stepIdx;
  const progressTotal = compactFlow ? 6 : ONB_TOTAL;
  const progressLabel = compactFlow
    ? ({ 1: "Tu cuenta", 2: "Titular", 3: "Tu clínica", 4: "Tu página", 6: "Servicios", 8: "Todo listo" } as Record<number, string>)[stepIdx]
    : ["", "Tu cuenta", "Tu perfil", "Tu consultorio", "Tu página", "Horarios", "Servicios", "Calendario", "Todo listo"][stepIdx];
  const previewProps: PublicLandingViewData | undefined = previewData
    ? { ...previewData, org: { ...previewData.org, slug: slug ?? previewData.org.slug } }
    : undefined;

  return (
    <div ref={shellRef} className={`onb-shell fx-onb-shell ${showPreview ? "onb-shell-split" : ""} ${stepIdx === 4 ? "onb-step4" : ""}`}>
      <div className="onb-shell-form">
        <div className="onb-step">
          {!isFinal ? (
            <header className="onb-step-head">
              <div className="fx-onb-progress-label">
                <span className="onb-step-num">Paso {progressStep} de {progressTotal}</span>
                <span>{progressLabel}</span>
              </div>
              <div
                className="onb-progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={progressTotal}
                aria-valuenow={progressStep}
                aria-label={`Paso ${progressStep} de ${progressTotal}`}
              >
                <span
                  className="onb-progress-fill"
                  style={{ width: `${((progressStep - 1) / (progressTotal - 1)) * 100}%` }}
                />
              </div>
              <h1>{headline}</h1>
              {sub ? <p className="onb-step-sub">{sub}</p> : null}
              {stepIdx === 4 && showPreview ? (
                <button type="button" className="onb-mobile-preview-trigger" onClick={() => setDrawerOpen(true)} aria-controls={previewId} aria-expanded={drawerOpen}>
                  Ver mi página <span aria-hidden="true">↗</span>
                </button>
              ) : null}
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
              {canSkip && skip && stepIdx !== 4 ? (
                <button type="button" className="onb-skip" onClick={skip}>
                  Configurar después
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
              </button>
            </footer>
          ) : null}
        </div>
      </div>

      {showPreview && previewProps ? (
        <>
          <aside className="onb-shell-preview" aria-label="Vista previa de tu perfil público">
            <div className="onb-preview-sticky">
              <div className="onb-preview-heading">
                <span className="onb-preview-label">Vista previa de tu página</span>
                {stepIdx === 4 ? <button type="button" className="onb-preview-expand" onClick={() => setDrawerOpen(true)}>Ampliar vista previa ↗</button> : null}
              </div>
              <div className="onb-landing-preview"><BookLandingPreview data={previewProps} /></div>
              <p className="onb-preview-fine">
                Esta página muestra los datos que completaste. Los pacientes no pueden reservar desde esta vista previa.
              </p>
            </div>
          </aside>

          <button
            type="button"
            className={`onb-preview-fab ${drawerOpen ? "is-open" : ""}`}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? "Cerrar vista previa" : "Ampliar vista previa"}
            aria-expanded={drawerOpen}
            aria-controls={previewId}
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
            <span>{drawerOpen ? "Cerrar" : "Ampliar vista previa"}</span>
          </button>

            <dialog
              id={previewId}
              ref={previewRef}
              className="onb-preview-drawer"
              aria-labelledby={`${previewId}-title`}
              onCancel={(event) => { event.preventDefault(); setDrawerOpen(false); }}
              onClose={() => setDrawerOpen(false)}
            >
              <div className="onb-preview-drawer-inner">
                <div className="onb-preview-drawer-head">
                  <span id={`${previewId}-title`} className="onb-preview-label">Vista previa de tu página</span>
                  <button
                    type="button"
                    className="onb-preview-close"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Cerrar vista previa"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="onb-landing-preview"><BookLandingPreview data={previewProps} /></div>
              </div>
              <div className="onb-preview-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
            </dialog>
        </>
      ) : null}
    </div>
  );
}
