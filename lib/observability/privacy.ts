import { ERROR_CODES } from "./error-codes";
import { CODE_FILES, TELEMETRY_TAG_VALUES } from './catalog';
import type { Event, ErrorEvent, EventHint } from '@sentry/nextjs';
const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError']);
const COUNT_KEYS = new Set(['count', 'total', 'processed', 'accepted', 'retryable', 'terminal', 'failed', 'errors', 'errores', 'importados', 'duplicados', 'steps_completed', 'duration_ms', 'attempts', 'dead', 'updated', 'unchanged', 'skipped', 'scanned', 'mismatches', 'notified', 'trialNotified', 'suspendedNotified']);
const STATUS_CODES = new Set([200, 201, 202, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 416, 422, 425, 429, 500, 502, 503, 504]);
export function operationalFacts(input: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const inspect = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 2) return;
    try {
      const v = value as Record<string, unknown>;
      if (typeof v.code === 'string' && ERROR_CODES.has(v.code)) out.code = v.code;
      if (typeof v.name === 'string' && ERROR_TYPES.has(v.name)) out.error_type = v.name;
      if (typeof v.status === 'number' && STATUS_CODES.has(v.status)) out.http_status = v.status;
      for (const key of COUNT_KEYS) {
        const n = v[key];
        if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000) out[key] = n;
      }
      if (v.error) inspect(v.error, depth + 1);
    } catch {
      // Never invoke an error's free-text conversion, including hostile getters.
    }
  };
  if (Array.isArray(input)) {
    for (const v of input.slice(0, 10))
      inspect(v, 0);
  }
  else
    inspect(input, 0);
  return out;
}
function codeFilename(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return;
  const clean = value.replace(/\\/g, '/').split(/[?#]/, 1)[0];
  // Only a path present in our static source catalog may survive. No host/home path.
  for (const file of CODE_FILES)
    if (clean === file || clean.endsWith('/' + file))
      return file;
  const chunk = clean.match(/\/_next\/static\/chunks\/([a-f0-9]{8,64}\.js)$/i);
  return chunk ? `_next/static/chunks/${chunk[1]}` : undefined;
}
export function sanitizeSentryEvent(event: Event, hint?: EventHint): ErrorEvent {
  if (hint) {
    hint.attachments = [];
  }
  const out: ErrorEvent = { type: undefined, message: 'operation_failed', level: ['fatal', 'error', 'warning', 'info', 'debug'].includes(event.level ?? '') ? event.level : 'error', platform: 'javascript' };
  if (typeof event.event_id === 'string' && /^[a-f0-9]{32}$/i.test(event.event_id))
    out.event_id = event.event_id;
  if (typeof event.environment === 'string' && ['production', 'preview', 'development', 'test'].includes(event.environment))
    out.environment = event.environment;
  if (typeof event.release === 'string' && /^[a-f0-9]{7,40}$/i.test(event.release))
    out.release = event.release;
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp))
    out.timestamp = event.timestamp;
  const tags: Record<string, string> = {};
  for (const key of ['component', 'op', 'fn', 'stage', 'cron', 'action', 'scope']) {
    const value = event.tags?.[key];
    if (typeof value === 'string' && TELEMETRY_TAG_VALUES.has(value))
      tags[key] = value;
  }
  const facts = operationalFacts([event.extra, event.tags, hint?.originalException]);
  out.tags = { ...tags, ...Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, String(value)])) };
  if (event.exception?.values) {
    out.exception = {
      values: event.exception.values.slice(0, 3).map(value => ({
        type: ERROR_TYPES.has(value.type ?? '') ? value.type : 'Error',
        value: 'operation_failed',
        stacktrace: {
          frames: (value.stacktrace?.frames ?? []).slice(-25).flatMap(frame => {
            const filename = codeFilename(frame.filename);
            if (!filename) return [];
            return [{
              filename, in_app: true,
              ...(Number.isSafeInteger(frame.lineno) && frame.lineno! > 0 ? { lineno: frame.lineno } : {}),
              ...(Number.isSafeInteger(frame.colno) && frame.colno! >= 0 ? { colno: frame.colno } : {}),
            }];
          }),
        },
      })),
    };
  }
  const method = event.request?.method;
  if (method && ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method))
    out.request = { method };
  return out;
}
/** Disable channels containing DOM, URLs, query strings, SQL or request payloads. */
export const PRIVATE_SENTRY_OPTIONS = { sendDefaultPii: false, autoSessionTracking: false, sendClientReports: false, tracesSampleRate: 0, enableLogs: false, tracePropagationTargets: [] as string[], beforeBreadcrumb: () => null, beforeSendTransaction: () => null, beforeSend: sanitizeSentryEvent };
const EVENT_PROPERTIES: Record<string, Record<string, readonly string[] | 'count'>> = {
  'signup.completed': { source: ['email', 'google'] }, 'onboarding.completed': { steps_completed: 'count' }, 'pacientes.imported': { total: 'count', importados: 'count', duplicados: 'count', errores: 'count' },
  'landing.viewed': {}, 'landing.cta_clicked': { section: ['header', 'hero', 'pricing_solo', 'pricing_clinic', 'sticky', 'final'], target: ['/onboarding', '/login', '/precios'] },
  'landing.section_viewed': { section: ['hero', 'day', 'vault', 'bento', 'pricing', 'faq', 'final', 'features'] }, 'landing.faq_opened': { index: 'count' },
};
export function sanitizeAnalyticsEvent(input: {
  event?: unknown;
  properties?: unknown;
}): {
  event: string;
  properties: Record<string, string | number | boolean>;
  distinctId: string;
} | null {
  if (typeof input.event !== 'string' || !Object.hasOwn(EVENT_PROPERTIES, input.event))
    return null;
  const props = input.properties && typeof input.properties === 'object' ? input.properties as Record<string, unknown> : {};
  const properties: Record<string, string | number | boolean> = { $process_person_profile: false, $geoip_disable: true };
  for (const [key, rule] of Object.entries(EVENT_PROPERTIES[input.event])) {
    const value = props[key];
    if (rule === 'count') {
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000)
        properties[key] = value;
    }
    else if (typeof value === 'string' && rule.includes(value))
      properties[key] = value;
  }
  return { event: input.event, distinctId: 'folio-anonymous-aggregate', properties };
}
/** PostHog receives only registered public events, never SDK URL/session defaults. */
export function sanitizeBrowserAnalyticsEvent<T extends {
  event?: unknown;
  properties?: unknown;
}>(event: T | null): T | null {
  if (!event)
    return null;
  const safe = sanitizeAnalyticsEvent(event);
  if (!safe || !safe.event.startsWith('landing.'))
    return null;
  return { event: safe.event, properties: { ...safe.properties, distinct_id: safe.distinctId } } as unknown as T;
}
