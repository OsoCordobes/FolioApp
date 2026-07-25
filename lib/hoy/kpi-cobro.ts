/**
 * Folio · /hoy · KPIs de dinero (lógica pura, testeable con node:test).
 *
 * POR QUÉ existe este módulo: hasta acá el KPI "Recaudado" de /hoy sumaba el
 * `precio` de los turnos CERRADOS. Desde el mini-diálogo de cobro (PR #118) eso
 * dejó de ser verdad: al cerrar, el profesional puede editar el monto o marcar
 * "quedó debiendo" (el pago se crea PENDIENTE). O sea que /hoy declaraba como
 * cobrado dinero que /finanzas —que lee `pago`— no reconoce: dos pantallas del
 * mismo producto con números distintos para el mismo día, y la que mentía era
 * la que el médico mira todos los días.
 *
 * Criterio canónico, espejo de lib/db/finanzas.ts:
 *   - COBRADO  = suma de `pago.monto_cents` con `pago.estado = PAGADO`.
 *   - DEUDA    = suma de `pago.monto_cents` con estado ≠ PAGADO (PENDIENTE /
 *                PARCIAL) — plata registrada pero NO cobrada.
 *   - ESPERADO = precio de lista de los turnos que todavía pueden ocurrir y
 *                que NO tienen pago registrado (evita contar dos veces un
 *                turno pre-pagado o ya con deuda cargada).
 *
 * `Turno.cobro` lo puebla lib/db/hoy.ts desde la vista `turno_extendido`
 * (M14/M56/M72: `pago_id`, `pago_monto_cents`, `pago_estado`, `pago_pagado_ts`).
 */

import type { Cobro, EstadoTurno, Turno } from "@/lib/types";

/** Estados en los que el turno ya no va a generar ingreso futuro. */
const ESTADOS_SIN_INGRESO_FUTURO: readonly EstadoTurno[] = [
  "cerrado",
  "cancelado",
  "no_asistio",
  "reagendado",
];

/** Sólo lo que el cálculo necesita — así los tests no arman un Turno completo. */
export type TurnoCobroLike = Pick<Turno, "estado" | "precio"> & { cobro?: Cobro | null };

export interface CobroKpi {
  /** Pesos efectivamente cobrados (pagos PAGADO). Es lo que /finanzas suma. */
  cobradoPesos: number;
  /** Pesos registrados como deuda (pagos PENDIENTE/PARCIAL: "quedó debiendo"). */
  deudaPesos: number;
  /** Turnos con deuda registrada — para el copy del sub. */
  deudaCount: number;
  /** Precio de lista de los turnos del día que todavía pueden cobrarse. */
  esperadoPesos: number;
  /** Todo lo que falta entrar hoy: deuda ya registrada + turnos por atender. */
  porCobrarPesos: number;
}

/**
 * Monto REGISTRADO en `pago` para un turno, en centavos, o `null` si no hay
 * pago registrado.
 *
 * El fallback a `precio` cubre sólo los turnos marcados como cobrados sin monto
 * (datos mock/legacy del prototipo, y el instante del update optimista): un
 * pago real de la DB SIEMPRE trae `monto_cents`. Un cobro "pendiente" sin monto
 * es la ausencia de fila en `pago` (así lo mapea lib/db/hoy.ts), no una deuda.
 */
export function montoRegistradoCents(t: TurnoCobroLike): number | null {
  const c = t.cobro;
  if (!c) return null;
  if (c.estado === "pagado") return c.montoCents ?? Math.round(t.precio * 100);
  return c.montoCents ?? null;
}

/** Deriva los KPIs de dinero del día a partir de los turnos ya cargados. */
export function computeCobroKpi(turnos: readonly TurnoCobroLike[]): CobroKpi {
  let cobradoCents = 0;
  let deudaCents = 0;
  let deudaCount = 0;
  let esperadoCents = 0;

  for (const t of turnos) {
    const registrado = montoRegistradoCents(t);
    if (registrado != null && t.cobro?.estado === "pagado") {
      cobradoCents += registrado;
      continue;
    }
    if (registrado != null) {
      deudaCents += registrado;
      deudaCount += 1;
      continue;
    }
    // Sin pago registrado: sólo suma a "por cobrar" si el turno todavía puede
    // ocurrir. Un turno cerrado sin cargo (monto 0 ⇒ el server no crea `pago`)
    // no suma en ningún lado, que es exactamente lo que pasó.
    if (!ESTADOS_SIN_INGRESO_FUTURO.includes(t.estado)) {
      esperadoCents += Math.round(t.precio * 100);
    }
  }

  const cobradoPesos = Math.round(cobradoCents / 100);
  const deudaPesos = Math.round(deudaCents / 100);
  const esperadoPesos = Math.round(esperadoCents / 100);

  return {
    cobradoPesos,
    deudaPesos,
    deudaCount,
    esperadoPesos,
    porCobrarPesos: deudaPesos + esperadoPesos,
  };
}

/**
 * Cobro que hay que asumir en el update optimista al cerrar un turno, espejo
 * EXACTO de lo que hace el server en `transitionTurno` (lib/db/turnos.ts):
 *   - con `cobro` explícito (mini-diálogo): respeta monto y "quedó debiendo";
 *   - sin `cobro` (rol sin canRegistrarCobro, camino legacy): efectivo PAGADO
 *     por el precio del turno;
 *   - monto 0 ⇒ el server NO inserta `pago` ⇒ no hay cobro que mostrar;
 *   - el upsert usa `ignoreDuplicates` ⇒ si el turno YA tenía pago, gana el
 *     existente.
 *
 * Sin esto el KPI se quedaba en el valor viejo hasta el próximo refresh (o
 * peor: mostraba el precio de lista de un turno cerrado con deuda).
 */
export function cobroOptimistaAlCerrar(
  turno: TurnoCobroLike,
  cobro: { montoCents: number; pagado: boolean } | undefined,
  nowIso: string,
): Cobro {
  const yaRegistrado = montoRegistradoCents(turno);
  if (yaRegistrado != null) return turno.cobro as Cobro;

  const montoCents = cobro ? cobro.montoCents : Math.round(turno.precio * 100);
  const pagado = cobro ? cobro.pagado : true;
  if (montoCents <= 0) return { estado: "pendiente", ts: null, montoCents: null };

  return {
    estado: pagado ? "pagado" : "pendiente",
    ts: pagado ? nowIso : null,
    montoCents,
  };
}
