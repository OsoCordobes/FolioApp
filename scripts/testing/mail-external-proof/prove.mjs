import assert from 'node:assert/strict';
/** send is the unmodified real sendEmail, invoked without dependencies. */
export async function proveTransport({send,inputs,boundary,receipt,persist}){
 const a=await send(inputs.A);assert.equal(a.status,'sent','a_not_accepted');assert.equal(a.providerId,receipt.messageIds.A,'a_receipt_mismatch');
 const lost=await send(inputs.B);assert.equal(lost.status,'uncertain','b_not_uncertain');assert.equal(lost.detail,'provider_response_unknown','b_loss_unexpected');
 assert.equal(boundary.controlledLossDurable,true,'controlled_loss_missing');assert.equal(boundary.phase,'replayB','replay_not_allowed');
 const repeated=await send(inputs.B);assert.equal(repeated.status,'sent','b_replay_not_accepted');assert.equal(repeated.providerId,receipt.messageIds.B,'b_receipt_mismatch');
 assert.equal(boundary.phase,'complete','trial_incomplete');assert.equal(receipt.posts,3,'post_count');assert.equal(receipt.replaySameId,true,'provider_dedupe_missing');await persist();
}
