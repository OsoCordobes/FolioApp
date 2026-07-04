/**
 * Folio · decisión PURA de emails de ciclo de vida de suscripción (PR 1.2).
 *
 * `decideLifecycleEmails` recibe datos planos por org (gate ya computado,
 * estado de suscripción, episodio de morosidad) y devuelve la lista de emails
 * de lifecycle que corresponde disparar. Sin DB, sin Resend, sin fechas
 * implícitas → testeable en aislamiento (tests/unit/billing-lifecycle.test.ts),
 * mismo patrón que computeAccessGate / decideSubscriptionAmountSync.
 *
 * Reglas:
 *
 *   (a) TRIAL POR VENCER — org sin suscripción activa cuyo gate todavía
 *       permite por grace period y quedan exactamente 3 o 1 días
 *       (gate.graceDaysLeft, computeAccessGate). Un email por umbral por org:
 *       dedupe `trial-por-vencer:{orgId}:{n}d` (DEBE coincidir con la key que
 *       construye notifyTrialPorVencer en lib/email/notify.ts).
 *
 *   (b) SUSCRIPCIÓN SUSPENDIDA — gate bloqueado por morosidad agotada
 *       (reason === "subscription_morosa_expired"). Dedupe por EPISODIO:
 *       `suscripcion-suspendida:{orgId}:{episodioIso}` con episodioIso =
 *       suscripcion.morosa_desde (M65). Fallback para episodios pre-M65 (fila
 *       MOROSA sin morosa_desde): la fecha de corte del gate que pasa el
 *       caller (proxima_cobro vencida, o fin del grace). Sin discriminador
 *       estable NO se decide email — preferimos uno faltante a spamear en cada
 *       corrida del cron (mismo trade-off at-most-once de M65).
 *
 *       Deliberadamente NO se manda "suspendida" para los otros reasons de
 *       bloqueo: `grace_expired` (nunca se suscribió — el template habla de
 *       "reintentos de cobro" que no existieron, y el aviso de fin de prueba
 *       ya salió por (a)), `subscription_cancelled` y `subscription_paused`
 *       (acciones deliberadas del OWNER, no una suspensión). Consistente con
 *       la doc del template (lib/email/templates/suscripcion-suspendida.ts:
 *       "computeAccessGate → subscription_morosa_expired").
 *
 *   (c) SIN escalation MOROSA→CANCELADA acá (decisión de diseño, backlog):
 *       MP cancela el preapproval solo tras agotar reintentos y eso llega por
 *       webhook subscription_preapproval — no corresponde que el cron invente
 *       la cancelación.
 *
 *   Cuentas internas (is_internal_account) NUNCA reciben emails. El caller
 *   además las excluye en la query (defensa en profundidad: notify* /
 *   sendBillingLifecycleEmail también re-chequea contra la DB).
 */

import type { AccessGate, EstadoSuscripcion } from "@/lib/db/suscripcion";

/** Umbrales del grace period (7 días) en los que avisamos por email. */
export const TRIAL_AVISO_UMBRALES_DIAS = [3, 1] as const;

export type TrialUmbralDias = (typeof TRIAL_AVISO_UMBRALES_DIAS)[number];

export interface LifecycleOrgSnapshot {
  organizationId: string;
  /** organization.is_internal_account — true corta TODO (regla dura). */
  isInternalAccount: boolean;
  /** Resultado de computeAccessGate para la org, ya evaluado por el caller. */
  gate: Pick<AccessGate, "allowed" | "reason" | "graceDaysLeft">;
  /** Estado de la suscripción, o null si la org nunca creó una. */
  estadoSuscripcion: EstadoSuscripcion | null;
  /** suscripcion.morosa_desde (ISO) — episodio de morosidad vigente, o null. */
  morosaDesdeIso: string | null;
  /**
   * Fecha de corte del gate (ISO) como discriminador de FALLBACK para
   * episodios pre-M65 sin morosa_desde: proxima_cobro vencida o fin del grace
   * (org.created_at + GRACE_PERIOD_DAYS). null si el caller no la puede
   * determinar (→ sin morosa_desde no se decide el email de suspensión).
   */
  corteFallbackIso: string | null;
}

export type LifecycleEmailDecision =
  | {
      tipo: "trial_por_vencer";
      /** DEBE coincidir con la key interna de notifyTrialPorVencer. */
      dedupeKey: string;
      diasRestantes: TrialUmbralDias;
    }
  | {
      tipo: "suscripcion_suspendida";
      /** DEBE coincidir con la key interna de notifySuscripcionSuspendida. */
      dedupeKey: string;
      /** Discriminador del episodio (morosa_desde, o corte del gate legacy). */
      episodioIso: string;
    };

/**
 * Decide qué emails de lifecycle corresponden para una org. Pura y total:
 * cualquier combinación de inputs devuelve una lista (posiblemente vacía),
 * jamás lanza. Las ramas (a) y (b) son mutuamente excluyentes por
 * construcción (gate.allowed vs !gate.allowed).
 */
export function decideLifecycleEmails(input: LifecycleOrgSnapshot): LifecycleEmailDecision[] {
  // Regla dura: internas jamás. (El caller ya filtró en SQL; esto es defensa
  // en profundidad, igual que el re-check contra DB dentro de notify*.)
  if (input.isInternalAccount) return [];

  // Con suscripción ACTIVA no hay nada que avisar. computeAccessGate ya
  // devuelve allowed sin graceDaysLeft para ACTIVA — guard defensivo por si
  // el caller armó un snapshot inconsistente.
  if (input.estadoSuscripcion === "ACTIVA") return [];

  // (a) Trial por vencer: umbrales exactos 3 y 1 del grace period.
  if (input.gate.allowed) {
    const dias = input.gate.graceDaysLeft;
    if (dias === 3 || dias === 1) {
      return [
        {
          tipo: "trial_por_vencer",
          dedupeKey: `trial-por-vencer:${input.organizationId}:${dias}d`,
          diasRestantes: dias,
        },
      ];
    }
    return [];
  }

  // (b) Suspendida: SOLO morosidad agotada (ver doc del módulo para por qué
  // grace_expired / cancelled / paused NO mandan este email).
  if (input.gate.reason === "subscription_morosa_expired") {
    const episodioIso = input.morosaDesdeIso ?? input.corteFallbackIso;
    if (!episodioIso) return []; // sin discriminador estable → no spamear
    return [
      {
        tipo: "suscripcion_suspendida",
        dedupeKey: `suscripcion-suspendida:${input.organizationId}:${episodioIso}`,
        episodioIso,
      },
    ];
  }

  return [];
}
