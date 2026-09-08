import type { ClinicalExport } from "./clinical-export";
export const CLINICAL_EXPORT_FORMAT_VERSION = "folio.patient-export.v2";
export function clinicalManifest(history: ClinicalExport, startedAt: string, endedAt: string) {
  const entry = (id: string, count: number, scope = "datos_incluidos") => ({ id, cantidad: count, estado: count === 0 ? "sin_registros_autorizados" : scope });
  return {
    archivo_restaurable: false,
    alcance: "paciente_y_organizacion_autorizados_por_RLS",
    lectura_iniciada_en: startedAt, lectura_finalizada_en: endedAt,
    consistencia: "lecturas_paginadas_verificadas_sin_snapshot_transaccional_global",
    categorias: [
      entry("sesiones_originales", history.sesiones.length),
      entry("enmiendas", history.sesiones.reduce((n, s) => n + s.enmiendas.length, 0)),
      entry("notas_clinicas", history.notas.length), entry("intake", history.intake.length),
      entry("instrumentos_respuestas_y_resultados_originales", history.instrumentos.length),
      entry("documentos", history.documentos.length, "inventario_sin_bytes"),
      entry("consentimientos_evidencia", history.consentimientos_evidencia.length, "datos_y_referencias_sin_firmas_binarias"),
      entry("evaluaciones_consentimiento", history.evaluaciones_consentimiento.length),
    ],
    faltantes_en_origen: {
      instrumentos_sin_respuestas: history.instrumentos.filter(r => r.respuestas_estado === "ausentes_en_origen").map(r => r.id),
      consentimientos_evidencia_legada: history.consentimientos_evidencia.filter(r => r.evidencia_estado !== "REGISTRADA").map(r => r.id),
    },
    pendientes: ["bytes_documentos_y_firmas", "evidencia_verificacion_representantes_fuera_del_snapshot_del_acto", "verificacion_hashes_de_bytes", "snapshot_consistente_de_todas_las_categorias", "contrato_de_importacion_y_ensayo_de_restauracion"],
    enlaces: "endpoints_autenticados_revalidan_permisos_y_MFA_al_descargar_no_garantizan_disponibilidad_futura",
  } as const;
}
