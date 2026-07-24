"use client";

/**
 * Folio · harness client de /dev/shell-mobile.
 *
 * Monta los tres componentes nuevos de C1+C4 con data de muestra:
 *  - MobileNav con org demo (switcher de especialidad incluido) — visible
 *    solo bajo el breakpoint ≤920px, como en el shell real.
 *  - Botones que disparan toasts (tono ok / error) via useToast().
 *  - ConfirmDialog default y danger, abiertos a demanda.
 */

import { useState } from "react";

import { MobileNav } from "@/components/mobile-nav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToastProvider, useToast } from "@/components/ui/toast";

export function ShellMobileHarness() {
  return (
    <ToastProvider>
      <div className="fi-app">
        <main className="fi-main">
          <div className="fi-content">
            <span className="fi-eyebrow">dev · shell mobile</span>
            <h1>Bottom-nav + toasts + confirmaciones</h1>
            <p style={{ color: "var(--ink-3)", maxWidth: 520 }}>
              Achicá el viewport a ≤920px para ver la bottom-nav. Los botones
              de abajo disparan los componentes de feedback de C4.
            </p>
            <DemoControls />
          </div>
        </main>
        <MobileNav
          organization={{ nombre: "Consultorio Demo", slug: "demo", isInternalAccount: true }}
          role="OWNER"
          esColegiado
          especialidad="quiropraxia"
          especialidadOverride={null}
          memberships={[]}
          activeOrgId="dev-org"
        />
      </div>
    </ToastProvider>
  );
}

function DemoControls() {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<"default" | "danger" | null>(null);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
      <button
        type="button"
        className="fi-btn fi-btn-primary"
        onClick={() => toast.show({ titulo: "Turno creado · 10:30 · Ana López" })}
      >
        Toast ok
      </button>
      <button
        type="button"
        className="fi-btn fi-btn-secondary"
        onClick={() =>
          toast.show({ titulo: "Ningún paciente seleccionado tiene teléfono.", tono: "error" })
        }
      >
        Toast error
      </button>
      <button type="button" className="fi-btn fi-btn-ghost" onClick={() => setConfirmar("default")}>
        ConfirmDialog
      </button>
      <button type="button" className="fi-btn fi-btn-ghost" onClick={() => setConfirmar("danger")}>
        ConfirmDialog danger
      </button>

      {confirmar === "default" ? (
        <ConfirmDialog
          titulo="¿Marcar que Ana López no asistió?"
          mensaje="El turno queda registrado como «No asistió»."
          confirmLabel="Marcar no asistió"
          onConfirm={() => toast.show({ titulo: "No asistió registrado · 10:30 · Ana López" })}
          onClose={() => setConfirmar(null)}
        />
      ) : null}
      {confirmar === "danger" ? (
        <ConfirmDialog
          titulo="¿Cancelar el turno de Ana López?"
          mensaje="Esta acción queda en el audit log y no se puede borrar."
          confirmLabel="Cancelar turno"
          variant="danger"
          onConfirm={() => toast.show({ titulo: "Turno cancelado · 10:30 · Ana López" })}
          onClose={() => setConfirmar(null)}
        />
      ) : null}
    </div>
  );
}
