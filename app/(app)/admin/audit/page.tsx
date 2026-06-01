/**
 * Folio · /admin/audit
 *
 * Audit dashboard read-only para OWNER / DIRECTOR. Lista las últimas 100
 * entradas del audit_log de la org activa con filtros por fecha, actor,
 * recurso, acción.
 *
 * Compliance: cumple con Ley 25.326 art. 11 (acceso a logs por titular) y
 * Ley 26.529 art. 15 (custodia + autenticidad). Retención 10 años garantizada
 * por particionado mensual + política de archive a Storage (F12).
 */

import { notFound } from "next/navigation";

import { AuditTable } from "@/components/admin/audit-table";
import { getAuditStats, listAuditEntries } from "@/lib/db/audit";

interface PageProps {
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    actor?: string;
    resource?: string;
    action?: string;
  }>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const [entriesResult, statsResult] = await Promise.all([
    listAuditEntries({
      fechaDesde: params.desde,
      fechaHasta: params.hasta,
      actorId: params.actor,
      resourceType: params.resource,
      action: params.action,
      limit: 100,
      offset: 0,
    }),
    getAuditStats(),
  ]);

  if (!entriesResult.ok) {
    // forbidden → 404 (no revelar existencia del recurso a roles sin permiso).
    if (entriesResult.error.code === "forbidden") {
      notFound();
    }
    // Cualquier otra falla (db_error, etc.) NO debe renderizar una tabla vacía:
    // sería indistinguible de "no hay eventos" y es un riesgo de compliance
    // (Ley 25.326 / 26.529). Lanzamos para que error.tsx muestre el fallo.
    throw new Error(
      `No se pudo cargar el audit log: ${entriesResult.error.message}` +
        (entriesResult.error.detail ? ` (${entriesResult.error.detail})` : ""),
    );
  }

  const entries = entriesResult.data;
  const stats = statsResult.ok ? statsResult.data : null;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 24 }}>
        <span className="fi-eyebrow">Compliance · Ley 25.326 / 26.529</span>
        <h1 style={{ fontSize: 28, marginTop: 8 }}>Audit log</h1>
        <p style={{ color: "var(--ink-3)", marginTop: 4 }}>
          Registro inmutable de acciones sobre datos clínicos. Retención 10 años.
        </p>
      </header>

      {stats ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <StatCard label="Eventos" value={stats.total.toLocaleString("es-AR")} sub={stats.periodo} />
          <StatCard label="Actores únicos" value={stats.actores.toString()} sub={stats.periodo} />
          <StatCard label="Tipos de recurso" value={stats.recursos.toString()} sub={stats.periodo} />
        </div>
      ) : null}

      <AuditTable entries={entries} />
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line-soft)",
        borderRadius: "var(--r-md)",
        padding: "16px 18px",
      }}
    >
      <span className="fi-eyebrow">{label}</span>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}
