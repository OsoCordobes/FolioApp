"use client";

/**
 * Folio · ConsentimientosCard · card de consentimientos informados en el tab
 * Información de la ficha (Ley 26.529 art. 5-11).
 *
 * Lista vigentes + revocados (tipo, fecha, firmante), con:
 *   - "Ver firma": signed URL de 5 min (por consentimientoId, nunca paths del
 *     cliente) abierto en pestaña nueva.
 *   - "Revocar": confirmación inline con motivo obligatorio (art. 11 — la
 *     revocación es por escrito; el archivo de la firma se CONSERVA por
 *     compliance).
 *   - Empty state con CTA "Registrar consentimiento".
 *
 * Self-fetching vía Server Actions (el contexto de la ficha no conoce
 * consentimientos — cambio mínimo en paciente-detalle.tsx). Las plantillas y
 * los tutores se cargan recién al abrir el modal de firma.
 */

import { useEffect, useState } from "react";

import {
  getFirmaConsentimientoUrlAction,
  listConsentimientosPacienteAction,
  listPlantillasConsentimientoAction,
  listTutoresConsentimientoAction,
  revokeConsentimientoAction,
} from "@/app/(app)/pacientes/actions";
import { FirmaCanvasModal } from "@/components/paciente/firma-canvas-modal";
import type {
  ConsentimientoListItem,
  PlantillaVigente,
  TutorOption,
} from "@/lib/consentimientos/helpers";

interface ConsentimientosCardProps {
  pacienteId: string;
  pacienteNombre: string;
}

interface ModalData {
  plantillas: PlantillaVigente[];
  tutores: TutorOption[];
}

const TZ_AR = "America/Argentina/Buenos_Aires";

function fmtFechaFirma(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: TZ_AR,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

export function ConsentimientosCard({ pacienteId, pacienteNombre }: ConsentimientosCardProps) {
  const [items, setItems] = useState<ConsentimientoListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [abriendoModal, setAbriendoModal] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  // Revocación inline: id del consentimiento con el confirm abierto + motivo.
  const [revocandoId, setRevocandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [revocarPending, setRevocarPending] = useState(false);
  const [firmaPendingId, setFirmaPendingId] = useState<string | null>(null);

  const cargar = async () => {
    const result = await listConsentimientosPacienteAction(pacienteId);
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
    // Mount-only por paciente: las mutaciones re-llaman cargar() a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteId]);

  const abrirModal = async () => {
    if (abriendoModal) return;
    setAbriendoModal(true);
    setAccionError(null);
    try {
      const [plantillas, tutores] = await Promise.all([
        listPlantillasConsentimientoAction(),
        listTutoresConsentimientoAction(pacienteId),
      ]);
      if (!plantillas.ok) {
        setAccionError(plantillas.error.message);
        return;
      }
      // Sin tutores no se bloquea nada — el selector simplemente no aparece.
      const tutoresData = tutores.ok ? tutores.data : [];
      setModalData({ plantillas: plantillas.data, tutores: tutoresData });
    } finally {
      setAbriendoModal(false);
    }
  };

  const verFirma = async (id: string) => {
    if (firmaPendingId) return;
    setFirmaPendingId(id);
    setAccionError(null);
    try {
      const result = await getFirmaConsentimientoUrlAction(id);
      if (!result.ok) {
        setAccionError(result.error.message);
        return;
      }
      // Signed URL de 5 min en pestaña nueva (noopener: la pestaña no puede
      // navegar a la ficha).
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setFirmaPendingId(null);
    }
  };

  const confirmarRevocacion = async (id: string) => {
    const motivoTrim = motivo.trim();
    if (motivoTrim.length < 5) {
      setAccionError("Contá el motivo de la revocación (al menos 5 caracteres).");
      return;
    }
    setRevocarPending(true);
    setAccionError(null);
    try {
      const result = await revokeConsentimientoAction({
        consentimientoId: id,
        pacienteId,
        motivo: motivoTrim,
      });
      if (!result.ok) {
        setAccionError(result.error.message);
        return;
      }
      setRevocandoId(null);
      setMotivo("");
      await cargar();
    } finally {
      setRevocarPending(false);
    }
  };

  const vigentes = items?.filter((c) => c.vigente).length ?? 0;

  return (
    <section className="pc-card pc-consent-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Consentimientos</span>
        {items && items.length > 0 ? (
          <button
            type="button"
            className="pc-link"
            onClick={() => {
              void abrirModal();
            }}
            disabled={abriendoModal}
            title="Registrar un nuevo consentimiento informado con firma"
          >
            {abriendoModal ? "Abriendo…" : "Registrar"}
          </button>
        ) : null}
      </header>

      {items === null ? (
        <p className="pc-card-text muted">Cargando consentimientos…</p>
      ) : loadError ? (
        <p className="pc-card-text pc-consent-error" role="alert">
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <div className="pc-consent-empty">
          <p className="pc-card-text muted">
            Sin consentimientos registrados. La Ley 26.529 exige consentimiento
            informado para el tratamiento — registralo con la firma del paciente
            (o su tutor legal).
          </p>
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => {
              void abrirModal();
            }}
            disabled={abriendoModal}
            aria-busy={abriendoModal}
          >
            {abriendoModal ? "Abriendo…" : "Registrar consentimiento"}
          </button>
        </div>
      ) : (
        <>
          <ul className="pc-consent-list">
            {items.map((c) => (
              <li key={c.id} className="pc-consent-row">
                <div className="pc-consent-row-main">
                  <div className="pc-consent-row-title">
                    <b>{c.titulo}</b>
                    {c.version != null ? (
                      <span className="fm-mono muted"> · v{c.version}</span>
                    ) : null}
                  </div>
                  <div className="pc-consent-row-meta">
                    <span
                      className={
                        "pc-consent-pill " +
                        (c.vigente ? "pc-consent-pill--vigente" : "pc-consent-pill--revocado")
                      }
                    >
                      {c.vigente ? "Vigente" : "Revocado"}
                    </span>
                    <span className="muted">
                      Firmado el {fmtFechaFirma(c.firmadoEn)} por{" "}
                      {c.firmadoPorTutor ? "el tutor legal" : "el paciente"}
                    </span>
                  </div>
                  {!c.vigente ? (
                    <p className="pc-consent-row-motivo muted">
                      Revocado el {c.revocadoEn ? fmtFechaFirma(c.revocadoEn) : "—"}
                      {c.revocadoMotivo ? ` — «${c.revocadoMotivo}»` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="pc-consent-row-actions">
                  <button
                    type="button"
                    className="pc-link"
                    onClick={() => {
                      void verFirma(c.id);
                    }}
                    disabled={firmaPendingId !== null}
                    title="Abrir la imagen de la firma en una pestaña nueva (link válido 5 minutos)"
                  >
                    {firmaPendingId === c.id ? "Abriendo…" : "Ver firma"}
                  </button>
                  {c.vigente ? (
                    <button
                      type="button"
                      className="pc-link pc-consent-revocar"
                      onClick={() => {
                        setAccionError(null);
                        setMotivo("");
                        setRevocandoId(revocandoId === c.id ? null : c.id);
                      }}
                      disabled={revocarPending}
                    >
                      Revocar
                    </button>
                  ) : null}
                </div>

                {revocandoId === c.id ? (
                  <div className="pc-consent-revoke-box">
                    <label className="pc-consent-label" htmlFor={`pc-consent-motivo-${c.id}`}>
                      Motivo de la revocación (queda en el registro; la firma se
                      conserva por compliance)
                    </label>
                    <textarea
                      id={`pc-consent-motivo-${c.id}`}
                      className="pc-consent-motivo"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder="Ej.: el paciente retiró la autorización por escrito el…"
                    />
                    <div className="pc-consent-revoke-actions">
                      <button
                        type="button"
                        className="fi-btn fi-btn-ghost"
                        onClick={() => {
                          setRevocandoId(null);
                          setMotivo("");
                        }}
                        disabled={revocarPending}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="fi-btn fi-btn-secondary"
                        onClick={() => {
                          void confirmarRevocacion(c.id);
                        }}
                        disabled={revocarPending || motivo.trim().length < 5}
                        aria-busy={revocarPending}
                      >
                        {revocarPending ? "Revocando…" : "Confirmar revocación"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="pc-consent-foot muted">
            {vigentes === 1 ? "1 consentimiento vigente" : `${vigentes} consentimientos vigentes`}
            {" · "}los links de firma expiran a los 5 minutos.
          </p>
        </>
      )}

      {accionError ? (
        <p className="pc-consent-error" role="alert">
          {accionError}
        </p>
      ) : null}

      {modalData ? (
        <FirmaCanvasModal
          pacienteId={pacienteId}
          pacienteNombre={pacienteNombre}
          plantillas={modalData.plantillas}
          tutores={modalData.tutores}
          onClose={() => setModalData(null)}
          onCreated={() => {
            setModalData(null);
            void cargar();
          }}
        />
      ) : null}
    </section>
  );
}
