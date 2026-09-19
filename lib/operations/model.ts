import { z } from "zod";
export const QUEUES = ["billing_followup", "email_delivery", "google_outbound", "booking_followup", "billing_provider", "billing_webhook"] as const;
export const METRICS = ["database_bytes", "storage_bytes", "active_members", "email_accepted_month"] as const;
export type QueueKey = typeof QUEUES[number];
export type MetricKey = typeof METRICS[number];
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const queueSchema = z.object({ key: z.enum(QUEUES), state: z.literal("known"), pending: count, leased: count, terminal: count, uncertain: count, due: count, oldestPendingAt: timestamp.nullable() });
const metricSchema = z.object({ key: z.enum(METRICS), state: z.literal("known"), value: count, limit: count.positive().nullable(), limitVerifiedAt: timestamp.nullable(), limitValidUntil: timestamp.nullable() });
export type Queue = z.infer<typeof queueSchema> | { key: QueueKey; state: "unknown" };
export type Metric = z.infer<typeof metricSchema> | { key: MetricKey; state: "unknown" };
const backupSchema = z.object({ state: z.literal("reported"), outcome: z.enum(["success", "partial", "failed"]), finishedAt: timestamp, reportedAt: timestamp, lastVerifiedAt: timestamp.nullable(), stale: z.boolean(), archiveBytes: count, objectCount: count, integrityVerified: z.boolean(), restoreScope: z.enum(["none", "structure", "full"]), restoreVerifiedAt: timestamp.nullable() });
export type Backup = z.infer<typeof backupSchema> | { state: "no_report" } | { state: "unknown" };
export interface OperationsSnapshot { generatedAt: string | null; warningPercent: number | null; pausePercent: number | null; backupMaxAgeHours: number | null; queues: Queue[]; metrics: Metric[]; backup: Backup }
/** Never spread backend objects into this display model: keys and values are allowlisted. */
export function normalizeOperationsSnapshot(raw: unknown): OperationsSnapshot {
  const root = raw && typeof raw === "object" ? raw as Record<string,unknown> : {};
  const thresholds = z.object({warningPercent:z.number().int().positive().max(99),pausePercent:z.number().int().positive().max(100),backupMaxAgeHours:z.number().int().positive().max(8760)}).refine(v=>v.warningPercent<v.pausePercent).safeParse(root);
  const list = (name: string) => Array.isArray(root[name]) ? root[name] as Array<Record<string,unknown>> : [];
  const queues: Queue[] = QUEUES.map(key => { const rows=list("queues").filter(row=>row && row.key===key); const parsed=queueSchema.safeParse(rows.length===1?rows[0]:null); return parsed.success?parsed.data:{key,state:"unknown"}; });
  const metrics: Metric[] = METRICS.map(key => { const rows=list("metrics").filter(row=>row && row.key===key); const parsed=metricSchema.safeParse(rows.length===1?rows[0]:null); return parsed.success?parsed.data:{key,state:"unknown"}; });
  const backup=backupSchema.safeParse(root.backup);
  return { generatedAt:timestamp.safeParse(root.generatedAt).success?root.generatedAt as string:null,warningPercent:thresholds.success?thresholds.data.warningPercent:null,pausePercent:thresholds.success?thresholds.data.pausePercent:null,backupMaxAgeHours:thresholds.success?thresholds.data.backupMaxAgeHours:null,queues,metrics,backup:backup.success?backup.data:{state:root.backup && typeof root.backup==='object' && (root.backup as Record<string,unknown>).state==='no_report'?'no_report':'unknown'} };
}
export function quotaState(metric: Metric, policy: Pick<OperationsSnapshot,"warningPercent"|"pausePercent">, now = Date.now()): "unknown"|"within"|"warning"|"pause" {
  if(metric.state!=="known" || metric.limit===null || metric.limitVerifiedAt===null || metric.limitValidUntil===null || Date.parse(metric.limitValidUntil)<=now || policy.warningPercent===null || policy.pausePercent===null)return "unknown";
  const percent=metric.value/metric.limit*100;
  return percent>=policy.pausePercent?"pause":percent>=policy.warningPercent?"warning":"within";
}
