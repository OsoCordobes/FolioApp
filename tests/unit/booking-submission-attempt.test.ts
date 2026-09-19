import test from 'node:test';
import assert from 'node:assert/strict';
import {BookingSubmissionAttempt} from '../../lib/booking/submission-attempt';
test('one frame double click admits one attempt; uncertain retry preserves immutable request',()=>{
 const attempt=new BookingSubmissionAttempt<{name:string}>();let count=0;const id=()=>String(++count);const payload={name:'Synthetic'};
 const first=attempt.begin(payload,id)!;payload.name='changed';assert.equal(attempt.begin(payload,id),null);
 attempt.finish('uncertain');const retry=attempt.begin(payload,id)!;assert.equal(retry.id,first.id);assert.equal(retry.payload.name,'Synthetic');assert.equal(count,1);
 attempt.finish('success');assert.equal(attempt.begin(payload,id)!.id,'2');
});
test('a rejected request can be edited into a new intent, unchanged retry keeps key',()=>{
 const attempt=new BookingSubmissionAttempt<{name:string}>();let count=0;const id=()=>String(++count);
 assert.equal(attempt.begin({name:'A'},id)!.id,'1');attempt.finish('rejected');assert.equal(attempt.begin({name:'A'},id)!.id,'1');attempt.finish('rejected');assert.equal(attempt.begin({name:'B'},id)!.id,'2');
});
