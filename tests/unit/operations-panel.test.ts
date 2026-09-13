import assert from 'node:assert/strict';import test from 'node:test';
import { normalizeOperationsSnapshot, quotaState } from '../../lib/operations/model';
test('absent and malformed source data stays unknown, never zero/healthy',()=>{const s=normalizeOperationsSnapshot({queues:[{key:'billing_followup',state:'known',pending:'wrong'}],metrics:[]});assert.equal(s.queues.length,6);assert.ok(s.queues.every(q=>q.state==='unknown'));assert.ok(s.metrics.every(m=>quotaState(m,s)==='unknown'));assert.equal(s.backup.state,'unknown')});
test('response allowlist strips identifiers, emails, provider tokens and job payloads',()=>{const s=normalizeOperationsSnapshot({generatedAt:'2026-09-08T00:00:00Z',warningPercent:60,pausePercent:70,backupMaxAgeHours:36,queues:[{key:'billing_followup',state:'known',pending:1,leased:0,terminal:0,uncertain:0,due:1,oldestPendingAt:null,email:'patient@invalid',payload:'clinical narrative',provider_id:'credential'}],metrics:[],backup:{state:'no_report',path:'private/path'}});const raw=JSON.stringify(s);assert.equal(s.queues[0].state,'known');for(const secret of ['patient@invalid','clinical narrative','credential','private/path'])assert.equal(raw.includes(secret),false)});
test('quota alerts use configured 60/70 percentages and require a verified denominator',()=>{const policy={warningPercent:60,pausePercent:70}, dates={limitVerifiedAt:'2026-09-08T00:00:00Z',limitValidUntil:'2026-09-09T00:00:00Z'},now=Date.parse('2026-09-08T12:00:00Z');for(const[value,expected]of [[59,'within'],[60,'warning'],[70,'pause']]as const){assert.equal(quotaState({key:'active_members',state:'known',value,limit:100,...dates},policy,now),expected)}assert.equal(quotaState({key:'active_members',state:'known',value:0,limit:null,...dates},policy,now),'unknown')});


test('expired or missing capacity evidence never gives an available capacity indicator',()=>{
 const metric={key:'active_members',state:'known',value:1,limit:100} as const;
 const policy={warningPercent:60,pausePercent:70};
 assert.equal(quotaState({...metric,limitVerifiedAt:null,limitValidUntil:null},policy),'unknown');
 assert.equal(quotaState({...metric,limitVerifiedAt:'2026-09-01T00:00:00Z',limitValidUntil:'2026-09-07T00:00:00Z'},policy,Date.parse('2026-09-08T00:00:00Z')),'unknown');
});

test('duplicate source rows and unexpected backup categories fail closed',()=>{
 const row={key:'active_members',state:'known',value:1,limit:100,limitVerifiedAt:'2026-09-01T00:00:00Z',limitValidUntil:'2026-09-09T00:00:00Z'};
 const snapshot=normalizeOperationsSnapshot({metrics:[row,row],backup:{state:'healthy',outcome:'success'}});
 assert.equal(snapshot.metrics.find(m=>m.key==='active_members')?.state,'unknown');
 assert.equal(snapshot.backup.state,'unknown');
});

test('a recent failed attempt preserves the old verified copy and its stale warning',()=>{
 const raw={state:'reported',outcome:'failed',finishedAt:'2026-09-08T12:00:00Z',reportedAt:'2026-09-08T12:00:01Z',lastVerifiedAt:'2026-09-07T10:00:00Z',stale:true,archiveBytes:0,objectCount:0,integrityVerified:false,restoreScope:'none',restoreVerifiedAt:null};
 const snapshot=normalizeOperationsSnapshot({backup:raw});
 assert.equal(snapshot.backup.state,'reported');
 if(snapshot.backup.state==='reported'){
  assert.equal(snapshot.backup.outcome,'failed');
  assert.equal(snapshot.backup.lastVerifiedAt,'2026-09-07T10:00:00Z');
  assert.equal(snapshot.backup.stale,true);
 }
 const missing=normalizeOperationsSnapshot({backup:{...raw,lastVerifiedAt:undefined}});
 assert.equal(missing.backup.state,'unknown');
});
