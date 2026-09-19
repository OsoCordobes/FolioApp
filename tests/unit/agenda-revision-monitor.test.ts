import assert from "node:assert/strict";
import test from "node:test";
import { createAgendaRevisionMonitor, type AgendaSyncState, type AgendaRevision } from "../../lib/agenda/revision-monitor";

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function fixture(read: (signal: AbortSignal) => Promise<AgendaRevision>) {
  let refreshes = 0;
  const states: AgendaSyncState[] = [];
  let next: (() => void) | undefined;
  let delay = 0;
  const monitor = createAgendaRevisionMonitor({organizationId:"org",read,refresh:()=>refreshes++,status:s=>states.push(s),
    schedule(callback, milliseconds) { next=callback; delay=milliseconds; return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel() { next=undefined; },
  });
  return {monitor,states,get refreshes(){return refreshes;},get delay(){return delay;},tick(){const fn=next;next=undefined;fn?.();}};
}

test("unchanged revisions avoid full refresh; initial and changed revisions refresh", async () => {
  let revision="1:2026-09-08",reads=0;
  const f=fixture(async()=>{reads++;return {organizationId:"org",revision};});
  f.monitor.setVisible(true); await flush();
  assert.equal(f.refreshes,1);
  f.monitor.acknowledge("1:2026-09-08");
  f.tick();await flush();assert.equal(f.refreshes,1);
  revision="2:2026-09-08";f.tick();await flush();assert.equal(f.refreshes,2);f.monitor.acknowledge("2:2026-09-08");
  assert.equal(reads,3);assert.equal(f.delay,25000);
  f.monitor.stop();
});

test("hidden or unmounted views abort work and cannot apply late responses", async () => {
  let resolve!: (value: AgendaRevision)=>void;
  let signal!:AbortSignal;
  let reads=0;
  const f=fixture(s=>{signal=s;reads++;return new Promise(r=>resolve=r);});
  f.monitor.setVisible(true);
  f.monitor.check();assert.equal(reads,1,"no overlapping reads");
  f.monitor.setVisible(false);assert.equal(signal.aborted,true);
  resolve({organizationId:"org",revision:"1:2026-09-08"});await flush();assert.equal(f.refreshes,0);
  f.tick();assert.equal(reads,1);
  f.monitor.setVisible(true);assert.equal(reads,2);
  f.monitor.stop();assert.equal(signal.aborted,true);
  resolve({organizationId:"org",revision:"2:2026-09-08"});await flush();assert.equal(f.refreshes,0);
});

test("unavailable/malformed/cross-org answers preserve the view and show stale status with backoff", async () => {
  const answers: Array<AgendaRevision|Error>=[new Error("provider"),{organizationId:"other",revision:"1:2026-09-08"},{organizationId:"org",revision:"NaN"},{organizationId:"org",revision:"5:2026-09-08"}];
  const f=fixture(async()=>{const value=answers.shift()!;if(value instanceof Error)throw value;return value;});
  f.monitor.setVisible(true);await flush();assert.equal(f.delay,50000);
  f.tick();await flush();assert.equal(f.delay,100000);
  f.tick();await flush();assert.equal(f.delay,120000);
  assert.equal(f.refreshes,0);assert.deepEqual(f.states,["stale","stale","stale"]);
  f.tick();await flush();assert.equal(f.refreshes,1);assert.equal(f.delay,25000);f.monitor.acknowledge("5:2026-09-08");assert.equal(f.states.at(-1),"active");
  f.monitor.stop();
});

test("failed server render is retried and shown stale until an actual SSR revision acknowledges it", async () => {
  const f=fixture(async()=>({organizationId:"org",revision:"7:2026-09-08"}));
  f.monitor.acknowledge("6:2026-09-08");f.monitor.setVisible(true);await flush();
  assert.equal(f.refreshes,1);assert.equal(f.states.at(-1),"checking");
  f.tick();await flush();assert.equal(f.refreshes,2);assert.equal(f.states.at(-1),"stale");
  f.monitor.acknowledge("7:2026-09-08");assert.equal(f.states.at(-1),"active");
  f.tick();await flush();assert.equal(f.refreshes,2,"same revision after real ACK must not refresh");
  f.monitor.acknowledge(null);assert.equal(f.states.at(-1),"stale");
  f.tick();await flush();assert.equal(f.refreshes,3,"failed pre-read invalidates prior ACK");
  f.monitor.stop();
});
