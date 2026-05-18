/**
 * Folio · data layer · analytics insights.
 *
 * Lee `analytics.org_insights_cache` de la org activa con RLS aplicada (cada
 * member solo ve insights de las orgs a las que pertenece). El pipeline que
 * llena esta tabla corre fuera de proceso (cron M16); este módulo solo lee.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

export type InsightSeverity = "positive" | "neutral" | "attention";

export interface Insight {
  metrica: string;
  severity: InsightSeverity;
  copy: string;
  ambito: string;                                // ej. "Córdoba" | "AMBA" | "Centro" | "AR"
  nivel: "ciudad" | "gran_area" | "provincia" | "region" | "nacional";
  condicion: string;                             // ej. "p25_low" | "p90_high"
  n_orgs_cohort: number;
}

export interface InsightsBundle {
  periodo: string;                               // YYYY-MM-DD
  computedAt: string;
  insights: Insight[];
}

export async function getInsightsForActiveOrg(): Promise<Result<InsightsBundle | null>> {
  const sessionResult = await getActiveSession();
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.data;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .schema("analytics")
    .from("org_insights_cache")
    .select("periodo, computed_at, insights")
    .eq("org_id", session.organizationId)
    .maybeSingle();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return ok(null);

  return ok({
    periodo: data.periodo,
    computedAt: data.computed_at,
    insights: (data.insights as Insight[]) ?? [],
  });
}
