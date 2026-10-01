import assert from 'node:assert/strict';
import test from 'node:test';
import {extractServiceProofDiagnostics} from '../../scripts/testing/auth-proof/service-diagnostic.mjs';
import {actionHttpKind, actionOutcomeKind, pageRouteKind, postKind, serviceAlertBySource, serviceAlertKind, timerDelta} from '../e2e/auth-proof-diagnostics';

const validServiceDiagnostic='services_proof_diagnostic:phase=initial_save db_ok=1 active_count=0 revision=0 step_max=5 name_match=1 field_enabled=1 alert=0 alert_global=none alert_services=none alert_save_status=none alert_other=none verify=0 route=onboarding command_before=0 command_after=1 posts_before=onb_action:0,onb_action_result:none,onb_post:1,onb_post_result:http_2xx,app_action:0,app_action_result:none,app_post:0,app_post_result:none,external_action:0,external_action_result:none,external_post:0,external_post_result:none posts_after=onb_action:1,onb_action_result:pending,onb_post:0,onb_post_result:none,app_action:0,app_action_result:none,app_post:0,app_post_result:none,external_action:0,external_action_result:none,external_post:0,external_post_result:none timers800_before_scheduled_fired_cancelled=2,1,0 timers800_after_fill_delta_scheduled_fired_cancelled=1,0,1';

test('runner extraction retains only the complete closed service diagnostic', () => {
  assert.deepEqual(extractServiceProofDiagnostics(`ignored\n${validServiceDiagnostic}\nignored`), [validServiceDiagnostic]);
  const resetTimerDiagnostic=validServiceDiagnostic.replace('timers800_after_fill_delta_scheduled_fired_cancelled=1,0,1', 'timers800_after_fill_delta_scheduled_fired_cancelled=unknown');
  assert.deepEqual(extractServiceProofDiagnostics(resetTimerDiagnostic), [resetTimerDiagnostic]);
  assert.deepEqual(extractServiceProofDiagnostics(validServiceDiagnostic.replace('alert_global=none', 'alert_global=arbitrary')), []);
  assert.deepEqual(extractServiceProofDiagnostics(`${validServiceDiagnostic} detail=patient@example.test`), []);
});

test('service alert categories are closed and never echo arbitrary text', () => {
  assert.equal(serviceAlertKind([]), 'none');
  assert.equal(serviceAlertKind(['Alguno de los datos no cumple una regla de validación. Revisá los campos e intentá nuevamente. Reintentar guardar']), 'validation');
  assert.equal(serviceAlertKind(['No tenés permiso para esa acción.']), 'forbidden');
  assert.equal(serviceAlertKind(['Error en la base de datos.']), 'db_error');
  assert.equal(serviceAlertKind(['patient@example.test secret=123']), 'other');
  assert.equal(serviceAlertKind(['No pudimos confirmar un guardado anterior. Verificá ese mismo cambio antes de editar.']), 'prior_uncertain');
  assert.equal(serviceAlertKind(['No se pudo guardar. Reintentar guardar']), 'save_failed');
  assert.deepEqual(serviceAlertBySource([
    {source: 'global', message: 'No pudimos guardar el avance. Reintentá.'},
    {source: 'services', message: 'No pudimos leer los servicios guardados. Volvé a cargar para continuar.'},
    {source: 'save_status', message: 'No se pudo guardar. Reintentar guardar'},
    {source: 'other', message: 'patient@example.test secret=123'},
  ]), {global: 'save_failed', services: 'read_error', save_status: 'save_failed', other: 'other'});
});

test('action HTTP categories reveal no status detail or response content', () => {
  assert.equal(actionHttpKind(200), 'http_2xx');
  assert.equal(actionHttpKind(403), 'http_4xx');
  assert.equal(actionHttpKind(503), 'http_5xx');
  assert.equal(actionHttpKind(302), 'http_other');
  assert.equal(actionOutcomeKind([]), 'none');
  assert.equal(actionOutcomeKind(['http_2xx', 'http_2xx']), 'http_2xx');
  assert.equal(actionOutcomeKind(['http_2xx', 'network_failed']), 'mixed');
});

test('request and route classes keep URLs and query values out of diagnostics', () => {
  const app='http://localhost:4430';
  assert.equal(postKind(`${app}/onboarding?code=private`, app, true), 'onboarding_action');
  assert.equal(postKind(`${app}/onboarding?code=private`, app, false), 'onboarding_post');
  assert.equal(postKind(`${app}/other?code=private`, app, true), 'app_action');
  assert.equal(postKind('http://127.0.0.1:55421/auth/v1/token?code=private', app, false), 'external_post');
  assert.equal(postKind('invalid', app, true), null);
  assert.equal(pageRouteKind(`${app}/onboarding?code=private`, app), 'onboarding');
  assert.equal(pageRouteKind(`${app}/login?code=private`, app), 'app_other');
  assert.equal(pageRouteKind('http://other.test/secret', app), 'other_origin');
  assert.equal(pageRouteKind('invalid', app), 'unknown');
});

test('timer deltas report only bounded counts and preserve unavailable state', () => {
  assert.deepEqual(timerDelta({scheduled:4,fired:2,cancelled:1},{scheduled:6,fired:2,cancelled:3}),{scheduled:2,fired:0,cancelled:2});
  assert.equal(timerDelta(null,{scheduled:1,fired:1,cancelled:0}),null);
  assert.equal(timerDelta({scheduled:4,fired:2,cancelled:1},{scheduled:1,fired:0,cancelled:0}),null);
  assert.equal(timerDelta({scheduled:1,fired:1,cancelled:0},{scheduled:Number.NaN,fired:1,cancelled:0}),null);
});
