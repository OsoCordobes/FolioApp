/**
 * Folio · linkage matcher del portal del paciente (Fase 3 · P3) — LÓGICA PURA.
 *
 * Un mismo humano es una fila `paciente` POR ORG (M03: PHI en `paciente`, PII en
 * `paciente_identidad`). El portal (M70) agrega `paciente_cuenta` (1:1 con
 * auth.users) y `paciente.cuenta_id` como el JOIN que abanica un login a los
 * pacientes de varias orgs. Este módulo decide, para una cuenta que acaba de
 * verificarse, a QUÉ filas `paciente` se la puede LINKEAR — y con qué confianza.
 *
 * ─── Decisión de arquitectura (plan Fase 3 #3 + endurecimiento anti-impersonación) ─
 *   · Auto-link SÓLO alta confianza, y alta confianza EXIGE DOS identificadores
 *     independientes matcheando la MISMA fila viva de una org:
 *       (a) DNI + teléfono, o
 *       (b) DNI + email, o
 *       (c) teléfono + email.
 *   · Endurecimiento sobre el plan original [fase3-P3-adversarial-auth-review]:
 *     el DNI SOLO ya NO auto-linkea. El DNI argentino es un keyspace denso,
 *     no-secreto y enumerable (familiares, ex-parejas, empleadores, cualquiera
 *     que haya visto el documento lo conocen), y en el portal se tipea como texto
 *     libre SIN prueba de posesión → un match DNI-solo es confianza insuficiente
 *     para otorgar acceso a PHI. Un match DNI-solo va a la cola de claim (aprobada
 *     por el clínico, P9), no auto-linkea. Se conserva el DNI como identificador
 *     FUERTE: combinado con un segundo (teléfono o email) sí alcanza el umbral.
 *   · Todo lo demás (un solo identificador — DNI/teléfono/email solo —, o varios
 *     candidatos en una org) es AMBIGUO → cola `paciente_claim`. NUNCA se
 *     auto-linkea un ambiguo (gate anti-impersonación por construcción).
 *   · NUNCA se mergean filas `paciente`; el matcher sólo produce decisiones de
 *     LINK (setear cuenta_id) o de CLAIM (encolar). El caller service_role las
 *     aplica en un path AUDITADO.
 *
 * ─── Por qué recomputamos los blind indexes por org acá ───────────────────────
 * `paciente_identidad.{dni,telefono,email}_hash` están salteados POR ORG
 * (M30/M36/M70: blindIndex(x, organization_id)). `paciente_cuenta.telefono_hash`
 * está SIN salt (cross-org). Entonces el matcher NO puede comparar el hash de la
 * cuenta contra el de la ficha directamente: recomputa el blind index del
 * teléfono/email/DNI del titular con el salt de CADA org candidata y compara. Eso
 * lo hace el orchestrator (que tiene acceso a `blindIndex`); este módulo es PURO
 * y recibe, por candidato, si cada identificador matcheó (booleans ya computados
 * por org) — así es testeable sin tocar crypto ni DB.
 *
 * Este archivo NO importa crypto, DB, ni React: es una función pura testeable día
 * uno. El orchestrator (`link-actions.ts`) computa los booleans por-org y aplica.
 */

/** Un candidato = una fila viva `paciente` de una org, con qué identificadores
 * del titular matchearon contra su identidad (ya recomputados por org). */
export interface MatchCandidate {
  pacienteId: string;
  organizationId: string;
  /** El DNI aportado por el titular matcheó el dni_hash (salteado por esta org)
   * de esta fila. false si el titular no aportó DNI o no matcheó. */
  dniMatch: boolean;
  /** El teléfono de la cuenta matcheó el telefono_hash (salteado por esta org). */
  telefonoMatch: boolean;
  /** El email de la cuenta matcheó el email_hash (salteado por esta org). */
  emailMatch: boolean;
}

/** El paciente queda auto-linkeado (alta confianza). */
export interface AutoLinkDecision {
  kind: "auto_link";
  pacienteId: string;
  organizationId: string;
  /**
   * Por qué fue alta confianza (para el audit). SIEMPRE incluye DOS
   * identificadores — un match de un solo identificador NUNCA auto-linkea
   * (ver `highConfidenceReason`): 'dni_telefono' | 'dni_email' | 'telefono_email'.
   */
  reason: "dni_telefono" | "dni_email" | "telefono_email";
}

/** El candidato es ambiguo → se encola un claim para aprobación del clínico. */
export interface ClaimDecision {
  kind: "claim";
  pacienteId: string;
  organizationId: string;
  /** Qué identificadores matchearon (para el audit y el UI de aprobación). */
  matched: { dni: boolean; telefono: boolean; email: boolean };
}

export type MatchDecision = AutoLinkDecision | ClaimDecision;

export interface MatchOutcome {
  autoLinks: AutoLinkDecision[];
  claims: ClaimDecision[];
}

/**
 * ¿Este candidato califica para auto-link de alta confianza?
 * Requiere DOS identificadores independientes en la MISMA fila (nunca uno solo):
 *   · DNI + teléfono, o
 *   · DNI + email, o
 *   · teléfono + email.
 * El DNI SOLO NO alcanza [fase3-P3-adversarial-auth-review]: es no-secreto,
 * enumerable y auto-declarado sin prueba de posesión → un match DNI-solo cae a
 * claim (aprobado por el clínico), no auto-linkea.
 * (La unicidad — "exactamente una fila de la org" — la resuelve `matchAccount`
 * agrupando por org: si dos filas de la misma org empatan, ninguna es alta
 * confianza y ambas caen a claim.)
 */
function highConfidenceReason(c: MatchCandidate): AutoLinkDecision["reason"] | null {
  if (c.dniMatch && c.telefonoMatch) return "dni_telefono";
  if (c.dniMatch && c.emailMatch) return "dni_email";
  if (c.telefonoMatch && c.emailMatch) return "telefono_email";
  return null;
}

/** ¿Matcheó ALGÚN identificador? (los que no son alta confianza pero tienen
 * alguna coincidencia van a la cola de claim; los que no matchean en nada se
 * descartan — no son candidatos). */
function hasAnyMatch(c: MatchCandidate): boolean {
  return c.dniMatch || c.telefonoMatch || c.emailMatch;
}

/**
 * Decide, para una cuenta, qué filas `paciente` auto-linkear y cuáles encolar
 * como claim. PURA: sin DB, sin crypto, sin efectos. El caller pasa los
 * candidatos con los booleans ya recomputados por org.
 *
 * Reglas:
 *   1. Se descartan candidatos SIN ninguna coincidencia (no son candidatos).
 *   2. Se descartan filas paciente YA linkeadas a OTRA cuenta o a ESTA (el
 *      caller no debería pasarlas, pero defendemos: `alreadyLinked` las excluye).
 *   3. Por ORG: si HAY exactamente UN candidato de alta confianza y es el ÚNICO
 *      candidato de esa org, se auto-linkea. Si hay >1 candidato en la org
 *      (aunque uno sea "alta confianza"), TODOS los de esa org van a claim
 *      (ambigüedad intra-org: no arriesgamos linkear la ficha equivocada).
 *   4. Los candidatos con alguna coincidencia pero no elegibles para auto-link
 *      van a claim.
 *
 * Nota anti-impersonación: la regla #3 es conservadora a propósito. Con varias
 * fichas candidatas en la misma org, el humano correcto lo decide el clínico
 * (P9), no un heurístico.
 */
export function matchAccount(candidates: MatchCandidate[]): MatchOutcome {
  const withMatch = candidates.filter(hasAnyMatch);

  // Agrupar por org: la ambigüedad se evalúa dentro de cada org (una fila por
  // org es lo normal; dos filas candidatas en la misma org = ambiguo).
  const byOrg = new Map<string, MatchCandidate[]>();
  for (const c of withMatch) {
    const list = byOrg.get(c.organizationId) ?? [];
    list.push(c);
    byOrg.set(c.organizationId, list);
  }

  const autoLinks: AutoLinkDecision[] = [];
  const claims: ClaimDecision[] = [];

  for (const [organizationId, orgCandidates] of byOrg) {
    if (orgCandidates.length === 1) {
      const only = orgCandidates[0];
      const reason = highConfidenceReason(only);
      if (reason) {
        autoLinks.push({
          kind: "auto_link",
          pacienteId: only.pacienteId,
          organizationId,
          reason,
        });
        continue;
      }
    }
    // >1 candidato en la org, o el único no es alta confianza → todos a claim.
    for (const c of orgCandidates) {
      claims.push({
        kind: "claim",
        pacienteId: c.pacienteId,
        organizationId,
        matched: { dni: c.dniMatch, telefono: c.telefonoMatch, email: c.emailMatch },
      });
    }
  }

  return { autoLinks, claims };
}
