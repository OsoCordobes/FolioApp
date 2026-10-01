const alertKind='(?:none|validation|forbidden|auth_required|db_error|conflict|uncertain|read_error|storage|owner_missing|prior_uncertain|post_save_conflict|network|save_failed|not_found|locked|transition_invalid|other)';
const actionOutcome='(?:none|pending|http_2xx|http_4xx|http_5xx|http_other|network_failed|mixed)';
const boundedCount='(?:unknown|[0-9]{1,6})';
const boundedRevision='(?:unknown|[0-9]{1,16})';
const presence='(?:unknown|[01])';
const route='(?:onboarding|app_other|other_origin|unknown)';
const timerCounts=`(?:unknown|[0-9]{1,6},[0-9]{1,6},[0-9]{1,6})`;
const postSummary=[
 `onb_action:[0-9]{1,2},onb_action_result:${actionOutcome}`,
 `onb_post:[0-9]{1,2},onb_post_result:${actionOutcome}`,
 `app_action:[0-9]{1,2},app_action_result:${actionOutcome}`,
 `app_post:[0-9]{1,2},app_post_result:${actionOutcome}`,
 `external_action:[0-9]{1,2},external_action_result:${actionOutcome}`,
 `external_post:[0-9]{1,2},external_post_result:${actionOutcome}`,
].join(',');

export const serviceProofDiagnosticPattern=new RegExp(
 `^services_proof_diagnostic:phase=initial_save db_ok=[01] active_count=${boundedCount} revision=${boundedRevision} step_max=${boundedCount} name_match=[01] field_enabled=[01] alert=[01] alert_global=${alertKind} alert_services=${alertKind} alert_save_status=${alertKind} alert_other=${alertKind} verify=[01] route=${route} command_before=${presence} command_after=${presence} posts_before=${postSummary} posts_after=${postSummary} timers800_before_scheduled_fired_cancelled=${timerCounts} timers800_after_fill_delta_scheduled_fired_cancelled=${timerCounts}$`,
);

export function extractServiceProofDiagnostics(output){
 return String(output).split(/\r?\n/).map(line=>line.trim())
  .filter(line=>serviceProofDiagnosticPattern.test(line));
}
