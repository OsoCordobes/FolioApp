import assert from 'node:assert/strict';
import test from 'node:test';
import { setupHoursWeek, uniformSetupHours } from '../../lib/onboarding/availability';
const context={organizationId:'org',memberId:'member',revision:1,protectedDates:false};
test('setup roundtrips a uniform week without assigning hours to inactive days',()=>{const dias=setupHoursWeek(['lun','mar'],[['09:00','12:00']]);assert.deepEqual(uniformSetupHours({context,dias}),{diasActivos:['lun','mar'],franjas:[['09:00','12:00']]});assert.deepEqual(dias.dom,{on:false,franjas:[]})});
test('setup refuses to flatten different daily intervals or dated schedules',()=>{const dias=setupHoursWeek(['lun','mar'],[['09:00','12:00']]);dias.mar.franjas=[['15:00','18:00']];assert.equal(uniformSetupHours({context,dias}),null);assert.equal(uniformSetupHours({context:{...context,protectedDates:true},dias:setupHoursWeek(['lun'],[['09:00','12:00']])}),null)});
