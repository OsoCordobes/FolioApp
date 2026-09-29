/** Closed diagnostic categories: never print an alert, request, or response body. */
export function serviceAlertKind(alerts: readonly string[]): string {
  if (alerts.length === 0) return 'none';
  const known = new Map<string, string>([
    ['Revisá los servicios antes de guardar.', 'validation'],
    ['Alguno de los datos no cumple una regla de validación. Revisá los campos e intentá nuevamente.', 'validation'],
    ['No tenés permiso para esa acción.', 'forbidden'],
    ['Cambió la cuenta o el consultorio activo. Volvé a cargar la página.', 'forbidden'],
    ['Volvé a iniciar sesión.', 'auth_required'],
    ['Error en la base de datos.', 'db_error'],
    ['Los servicios cambiaron. Cargá los guardados antes de continuar.', 'conflict'],
    ['No pudimos confirmar el guardado. Verificá el mismo cambio antes de editar.', 'uncertain'],
    ['No pudimos leer los servicios guardados. Volvé a cargar para continuar.', 'read_error'],
    ['No pudimos preparar el guardado. Habilitá almacenamiento del navegador y reintentá.', 'storage'],
    ['No pudimos confirmar la cuenta activa. Volvé a cargar para continuar.', 'owner_missing'],
    ['No pudimos confirmar un guardado anterior. Verificá ese mismo cambio antes de editar.', 'prior_uncertain'],
    ['Los servicios cambiaron después de tu guardado. Cargá los guardados antes de continuar.', 'post_save_conflict'],
    ['Cargá los servicios guardados.', 'conflict'],
    ['No pudimos guardar. Revisá tu conexión — tus datos siguen acá.', 'network'],
    ['No pudimos guardar el avance. Reintentá.', 'save_failed'],
    ['No pudimos confirmar el guardado. Reintentá el mismo cambio.', 'uncertain'],
    ['No se pudo guardar.', 'save_failed'],
    ['Verificar guardado', 'uncertain'],
    ['Los servicios cambiaron. Cargá la versión guardada antes de continuar.', 'conflict'],
    ['Ya existe un registro con esos datos.', 'conflict'],
    ['No se puede borrar: hay datos relacionados.', 'conflict'],
    ['No se encontró el recurso.', 'not_found'],
    ['La sesión está bloqueada. Usá una enmienda para corregir.', 'locked'],
    ['Esa transición no está permitida.', 'transition_invalid'],
  ]);
  for (const alert of alerts) {
    const message = alert.replace(/\s*Reintentar guardar\s*$/, '').trim();
    const kind = known.get(message);
    if (kind) return kind;
  }
  return 'other';
}

export type AlertSource = 'global' | 'services' | 'save_status' | 'other';
export function serviceAlertBySource(alerts: readonly {source: AlertSource; message: string}[]) {
  const kinds = (source: AlertSource) => serviceAlertKind(alerts.filter(alert => alert.source === source).map(alert => alert.message));
  return {global: kinds('global'), services: kinds('services'), save_status: kinds('save_status'), other: kinds('other')};
}

export type PostKind = 'onboarding_action' | 'onboarding_post' | 'app_action' | 'app_post' | 'external_action' | 'external_post';
export function postKind(url: string, appOrigin: string, hasActionHeader: boolean): PostKind | null {
  try {
    const target = new URL(url);
    if (target.origin !== appOrigin) return hasActionHeader ? 'external_action' : 'external_post';
    if (target.pathname === '/onboarding') return hasActionHeader ? 'onboarding_action' : 'onboarding_post';
    return hasActionHeader ? 'app_action' : 'app_post';
  } catch { return null; }
}

export function pageRouteKind(url: string, appOrigin: string): 'onboarding' | 'app_other' | 'other_origin' | 'unknown' {
  try {
    const target = new URL(url);
    return target.origin !== appOrigin ? 'other_origin' : target.pathname === '/onboarding' ? 'onboarding' : 'app_other';
  } catch { return 'unknown'; }
}

export type TimerCounts = {scheduled: number; fired: number; cancelled: number};
export function timerDelta(before: TimerCounts | null, after: TimerCounts | null): TimerCounts | null {
  if (!before || !after) return null;
  return {scheduled: after.scheduled - before.scheduled, fired: after.fired - before.fired, cancelled: after.cancelled - before.cancelled};
}

export type ActionOutcome = 'pending' | 'http_2xx' | 'http_4xx' | 'http_5xx' | 'http_other' | 'network_failed';

export function actionHttpKind(status: number): ActionOutcome {
  if (status >= 200 && status < 300) return 'http_2xx';
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500 && status < 600) return 'http_5xx';
  return 'http_other';
}

export function actionOutcomeKind(outcomes: readonly ActionOutcome[]): ActionOutcome | 'none' | 'mixed' {
  if (outcomes.length === 0) return 'none';
  const distinct = new Set(outcomes);
  return distinct.size === 1 ? outcomes[0] : 'mixed';
}
