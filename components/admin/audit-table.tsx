/**
 * Folio · AuditTable
 *
 * Tabla densa de auditoría con timestamp, actor, acción y resource. Sin
 * dependencias client-side para mantenerla server-rendered.
 */

import type { AuditEntry } from "@/lib/db/audit";

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Argentina/Cordoba",
  });
}

const SEVERITY_COLOR: Record<string, string> = {
  insert: "rgb(34, 197, 94)",
  update: "rgb(59, 130, 246)",
  delete: "rgb(239, 68, 68)",
  lock: "rgb(245, 158, 11)",
  pseudonimizar: "rgb(217, 70, 239)",
};

function actionColor(action: string): string {
  const last = action.split(".").pop()?.toLowerCase() ?? "";
  return SEVERITY_COLOR[last] ?? "var(--ink-2)";
}

const cell: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--line-soft)",
  fontSize: 13,
  verticalAlign: "top",
};

const headCell: React.CSSProperties = {
  ...cell,
  textAlign: "left",
  fontWeight: 600,
  color: "var(--ink-2)",
  textTransform: "uppercase",
  fontSize: 11,
  letterSpacing: 0.4,
  background: "var(--surface-2, var(--surface))",
};

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ color: "var(--ink-3)", padding: 16, textAlign: "center" }}>
        No hay eventos en el rango seleccionado.
      </p>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line-soft)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={headCell}>Cuándo</th>
            <th style={headCell}>Actor</th>
            <th style={headCell}>Acción</th>
            <th style={headCell}>Recurso</th>
            <th style={headCell}>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td style={{ ...cell, fontFamily: "var(--ff-mono, monospace)", whiteSpace: "nowrap" }}>
                {fmtTs(e.ts)}
              </td>
              <td style={cell}>
                <div style={{ fontWeight: 500 }}>{e.actor_role ?? "—"}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--ff-mono, monospace)" }}>
                  {e.actor_id ? e.actor_id.slice(0, 8) : "system"}
                </div>
              </td>
              <td style={{ ...cell, color: actionColor(e.action), fontWeight: 500 }}>{e.action}</td>
              <td style={cell}>
                <div>{e.resource_type}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--ff-mono, monospace)" }}>
                  {e.resource_id.slice(0, 8)}
                </div>
              </td>
              <td style={{ ...cell, fontFamily: "var(--ff-mono, monospace)", fontSize: 11, color: "var(--ink-3)" }}>
                <details>
                  <summary style={{ cursor: "pointer" }}>ver payload</summary>
                  <pre
                    style={{
                      margin: "6px 0 0",
                      padding: 8,
                      background: "var(--surface-2, var(--surface))",
                      borderRadius: 4,
                      maxWidth: 360,
                      maxHeight: 200,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
