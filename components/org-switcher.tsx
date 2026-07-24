"use client";

/**
 * Folio · selector de organización activa (sidebar).
 *
 * Visible solo cuando el user tiene MÁS de una membresía (clínicas con varios
 * consultorios, cuenta de soporte/demo con orgs internas por especialidad).
 * Cambia la cookie `folio.active_org` vía switchActiveOrgAction — la
 * validación de membresía es server-side (setActiveOrg) — y refresca el árbol
 * completo, que depende de la org activa.
 *
 * Las orgs internas (is_internal_account) se marcan "· demo" para que nunca
 * se confundan con el consultorio real en una llamada en vivo.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { switchActiveOrgAction } from "@/app/(app)/actions";

export interface OrgSwitcherOption {
  organizationId: string;
  organizationNombre: string;
  isInternalAccount: boolean;
}

interface Props {
  orgs: OrgSwitcherOption[];
  activeOrgId: string;
}

export function OrgSwitcher({ orgs, activeOrgId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (orgs.length < 2) return null;

  function onChange(organizationId: string) {
    if (organizationId === activeOrgId) return;
    setErr(null);
    startTransition(async () => {
      const result = await switchActiveOrgAction(organizationId);
      if (!result.ok) {
        setErr(result.message ?? "No se pudo cambiar de consultorio.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="fi-org-switcher">
      <label className="fi-org-switcher-lbl" htmlFor="fi-org-switcher-select">
        Consultorio
      </label>
      <select
        id="fi-org-switcher-select"
        value={activeOrgId}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      >
        {orgs.map((o) => (
          <option key={o.organizationId} value={o.organizationId}>
            {o.organizationNombre}
            {o.isInternalAccount ? " · demo" : ""}
          </option>
        ))}
      </select>
      {err ? <span className="fi-org-switcher-err">{err}</span> : null}
    </div>
  );
}
