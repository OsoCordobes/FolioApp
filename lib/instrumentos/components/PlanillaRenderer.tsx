"use client";

/**
 * Folio · biblioteca de instrumentos · PlanillaRenderer (C3).
 *
 * Renderiza CUALQUIER InstrumentoDef de la biblioteca (lib/instrumentos) con el
 * markup nativo de folio.css — el mismo que EscalaBlock de psicología: `.pc-card`
 * de contenedor, `<fieldset>`/`<legend>` por ítem, radios con
 * `accentColor: var(--accent)`, chip de resultado (ResultadoBadge) y avisos
 * `role="alert"` con tokens. GENÉRICO: deduce el modo de entrada del shape del
 * def (modoDeInstrumento), así que un instrumento nuevo se dibuja sin tocar este
 * componente.
 *
 * Modos soportados:
 *   - likert   → radios 0..N por ítem (PHQ-9, GAD-7, DASS-21, PCL-5, NDI, ODI).
 *   - binario  → radios No/Sí por ítem (C-SSRS).
 *   - numerico → un select con las opciones (Borg 6–20).
 * (Un instrumento "estructurado" como SMART no se dibuja acá — el consumidor usa
 *  su form propio; el renderer muestra un aviso sobrio.)
 *
 * Controlado: deriva TODO de `respuestas` y notifica cada edición con
 * `onChange(next)`. El shape de `respuestas` sigue el contrato de la def:
 *   - likert/binario → Array<number | null> (binario guarda 0/1);
 *   - numerico       → number | null.
 * El score se recomputa en vivo con `def.score()` (contrato laxo: null si
 * incompleto) y se muestra con ResultadoBadge cuando la planilla está completa.
 *
 * `colapsable` (D3): sin ninguna respuesta arranca COLAPSADO con un botón
 * "Cargar {def.nombre}" (espejo exacto de EscalaBlock de psicología, incluido el
 * "Quitar" que vacía y colapsa); con respuestas, abierto. Evita el muro de
 * fieldsets en las sesiones en que el instrumento no se administra.
 * PHI: nunca loguea respuestas.
 *
 * Estilos: el <select> del modo numérico se estila con `.fi-wi-field select`
 * de folio.css (la copia inline SELECT_STYLE se retiró en D3).
 */

import { useId, useState } from "react";

import * as I from "@/components/icons";
import type { InstrumentoDef } from "../types";
import { ResultadoBadge } from "./ResultadoBadge";
import {
  modoDeInstrumento,
  opcionesDeItem,
  type ModoInstrumento,
} from "./planilla-core";

// ─── Respuestas: contrato controlado ─────────────────────────────────────────

/** Respuestas de una planilla likert/binaria: valor por ítem (null = sin responder). */
export type RespuestasItems = Array<number | null>;
/** Respuesta de una planilla numérica: un único valor (null = sin responder). */
export type RespuestaNumerica = number | null;

export interface PlanillaRendererProps {
  /** Definición del instrumento a renderizar (del registry). */
  def: InstrumentoDef;
  /**
   * Respuestas actuales. Para likert/binario, `Array<number | null>` (se rellena
   * a la longitud de items). Para numerico, `number | null`. Un shape que no
   * corresponda al modo se trata como "sin responder".
   */
  respuestas: RespuestasItems | RespuestaNumerica | null | undefined;
  /**
   * Notifica el nuevo estado completo de respuestas tras cada edición.
   * likert/binario → Array<number | null>; numerico → number | null.
   */
  onChange(next: RespuestasItems | RespuestaNumerica): void;
  /** true = solo lectura (sin edición). */
  readOnly?: boolean;
  /** Muestra la consigna del instrumento arriba de los ítems. Default true. */
  mostrarConsigna?: boolean;
  /**
   * true → sin ninguna respuesta la planilla arranca colapsada con el botón
   * "Cargar {def.nombre}"; abierta muestra "Quitar" (vacía las respuestas y
   * vuelve a colapsar). Con alguna respuesta, siempre abierta. Default false
   * (comportamiento histórico: siempre expandida).
   */
  colapsable?: boolean;
}

// ─── Normalización del input al modo ─────────────────────────────────────────

/** Rellena/recorta las respuestas de ítems a la longitud del instrumento. */
function normalizarItems(respuestas: unknown, len: number): RespuestasItems {
  const base: RespuestasItems = Array.from({ length: len }, () => null);
  if (!Array.isArray(respuestas)) return base;
  for (let i = 0; i < len; i++) {
    const v = respuestas[i];
    base[i] = typeof v === "number" && Number.isFinite(v) ? v : v === true ? 1 : v === false ? 0 : null;
  }
  return base;
}

/** Extrae el valor numérico único (Borg): acepta `n` o `[n]`. */
function normalizarNumerico(respuestas: unknown): RespuestaNumerica {
  const raw = Array.isArray(respuestas) ? respuestas[0] : respuestas;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export function PlanillaRenderer({
  def,
  respuestas,
  onChange,
  readOnly,
  mostrarConsigna = true,
  colapsable = false,
}: PlanillaRendererProps) {
  const uid = useId();
  // Abierta si ya hay respuestas; el profesional puede abrirla vacía (espejo de
  // EscalaBlock de psicología). Solo aplica con `colapsable`.
  const [abiertaLocal, setAbiertaLocal] = useState(false);
  const modo = modoDeInstrumento(def);

  if (modo === "estructurado") {
    return (
      <div className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">{def.nombre}</span>
        </header>
        <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
          {def.descripcion} Esta planilla usa un formato propio y se completa
          desde su panel dedicado.
        </p>
      </div>
    );
  }

  const tieneRespuestas =
    modo === "numerico"
      ? normalizarNumerico(respuestas) !== null
      : normalizarItems(respuestas, def.items.length).some((r) => r !== null);
  const abierta = !colapsable || abiertaLocal || tieneRespuestas;

  // "Quitar": vacía las respuestas (los consumidores descartan un array todo-null
  // / un numérico null del borrador) y colapsa de nuevo.
  const quitar = () => {
    if (readOnly) return;
    setAbiertaLocal(false);
    onChange(
      modo === "numerico" ? null : Array.from({ length: def.items.length }, () => null),
    );
  };

  if (!abierta) {
    return (
      <div className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">{def.nombre}</span>
        </header>
        {readOnly ? (
          <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
            Sin cargar en esta sesión.
          </p>
        ) : (
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => setAbiertaLocal(true)}
            style={{ alignSelf: "flex-start" }}
          >
            <I.Plus size={12} /> Cargar {def.nombre}
          </button>
        )}
      </div>
    );
  }

  const puedeQuitar = colapsable && !readOnly;

  if (modo === "numerico") {
    return (
      <NumericoBlock
        def={def}
        valor={normalizarNumerico(respuestas)}
        onChange={onChange}
        readOnly={readOnly}
        mostrarConsigna={mostrarConsigna}
        onQuitar={puedeQuitar ? quitar : undefined}
      />
    );
  }

  // likert | binario
  const items = normalizarItems(respuestas, def.items.length);
  const score = def.score(items);
  const respondidas = items.filter((r) => r !== null).length;
  const completa = respondidas === items.length;

  const setItem = (idx: number, valor: number) => {
    if (readOnly) return;
    onChange(items.map((r, i) => (i === idx ? valor : r)));
  };

  return (
    <div className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">{def.nombre}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {score ? (
            <ResultadoBadge banda={score.banda} def={def} total={score.total} />
          ) : respondidas > 0 ? (
            <span className="fm-mono muted" style={{ fontSize: 10.5 }}>
              {respondidas}/{items.length}
            </span>
          ) : null}
          {puedeQuitar ? (
            <button
              type="button"
              className="pc-link"
              onClick={quitar}
              aria-label={`Quitar ${def.nombre} de esta sesión`}
            >
              Quitar
            </button>
          ) : null}
        </span>
      </header>

      {mostrarConsigna && def.consigna ? (
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          {def.consigna}
        </p>
      ) : null}

      <ItemsBlock
        def={def}
        modo={modo}
        items={items}
        uid={uid}
        readOnly={readOnly}
        onSet={setItem}
      />

      {respondidas > 0 && !completa ? (
        <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--red)" }}>
          {def.nombre} incompleto ({respondidas}/{items.length}) — respondé los{" "}
          {items.length - respondidas} ítems restantes; incompleta no se puede
          guardar con puntaje.
        </p>
      ) : null}
      {respondidas === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          El puntaje y la banda se calculan automáticamente al completar los{" "}
          {items.length} ítems.
        </p>
      ) : null}
      {score ? (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          {score.interpretacion}
        </p>
      ) : null}
    </div>
  );
}

// ─── Bloque de ítems (likert / binario) ──────────────────────────────────────

function ItemsBlock({
  def,
  modo,
  items,
  uid,
  readOnly,
  onSet,
}: {
  def: InstrumentoDef;
  modo: ModoInstrumento;
  items: RespuestasItems;
  uid: string;
  readOnly?: boolean;
  onSet(idx: number, valor: number): void;
}) {
  // Leyenda de valores (solo likert: "0 = …  ·  1 = …"). El binario ya rotula
  // No/Sí en cada radio, así que no necesita leyenda.
  const opcionesInstrumento = def.opciones ?? [];
  const leyenda =
    modo === "likert" && opcionesInstrumento.length > 0
      ? opcionesInstrumento.map((o) => `${o.valor} = ${o.label}`).join("  ·  ")
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {leyenda ? (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          {leyenda}
        </p>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {def.items.map((item, i) => {
          const opciones = opcionesDeItem(def, i);
          return (
            <fieldset
              key={i}
              style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}
            >
              <legend style={{ padding: 0, fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>
                {i + 1}. {item.enunciado}
              </legend>
              <div style={{ display: "flex", gap: modo === "binario" ? 16 : 12, flexWrap: "wrap" }}>
                {opciones.map((opcion) => (
                  <label
                    key={opcion.valor}
                    title={opcion.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      color: "var(--ink-2)",
                      cursor: readOnly ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name={`${uid}-item-${i}`}
                      checked={items[i] === opcion.valor}
                      onChange={() => onSet(i, opcion.valor)}
                      disabled={readOnly}
                      aria-label={`${opcion.label} (${opcion.valor})`}
                      style={{ accentColor: "var(--accent)", margin: 0 }}
                    />
                    {/* likert: rótulo numérico compacto; binario: label textual. */}
                    <span aria-hidden="true">
                      {modo === "binario" ? opcion.label : opcion.valor}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bloque numérico (Borg y afines: un solo ítem, select de opciones) ───────

function NumericoBlock({
  def,
  valor,
  onChange,
  readOnly,
  mostrarConsigna,
  onQuitar,
}: {
  def: InstrumentoDef;
  valor: RespuestaNumerica;
  onChange(next: RespuestaNumerica): void;
  readOnly?: boolean;
  mostrarConsigna: boolean;
  /** Presente → botón "Quitar" en el header (modo colapsable). */
  onQuitar?: () => void;
}) {
  const opciones = def.opciones ?? [];
  const score = def.score(valor);
  const item = def.items[0];

  return (
    <div className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">{def.nombre}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {score ? (
            <ResultadoBadge banda={score.banda} def={def} total={score.total} />
          ) : null}
          {onQuitar ? (
            <button
              type="button"
              className="pc-link"
              onClick={onQuitar}
              aria-label={`Quitar ${def.nombre} de esta sesión`}
            >
              Quitar
            </button>
          ) : null}
        </span>
      </header>

      {mostrarConsigna && def.consigna ? (
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          {def.consigna}
        </p>
      ) : null}

      <label className="fi-wi-field">
        <span>{item?.enunciado ?? def.nombre}</span>
        <select
          value={valor ?? ""}
          onChange={(e) => {
            if (readOnly) return;
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          disabled={readOnly}
          aria-label={item?.enunciado ?? def.nombre}
        >
          <option value="">—</option>
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {score ? (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          {score.interpretacion}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          Elegí un valor para calcular el resultado.
        </p>
      )}
    </div>
  );
}
