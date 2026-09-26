import assert from 'node:assert/strict';
import test from 'node:test';
import {actionHttpKind, actionOutcomeKind, serviceAlertKind} from '../e2e/auth-proof-diagnostics';

test('service alert categories are closed and never echo arbitrary text', () => {
  assert.equal(serviceAlertKind([]), 'none');
  assert.equal(serviceAlertKind(['Alguno de los datos no cumple una regla de validación. Revisá los campos e intentá nuevamente. Reintentar guardar']), 'validation');
  assert.equal(serviceAlertKind(['No tenés permiso para esa acción.']), 'forbidden');
  assert.equal(serviceAlertKind(['Error en la base de datos.']), 'db_error');
  assert.equal(serviceAlertKind(['patient@example.test secret=123']), 'other');
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
