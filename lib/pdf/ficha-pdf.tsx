/**
 * Folio · documento PDF de ficha/sesión (react-pdf, server-side).
 *
 * Componente PURO de presentación: recibe datos YA DESENCRIPTADOS (strings en
 * claro) vía `FichaPdfData` y arma el documento. NO desencripta, NO toca la DB,
 * NO importa `lib/crypto` — la desencriptación vive en la route (Node runtime),
 * que llama `buildFichaPdf(data)` con el shape ya en claro. Así el módulo es
 * testeable sin secrets y la frontera de PHI queda en la route.
 *
 * El PDF renderiza:
 *   - Membrete: organización + (opt-in) matrícula del profesional.
 *   - Datos del paciente (nombre, edad, motivo).
 *   - SOAP de la sesión (subjetivo / objetivo / análisis / plan).
 *   - Resumen de la herramienta de la especialidad (texto humano, no PHI cruda).
 *   - Resultados de planillas/instrumentos (score + banda, sin respuestas crudas).
 *   - Watermark diagonal "CONFIDENCIAL" (fixed → se repite en cada página).
 *   - Pie con la fecha de generación y el número de página.
 *
 * `buildFichaPdf` devuelve un `Promise<Buffer>` (renderToBuffer) para que la
 * route lo mande como `application/pdf`. Nada de este archivo escribe a disco
 * ni loguea contenido clínico.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import {
  buildMembreteMeta,
  formatGeneradoTs,
  orDash,
  tieneSoap,
  type EvolucionPdfEntrada,
} from "./ficha-format";
import {
  PDF_COLORS,
  PDF_PAGE,
  PDF_RADIUS,
  PDF_SPACE,
  PDF_TYPE,
} from "./theme";

// ─── Shape de entrada (todo YA en claro) ─────────────────────────────────────

/** Un resultado de instrumento/planilla ya scoreado (sin respuestas crudas). */
export interface FichaPdfInstrumento {
  /** Nombre del instrumento ("PHQ-9", "DASS-21"). */
  nombre: string;
  /** Puntaje total, como texto ("14", "—"). */
  total: string;
  /** Etiqueta de la banda de severidad ("moderado"), o null. */
  banda: string | null;
  /** Fecha de la medición (YYYY-MM-DD), o null. */
  fecha: string | null;
}

/**
 * Datos del PDF, YA DESENCRIPTADOS por la route. Ningún campo es ciphertext:
 * son los strings que se pintan tal cual. Los strings vacíos se renderizan como
 * "—" para no dejar bloques en blanco.
 */
export interface FichaPdfData {
  /** Nombre del consultorio/clínica (membrete). */
  organizacion: string;
  /** Nombre completo del profesional que exporta, o null. */
  profesional: string | null;
  /**
   * Matrícula del profesional a mostrar en el membrete, o null. La route SÓLO
   * la pasa cuando `member.mostrar_matricula` es true (opt-in M62); si es false
   * llega null y no se imprime.
   */
  matricula: string | null;
  /** Nombre completo del paciente. */
  paciente: string;
  /** Edad en años (texto), o "—". */
  edad: string;
  /** Género display ("F"/"M"/"—"). */
  genero: string;
  /** Motivo de consulta (en claro), o "". */
  motivo: string;
  /** Fecha de la sesión exportada (YYYY-MM-DD) o null si es la ficha general. */
  fechaSesion: string | null;
  /** SOAP de la sesión (en claro). Cada campo puede ser "". */
  soap: { s: string; o: string; a: string; p: string };
  /** Resumen humano de la herramienta de la especialidad (no PHI cruda), o null. */
  resumenHerramienta: string | null;
  /** Nombre de la especialidad ("Cardiología"), o null. */
  especialidad: string | null;
  /** Resultados de instrumentos/planillas (score + banda). */
  instrumentos: FichaPdfInstrumento[];
  /**
   * D2 · Evolución: últimas N sesiones (DESC) con fecha · servicio · resumen y
   * SOAP compacto (ya en claro, armado por evolucionDesdeSesiones en la route).
   * [] = se omite la sección (paciente sin visitas cerradas).
   */
  evolucion: EvolucionPdfEntrada[];
  /** Timestamp de generación (ISO) — se muestra en el pie. */
  generadoTs: string;
}

// ─── Estilos (tokens brass/cream via theme.ts) ───────────────────────────────

const styles = StyleSheet.create({
  page: {
    backgroundColor: PDF_COLORS.surface,
    color: PDF_COLORS.ink,
    fontFamily: PDF_TYPE.family,
    fontSize: PDF_TYPE.body,
    paddingTop: PDF_PAGE.paddingTop,
    paddingBottom: PDF_PAGE.paddingBottom,
    paddingHorizontal: PDF_PAGE.paddingHorizontal,
    lineHeight: 1.4,
  },
  // Membrete
  header: {
    borderBottomWidth: 2,
    borderBottomColor: PDF_COLORS.accent,
    paddingBottom: PDF_SPACE.s3,
    marginBottom: PDF_SPACE.s4,
  },
  orgName: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.h2,
    color: PDF_COLORS.accent,
  },
  headerMeta: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink3,
    marginTop: PDF_SPACE.s1,
  },
  // Título (paciente)
  pacienteName: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.h1,
    color: PDF_COLORS.ink,
    marginBottom: PDF_SPACE.s1,
  },
  pacienteMeta: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink3,
    marginBottom: PDF_SPACE.s4,
  },
  // Secciones
  section: {
    marginBottom: PDF_SPACE.s4,
  },
  sectionTitle: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.h2,
    color: PDF_COLORS.accent2,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.line,
    paddingBottom: PDF_SPACE.s1,
    marginBottom: PDF_SPACE.s2,
  },
  label: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.label,
    color: PDF_COLORS.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: PDF_SPACE.s1,
  },
  fieldBlock: {
    marginBottom: PDF_SPACE.s3,
  },
  body: {
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.ink2,
  },
  // Card de instrumento
  instrumentoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: PDF_COLORS.paper,
    borderWidth: 1,
    borderColor: PDF_COLORS.lineSoft,
    borderRadius: PDF_RADIUS.sm,
    paddingVertical: PDF_SPACE.s2,
    paddingHorizontal: PDF_SPACE.s3,
    marginBottom: PDF_SPACE.s2,
  },
  instrumentoNombre: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.ink,
  },
  instrumentoBanda: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink3,
  },
  instrumentoScore: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.h2,
    color: PDF_COLORS.accent,
  },
  // Evolución (D2 · historial de sesiones)
  evolucionRow: {
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.line,
    paddingLeft: PDF_SPACE.s3,
    marginBottom: PDF_SPACE.s3,
  },
  evolucionHead: {
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.ink,
    marginBottom: PDF_SPACE.s1,
  },
  evolucionResumen: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink2,
    marginBottom: PDF_SPACE.s1,
  },
  evolucionSoapLinea: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink3,
    marginBottom: 1,
  },
  evolucionSoapLetra: {
    fontFamily: PDF_TYPE.familyBold,
    color: PDF_COLORS.ink2,
  },
  // Watermark
  watermark: {
    position: "absolute",
    top: "42%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: PDF_TYPE.familyBold,
    fontSize: PDF_TYPE.watermark,
    color: PDF_COLORS.ink4,
    opacity: 0.08,
    transform: "rotate(-30deg)",
  },
  // Pie
  footer: {
    position: "absolute",
    bottom: 20,
    left: PDF_PAGE.paddingHorizontal,
    right: PDF_PAGE.paddingHorizontal,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.line,
    paddingTop: PDF_SPACE.s2,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.ink3,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

// ─── Bloques del documento ───────────────────────────────────────────────────

function FieldBlock({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{orDash(value)}</Text>
    </View>
  );
}

/**
 * Documento react-pdf de la ficha/sesión. Presentación pura sobre `FichaPdfData`
 * (todo en claro). Se exporta para poder testear el árbol de elementos sin
 * renderizar el binario.
 */
export function FichaPdfDocument({ data }: { data: FichaPdfData }): ReactElement {
  const {
    organizacion,
    profesional,
    matricula,
    paciente,
    edad,
    genero,
    motivo,
    fechaSesion,
    soap,
    resumenHerramienta,
    especialidad,
    instrumentos,
    evolucion,
    generadoTs,
  } = data;

  // Membrete: profesional · matrícula (sólo si la route la pasó, opt-in M62) ·
  // especialidad. buildMembreteMeta filtra vacíos.
  const membreteMeta = buildMembreteMeta({ profesional, matricula, especialidad });

  const hayEvolucion = tieneSoap(soap);

  return (
    <Document
      title={`Ficha clínica — ${paciente}`}
      author={organizacion}
      creator="Folio"
      producer="Folio"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Watermark: fixed → se repite en cada página del wrap. */}
        <Text style={styles.watermark} fixed>
          CONFIDENCIAL
        </Text>

        {/* Membrete */}
        <View style={styles.header}>
          <Text style={styles.orgName}>{orDash(organizacion)}</Text>
          {membreteMeta.length > 0 ? (
            <Text style={styles.headerMeta}>{membreteMeta.join("  ·  ")}</Text>
          ) : null}
        </View>

        {/* Paciente */}
        <Text style={styles.pacienteName}>{orDash(paciente)}</Text>
        <Text style={styles.pacienteMeta}>
          {`${orDash(edad)} años  ·  ${orDash(genero)}`}
          {fechaSesion ? `  ·  Sesión del ${fechaSesion}` : ""}
        </Text>

        {/* Motivo de consulta */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Motivo de consulta</Text>
          <Text style={styles.body}>{orDash(motivo)}</Text>
        </View>

        {/* SOAP */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Evolución (SOAP)</Text>
          {hayEvolucion ? (
            <>
              <FieldBlock label="Subjetivo" value={soap.s} />
              <FieldBlock label="Objetivo" value={soap.o} />
              <FieldBlock label="Análisis" value={soap.a} />
              <FieldBlock label="Plan" value={soap.p} />
            </>
          ) : (
            <Text style={styles.body}>Sin registro de evolución para esta sesión.</Text>
          )}
        </View>

        {/* Resumen de la herramienta de especialidad */}
        {resumenHerramienta ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {especialidad ? `Resumen — ${especialidad}` : "Resumen clínico"}
            </Text>
            <Text style={styles.body}>{resumenHerramienta}</Text>
          </View>
        ) : null}

        {/* Evolución (D2): últimas N sesiones. wrap multipágina por defecto —
            watermark y pie son fixed y se repiten en cada página. Las filas NO
            llevan wrap={false}: un SOAP largo (hasta 4×5000 chars) puede superar
            una página y wrap={false} lo clipearía; el borde izquierdo continúa
            en el salto y mantiene la lectura. minPresenceAhead evita headers
            huérfanos al pie de página. */}
        {evolucion.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={40}>
              {`Evolución — últimas ${evolucion.length} sesiones`}
            </Text>
            {evolucion.map((ev, i) => (
              <View key={`${ev.fecha}-${i}`} style={styles.evolucionRow}>
                <Text style={styles.evolucionHead}>
                  {`${orDash(ev.fecha)}  ·  ${orDash(ev.servicio)}`}
                </Text>
                <Text style={styles.evolucionResumen}>{orDash(ev.resumen)}</Text>
                {ev.soap ? (
                  <>
                    {(
                      [
                        ["S", ev.soap.s],
                        ["O", ev.soap.o],
                        ["A", ev.soap.a],
                        ["P", ev.soap.p],
                      ] as const
                    )
                      .filter(([, txt]) => txt.trim().length > 0)
                      .map(([letra, txt]) => (
                        <Text key={letra} style={styles.evolucionSoapLinea}>
                          <Text style={styles.evolucionSoapLetra}>{`${letra} — `}</Text>
                          {txt}
                        </Text>
                      ))}
                  </>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* Instrumentos / planillas */}
        {instrumentos.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Escalas y planillas</Text>
            {instrumentos.map((inst, i) => (
              <View key={`${inst.nombre}-${i}`} style={styles.instrumentoRow} wrap={false}>
                <View>
                  <Text style={styles.instrumentoNombre}>{inst.nombre}</Text>
                  <Text style={styles.instrumentoBanda}>
                    {orDash(inst.banda)}
                    {inst.fecha ? `  ·  ${inst.fecha}` : ""}
                  </Text>
                </View>
                <Text style={styles.instrumentoScore}>{orDash(inst.total)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Pie */}
        <View style={styles.footer} fixed>
          <Text>{`Generado por Folio · ${formatGeneradoTs(generadoTs)}`}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/**
 * Renderiza el documento a un `Buffer` de PDF listo para responder como
 * `application/pdf`. Server-only (react-pdf usa APIs de Node). La route llama a
 * esta función con el shape ya desencriptado.
 *
 * Se construye el elemento con `createElement` (en vez de JSX) porque el tipo de
 * `renderToBuffer` espera un `ReactElement<DocumentProps>`; envolverlo así evita
 * fricción de tipos entre la versión de React del repo y la de react-pdf.
 */
export async function buildFichaPdf(data: FichaPdfData): Promise<Buffer> {
  const element = createElement(FichaPdfDocument, { data });
  // renderToBuffer espera un ReactElement<DocumentProps> (el <Document/> raíz que
  // FichaPdfDocument devuelve). `Parameters<typeof renderToBuffer>[0]` recupera
  // ese tipo exacto sin nombrar el namespace interno de react-pdf, evitando el
  // cast a `unknown` y manteniendo el contrato tipado.
  return renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);
}
