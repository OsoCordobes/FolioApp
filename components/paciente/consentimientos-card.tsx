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
import { RepresentacionesCard } from "@/components/paciente/representaciones-card";
import { EvaluacionesConsentimiento } from "@/components/paciente/evaluaciones-consentimiento";
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
  const [revision,setRevision]=useState(0);

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
      if (!tutores.ok) { setAccionError(tutores.error.message); return; }
      setModalData({ plantillas: plantillas.data, tutores: tutores.data });
    } finally {
      setAbriendoModal(false);
    }
  };

  const verFirma = async (id: string, participante=0) => {
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
      window.open(result.data.signedUrl+(participante?"?participante=1":""), "_blank", "noopener,noreferrer");
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
    <>
    <RepresentacionesCard pacienteId={pacienteId}/>
    <section className="pc-card pc-consent-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Consentimientos</span>
        {items && items.length > 0 ? (
          <div className="pc-consent-head-actions">
            {/* X7 · Imprimir la ficha (con el listado de consentimientos). Los
                estilos @media print ocultan el chrome y refluyen a A4; el botón
                mismo lleva `.no-print` para no salir en el papel. La imagen de
                cada firma se ve/imprime aparte vía "Ver firma" (signed URL). */}
            <button
              type="button"
              className="pc-link no-print"
              onClick={() => window.print()}
              title="Imprimir o guardar como PDF esta ficha con el listado de consentimientos"
            >
              Imprimir
            </button>
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
          </div>
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
                      {c.vigente ? c.evidenciaRegistrada ? "Registrado" : "Registro previo · revisar evidencia" : "Revocado"}
                    </span>
                    <span className="muted">
                      Firmado el {fmtFechaFirma(c.firmadoEn)} por{" "}
                      {c.evidenciaRegistrada ? c.participantes.join(" y ").toLowerCase() : "firmante consignado en el registro previo (evidencia por revisar)"}
                    </span>
                  </div>
                  {!c.vigente ? (
                    <p className="pc-consent-row-motivo muted">
                      Revocado el {c.revocadoEn ? fmtFechaFirma(c.revocadoEn) : "—"}
                      {c.revocadoMotivo ? ` — «${c.revocadoMotivo}»` : ""}
                    </p>
                  ) : null}
                  {c.textoSnapshot&&<details><summary>Texto y versión registrados</summary><p style={{whiteSpace:"pre-wrap"}}>{c.textoSnapshot}</p></details>}
                </div>
                <div className="pc-consent-row-actions">
                  <button
                    type="button"
                    className="pc-link"
                    onClick={() => {
                      void verFirma(c.id);
                    }}
                    disabled={firmaPendingId !== null}
                    title="Abrir evidencia comprobando nuevamente la sesión y los permisos"
                  >
                    {firmaPendingId === c.id ? "Abriendo…" : "Ver firma"}
                  </button>
                  {c.participantes.length>1&&<button type="button" className="pc-link" disabled={firmaPendingId!==null} onClick={()=>void verFirma(c.id,1)}>Ver firma del representante</button>}
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
            {vigentes === 1 ? "1 registro sin revocar" : `${vigentes} registros sin revocar`}
            {" · "}cada lectura de evidencia vuelve a comprobar la sesión y los permisos.
          </p>
        </>
      )}

      {accionError ? (
        <p className="pc-consent-error" role="alert">
          {accionError}
        </p>
      ) : null}
      <EvaluacionesConsentimiento pacienteId={pacienteId} revision={revision}/>

      {modalData ? (
        <FirmaCanvasModal
          pacienteId={pacienteId}
          pacienteNombre={pacienteNombre}
          plantillas={modalData.plantillas}
          tutores={modalData.tutores}
          onClose={() => setModalData(null)}
          onCreated={() => {
            setRevision(r=>r+1);
            setModalData(null);
            void cargar();
          }}
        />
      ) : null}
    </section>
    </>
  );
}
