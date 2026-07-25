"use client";

/**
 * Folio · Portal · consentimientos-view — lista + firma desde el portal (Fase 3 · P6).
 *
 * Componente de cliente self-fetching: lista los consentimientos del paciente
 * (vigentes + revocados), abre la imagen de cada firma vía signed URL (por id, 5 min)
 * y ofrece firmar uno nuevo (FirmaPortalModal). Las plantillas y las fichas se cargan
 * recién al abrir el modal. Cero SOAP/riesgo — el shape es el whitelist de P6.
 */

import { useEffect, useState } from "react";

import type { PlantillaVigente } from "@/lib/consentimientos/helpers";
import type { PortalConsentimientoItem } from "@/lib/db/portal-consentimientos";

import {
  getFirmaUrlPortalAction,
  listConsentimientosPortalAction,
  listPlantillasPortalAction,
} from "./actions";
import { FirmaPortalModal, type FichaPortal } from "./firma-portal-modal";

const FMT_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function fmtFecha(iso: string): string {
  try {
    return FMT_FECHA.format(new Date(iso));
  } catch {
    return iso;
  }
}

interface ModalData {
  plantillas: PlantillaVigente[];
}

export function ConsentimientosView({ fichas }: { fichas: FichaPortal[] }) {
  const [items, setItems] = useState<PortalConsentimientoItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);

  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [abriendoModal, setAbriendoModal] = useState(false);
  const [firmaPendingId, setFirmaPendingId] = useState<string | null>(null);

  const cargar = async () => {
    const result = await listConsentimientosPortalAction();
    if (result.ok) {
      setItems(result.data);
      setLoadError(null);
    } else {
      setItems([]);
      setLoadError(result.error.message);
    }
  };

  useEffect(() => {
    void cargar();
  }, []);

  const abrirModal = async () => {
    if (abriendoModal) return;
    setAbriendoModal(true);
    setAccionError(null);
    try {
      const plantillas = await listPlantillasPortalAction();
      if (!plantillas.ok) {
        setAccionError(plantillas.error.message);
        return;
      }
      setModalData({ plantillas: plantillas.data });
    } finally {
      setAbriendoModal(false);
    }
  };

  const verFirma = async (id: string) => {
    if (firmaPendingId) return;
    setFirmaPendingId(id);
    setAccionError(null);
    try {
      const result = await getFirmaUrlPortalAction(id);
      if (!result.ok) {
        setAccionError(result.error.message);
        return;
      }
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setFirmaPendingId(null);
    }
  };

  const vigentes = items?.filter((c) => c.vigente).length ?? 0;
  const puedeFirmar = fichas.length > 0;

  return (
    <div>
      <div className="pt-toolbar">
        {puedeFirmar && items && items.length > 0 ? (
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => {
              void abrirModal();
            }}
            disabled={abriendoModal}
            aria-busy={abriendoModal}
          >
            {abriendoModal ? "Abriendo…" : "Firmar consentimiento"}
          </button>
        ) : null}
      </div>

      {items === null ? (
        <p className="pt-empty">Cargando consentimientos…</p>
      ) : loadError ? (
        <p className="au-notice pt-msg-err" role="alert">
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <div className="pt-empty pt-empty-hero">
          <p className="pt-empty-title">No tenés consentimientos firmados</p>
          <p className="pt-empty-sub">
            La Ley 26.529 pide tu consentimiento informado para la atención —
            podés firmarlo desde acá.
          </p>
          {puedeFirmar ? (
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={() => {
                void abrirModal();
              }}
              disabled={abriendoModal}
              aria-busy={abriendoModal}
            >
              {abriendoModal ? "Abriendo…" : "Firmar consentimiento"}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="pt-org-list">
            {items.map((c) => (
              <li key={c.id} className="pt-card">
                <div className="pt-card-row">
                  <strong className="pt-card-title">{c.titulo}</strong>
                  <span className={`pt-chip ${c.vigente ? "pt-chip--green" : "pt-chip--red"}`}>
                    {c.vigente ? "Vigente" : "Revocado"}
                  </span>
                </div>
                <p className="pt-card-meta">
                  {c.organizacionNombre ?? "Consultorio"}
                  {" · "}
                  {c.tipoLabel}
                  {c.version != null ? ` · v${c.version}` : ""}
                </p>
                <div className="pt-card-foot">
                  <span className="pt-footnote">
                    Firmado el {fmtFecha(c.firmadoEn)}
                    {c.revocadoEn ? ` · Revocado el ${fmtFecha(c.revocadoEn)}` : ""}
                  </span>
                  <button
                    type="button"
                    className="fi-btn fi-btn-ghost pt-nowrap"
                    onClick={() => {
                      void verFirma(c.id);
                    }}
                    disabled={firmaPendingId !== null}
                    title="Abrir la imagen de tu firma en una pestaña nueva (link válido 5 minutos)"
                  >
                    {firmaPendingId === c.id ? "Abriendo…" : "Ver firma"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="pt-footnote pt-footnote-page">
            {vigentes === 1 ? "1 consentimiento vigente" : `${vigentes} consentimientos vigentes`}
            {" · "}los links de firma expiran a los 5 minutos.
          </p>
        </>
      )}

      {accionError ? (
        <p className="au-notice pt-msg-err" role="alert">
          {accionError}
        </p>
      ) : null}

      {modalData ? (
        <FirmaPortalModal
          fichas={fichas}
          plantillas={modalData.plantillas}
          onClose={() => setModalData(null)}
          onCreated={() => {
            setModalData(null);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}
