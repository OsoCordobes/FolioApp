"use client";

/**
 * Folio · Onboarding · Step 9 "the moment".
 *
 * Reveal coreografiado al cierre del onboarding:
 *   0-400ms   Logo aparece (scale 0.92→1.0 + fade).
 *   400-800ms Headline aparece (translateY 12→0 + fade).
 *   800-1400ms Card emerge desde abajo (translateY 24→0 + fade + sombra).
 *   1400-1800ms Tres CTAs con stagger 80ms (translateY 8→0 + fade).
 *
 * Idle: el avatar dentro de la card pulsa sutil cada 4s (vida).
 *
 * Llama finalizeOnboarding() al montar (no antes — el user llegó acá). Si
 * falla, muestra error y permite reintentar.
 *
 * 3 CTAs (jerarquía clara):
 *   1. "Ver mi página" → abre /book/<slug> en nueva tab (primary).
 *   2. "Copiar link"   → portapapeles + feedback (secondary).
 *   3. "Ir al panel"   → redirect a /hoy (ghost, decisión final).
 *
 * Respeta prefers-reduced-motion: animaciones se reducen a fades cortos.
 */

import { useEffect, useState } from "react";

import { CardPreview, type CardPreviewData } from "@/components/onboarding/card-preview";
import { FolioMark } from "@/components/folio-mark";
import { listRubros } from "@/lib/onboarding/templates";
import type { OnboardingDataState } from "@/components/onboarding/steps";

interface Step9MomentProps {
  data: OnboardingDataState;
  accent: string;
  /** Slug real persistido en DB. Si undefined, el flujo está mal — mostramos error. */
  slug?: string;
  /** Marca onboarding_completed=true en DB. Idempotente. */
  onFinish: () => Promise<void> | void;
  /** Redirige al panel /hoy. */
  onGoToPanel: () => void;
  finishing?: boolean;
  error?: string | null;
}

const APP_URL =
  typeof window !== "undefined" ? window.location.origin : "https://folio-app-ten.vercel.app";

export function Step9Moment({
  data,
  accent,
  slug,
  onFinish,
  onGoToPanel,
  finishing,
  error,
}: Step9MomentProps) {
  const [copied, setCopied] = useState(false);
  const [finalized, setFinalized] = useState(false);

  // Finalizar onboarding al montar (idempotente — el server lo soporta).
  useEffect(() => {
    if (finalized) return;
    void Promise.resolve(onFinish()).finally(() => setFinalized(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullName = [data.nombre, data.apellido].filter(Boolean).join(" ").trim() || "Tu consultorio";
  const publicUrl = slug ? `${APP_URL}/book/${slug}` : null;
  const linkText = slug ? `${stripScheme(APP_URL)}/book/${slug}` : "tu link público";

  const cardData: CardPreviewData = {
    nombre: fullName,
    consultorioNombre: data.consultorioNombre,
    rubro: rubroLabel(data.rubro),
    ciudad: data.ciudad,
    provincia: data.provincia,
    bio: data.bio,
    telefonoPublico: data.telefonoPublico || data.tel,
    instagramHandle: data.instagram,
    direccionCompleta: data.direccion,
    acentoHex: accent,
    slug: slug ?? undefined,
    servicios: data.servicios
      .filter((s) => s.nombre.trim())
      .map((s) => ({
        nombre: s.nombre,
        dur: s.dur,
        precioCents: Math.round(s.precio * 100),
      })),
  };

  const onCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const onSeePage = () => {
    if (!publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="onb-moment" data-accent={accent}>
      <div className="onb-moment-mark onb-anim-mark">
        <FolioMark size={56} color={accent} fg="#FBF9F4" />
      </div>

      <h1 className="onb-moment-head onb-anim-head">Tu consultorio está listo.</h1>
      <p className="onb-moment-sub onb-anim-head">
        Compartí tu link y empezá a recibir reservas hoy mismo.
      </p>

      <div className="onb-moment-card onb-anim-card">
        <CardPreview data={cardData} variant="full" appUrl={APP_URL} />
      </div>

      {publicUrl ? (
        <div className="onb-moment-link onb-anim-link" aria-label="Tu link público">
          <span className="fi-eyebrow onb-moment-link-label">Tu link público</span>
          <div className="onb-moment-link-row">
            <span className="onb-moment-url fm-mono">{linkText}</span>
            <button
              type="button"
              className={`fi-btn fi-btn-secondary onb-moment-copy ${copied ? "is-copied" : ""}`}
              onClick={onCopy}
            >
              {copied ? (
                <>
                  <CheckIcon /> Copiado
                </>
              ) : (
                <>
                  <CopyIcon /> Copiar
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="au-err onb-banner-err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="onb-moment-ctas">
        <button
          type="button"
          className="fi-btn fi-btn-primary onb-moment-cta onb-anim-cta-1"
          onClick={onSeePage}
          disabled={!publicUrl}
        >
          Ver mi página
          <ExternalIcon />
        </button>
        <button
          type="button"
          className="fi-btn fi-btn-secondary onb-moment-cta onb-anim-cta-2"
          onClick={onCopy}
          disabled={!publicUrl}
        >
          Copiar link
        </button>
        <button
          type="button"
          className="fi-btn fi-btn-ghost onb-moment-cta onb-anim-cta-3"
          onClick={onGoToPanel}
          disabled={finishing}
        >
          {finishing ? "Abriendo panel…" : "Ir al panel"}
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}

// ─── Iconos / helpers ───────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function rubroLabel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const found = listRubros().find((r) => r.id === id);
  return found?.label;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
