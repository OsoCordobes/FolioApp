/**
 * Folio · InsightsCard
 *
 * Tarjeta de insights k-anónimos para /finanzas. Server Component que renderiza
 * lo que ya está en `analytics.org_insights_cache`. Si no hay insights (cohort
 * no llegó a k), muestra un mensaje neutro y honesto.
 *
 * Sistema visual: usa variables de folio.css (--surface, --line-soft, --ink-*,
 * --r-md, etc.) vía estilos inline para no contaminar la hoja pristine.
 * Sin emojis (regla del usuario).
 */

import type { CSSProperties } from "react";

import type { Insight, InsightsBundle } from "@/lib/db/insights";

const SEVERITY_BG: Record<Insight["severity"], string> = {
  positive: "rgba(34, 197, 94, 0.08)",
  neutral: "var(--surface-2, var(--surface))",
  attention: "rgba(245, 158, 11, 0.10)",
};

const SEVERITY_BORDER: Record<Insight["severity"], string> = {
  positive: "rgba(34, 197, 94, 0.30)",
  neutral: "var(--line-soft)",
  attention: "rgba(245, 158, 11, 0.35)",
};

const SEVERITY_INK: Record<Insight["severity"], string> = {
  positive: "rgb(21, 128, 61)",
  neutral: "var(--ink-2)",
  attention: "rgb(180, 83, 9)",
};

const SEVERITY_LABEL: Record<Insight["severity"], string> = {
  positive: "Buena señal",
  neutral: "Observación",
  attention: "Para mirar",
};

function fmtPeriodo(periodo: string): string {
  const d = new Date(periodo + "T12:00:00-03:00");
  const fmt = d.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Cordoba",
  });
  return fmt.charAt(0).toUpperCase() + fmt.slice(1);
}

function nivelLabel(nivel: Insight["nivel"], ambito: string): string {
  switch (nivel) {
    case "ciudad":    return ambito;
    case "gran_area": return ambito;
    case "provincia": return `prov. ${ambito}`;
    case "region":    return `región ${ambito}`;
    case "nacional":  return "Argentina";
  }
}

const sectionStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line-soft)",
  borderRadius: "var(--r-md)",
  padding: "20px 24px",
  marginBottom: 24,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "var(--ink)",
  marginTop: 4,
};

const periodoStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--ink-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 500,
};

const emptyStyle: CSSProperties = {
  color: "var(--ink-3)",
  fontSize: 14,
  lineHeight: 1.6,
  margin: 0,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

export function InsightsCard({ bundle }: { bundle: InsightsBundle | null }) {
  return (
    <section style={sectionStyle} aria-labelledby="fn-insights-title">
      <header style={headerStyle}>
        <div>
          <span className="fi-eyebrow">Insights anónimos</span>
          <h2 id="fn-insights-title" style={titleStyle}>
            Comparativa con colegas
          </h2>
        </div>
        {bundle ? <span style={periodoStyle}>{fmtPeriodo(bundle.periodo)}</span> : null}
      </header>

      {!bundle || bundle.insights.length === 0 ? (
        <p style={emptyStyle}>
          Todavía no hay suficientes colegas en tu región para generar comparativas. Tus
          datos aportan al cohort agregado (k≥5 · k≥10 para precios) — los insights aparecen
          apenas se alcanza el mínimo de privacidad.
        </p>
      ) : (
        <ul style={listStyle}>
          {bundle.insights.slice(0, 5).map((it) => (
            <li
              key={it.metrica + it.condicion}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: "12px 14px",
                background: SEVERITY_BG[it.severity],
                border: `1px solid ${SEVERITY_BORDER[it.severity]}`,
                borderRadius: "var(--r-sm)",
                color: "var(--ink)",
              }}
            >
              <div style={{ color: SEVERITY_INK[it.severity], paddingTop: 2 }} aria-hidden>
                <IconForSeverity severity={it.severity} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 4,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  <span style={{ color: SEVERITY_INK[it.severity], fontWeight: 600 }}>
                    {SEVERITY_LABEL[it.severity]}
                  </span>
                  <span style={{ color: "var(--ink-3)" }}>
                    {nivelLabel(it.nivel, it.ambito)} · n={it.n_orgs_cohort}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>
                  {it.copy}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconForSeverity({ severity }: { severity: Insight["severity"] }) {
  if (severity === "positive") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    );
  }
  if (severity === "attention") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
