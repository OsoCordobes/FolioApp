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
  ]);
  for (const alert of alerts) {
    const message = alert.replace(/\s*Reintentar guardar\s*$/, '').trim();
    const kind = known.get(message);
    if (kind) return kind;
  }
  return 'other';
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
