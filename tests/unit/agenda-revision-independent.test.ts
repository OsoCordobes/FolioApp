import assert from "node:assert/strict";
import test from "node:test";
import { createAgendaRevisionMonitor, type AgendaRevision, type AgendaSyncState } from "../../lib/agenda/revision-monitor";

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function fixture(read: () => Promise<AgendaRevision>, renderedRevision: string | null = null) {
  let refreshes = 0;
  const states: AgendaSyncState[] = [];
  let next: (() => void) | undefined;
  const monitor = createAgendaRevisionMonitor({organizationId:"org",renderedRevision,read,
    refresh:()=>{refreshes++;},status:state=>states.push(state),
    schedule(callback){next=callback;return 1 as unknown as ReturnType<typeof setTimeout>;},cancel(){next=undefined;},
  });
  return {monitor,states,get refreshes(){return refreshes;},tick(){const callback=next;next=undefined;callback?.();}};
}

test("local midnight changes the token without changing the write counter",async()=>{
  const f=fixture(async()=>({organizationId:"org",revision:"7:2026-09-09"}),"7:2026-09-08");
  try{
    f.monitor.setVisible(true);await flush();assert.equal(f.refreshes,1);
    f.monitor.acknowledge("7:2026-09-09");assert.equal(f.states.at(-1),"active");
    f.tick();await flush();assert.equal(f.refreshes,1);
  }finally{f.monitor.stop();}
});

test("a restored lower counter eventually refreshes instead of permanently trusting a higher old ACK",async()=>{
  const f=fixture(async()=>({organizationId:"org",revision:"10:2026-09-08"}),"100:2026-09-08");
  try{
    f.monitor.setVisible(true);await flush();f.tick();await flush();
    assert.ok(f.refreshes>0,"a reset counter cannot suppress refresh until it grows back to 100");
    assert.notEqual(f.states.at(-1),"active");
    f.monitor.acknowledge("10:2026-09-08");assert.equal(f.states.at(-1),"active");
  }finally{f.monitor.stop();}
});

test("late render ACK does not erase a later failed permissions or revision check",async()=>{
  let unavailable=false;
  const f=fixture(async()=>{if(unavailable)throw Error("permission check unavailable");return {organizationId:"org",revision:"7:2026-09-08"};},"6:2026-09-08");
  try{
    f.monitor.setVisible(true);await flush();
    unavailable=true;f.tick();await flush();assert.equal(f.states.at(-1),"stale");
    f.monitor.acknowledge("7:2026-09-08");assert.equal(f.states.at(-1),"stale","old render does not prove the current session is valid");
    unavailable=false;f.tick();await flush();assert.equal(f.states.at(-1),"active");
  }finally{f.monitor.stop();}
});

test("an older rendered snapshot cannot remain marked active until the next poll",async()=>{
  const f=fixture(async()=>({organizationId:"org",revision:"8:2026-09-08"}),"8:2026-09-08");
  try{
    f.monitor.setVisible(true);await flush();assert.equal(f.states.at(-1),"active");
    f.monitor.acknowledge("7:2026-09-08");assert.notEqual(f.states.at(-1),"active");
    f.tick();await flush();assert.equal(f.refreshes,1);
  }finally{f.monitor.stop();}
});

test("stopped organization generation ignores late render ACK and late foreign response",async()=>{
  let resolve!: (value:AgendaRevision)=>void;
  const f=fixture(()=>new Promise(r=>{resolve=r;}),"2:2026-09-08");
  f.monitor.setVisible(true);f.monitor.stop();const count=f.states.length;
  f.monitor.acknowledge("3:2026-09-08");resolve({organizationId:"other",revision:"3:2026-09-08"});await flush();
  assert.equal(f.refreshes,0);assert.equal(f.states.length,count);
});
