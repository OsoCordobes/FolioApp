import { LOG_OPERATIONS } from './catalog';
import { operationalFacts } from './privacy';
/** No raw message/error/URL reaches console or a platform log drain. */
export function safeLog(level: 'warn' | 'error' | 'log' | 'info' | 'debug', operation: string, ...values: unknown[]): void {
  const code = LOG_OPERATIONS.has(operation) ? operation : 'operation_unknown';
  const method = ['warn', 'error', 'log', 'info', 'debug'].includes(level) ? level : 'warn';
  console[method]('[folio]', { operation: code, ...operationalFacts(values) });
}
