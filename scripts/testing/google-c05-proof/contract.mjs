import assert from 'node:assert/strict';
export const GOOGLE_PROJECT='folio_google_internal_proof';
export const GOOGLE_CASES=['outbound_lifecycle','uncertain_insert','external_availability','owned_event_isolation'];
export function assertGoogleFixtureIsolation(state){
 assert.equal(state.project,GOOGLE_PROJECT);assert.equal(state.githubActions,'true');
 assert.equal(state.runnerEnvironment,'github-hosted');assert.equal(state.platform,'linux');
 assert.equal(state.fresh,true);assert.equal(state.internalNetwork,true);
}
export function assertGoogleSyncObserved(result,beforeList,afterList){
 assert.equal(result.ok,true);assert.equal(result.skipped,undefined);
 assert.ok(Number.isInteger(beforeList)&&beforeList>=0);
 assert.ok(Number.isInteger(afterList)&&afterList>beforeList);
 for(const count of [result.upserted,result.deleted])assert.ok(Number.isInteger(count)&&count>=0);
}
/** @returns {{version:number,sha:string,environment:string,provider:string,cases:Record<string,{passed:boolean}>,failure:string|null,cleanup:boolean,passed:boolean}} */
export function googleReceipt(sha){
 assert.match(sha,/^[a-f0-9]{40}$/);
 return {version:1,sha,environment:'github-ephemeral-supabase',provider:'http-loopback',
  cases:{},failure:null,cleanup:false,passed:false};
}
export function finishGoogleReceipt(receipt){
 receipt.passed=receipt.cleanup===true&&receipt.failure===null&&
  Object.keys(receipt.cases).length===GOOGLE_CASES.length&&GOOGLE_CASES.every(name=>receipt.cases[name]?.passed===true);
 return receipt;
}
