import assert from "node:assert/strict";
import test from "node:test";
import {ClinicalSaveCoordinator} from "../../lib/ficha/clinical-save-coordinator";
const draft=(s:string)=>({soap:{subjetivo:s,objetivo:"",analisis:"",plan:""},toolValue:null});
test("same-frame double clicks and close cannot overtake an in-flight save",()=>{
 const c=new ClinicalSaveCoordinator(0,draft(""));const first=c.begin(draft("one"),"SAVE","first");assert.ok(first);assert.equal(c.begin(draft("two"),"SAVE","second"),null);assert.equal(c.begin(draft("two"),"CLOSE","third"),null);
});
test("acknowledgment advances only the submitted baseline; later edits remain pending",()=>{
 const c=new ClinicalSaveCoordinator(4,draft("before"));const op=c.begin(draft("submitted"),"SAVE","one")!;c.acknowledge(op,{revision:5,closed:false});assert.equal(c.revision,5);assert.equal(c.baseline.soap.subjetivo,"submitted");assert.equal(c.isDirty(draft("typed during request")),true);assert.equal(c.begin(draft("typed during request"),"SAVE","two")!.expectedRevision,5);
});
test("lost response retries the same operation and immutable snapshot, not later edits",()=>{
 const c=new ClinicalSaveCoordinator(2,draft("old"));const input=draft("sent");const op=c.begin(input,"SAVE","same")!;input.soap.subjetivo="mutated after submission";c.reject(op,"uncertain");assert.equal(c.begin(draft("later"),"CLOSE","different"),null);const retry=c.begin(draft("later"),"SAVE","new-id")!;assert.equal(retry.operationId,"same");assert.equal(retry.draft.soap.subjetivo,"sent");assert.equal(retry.expectedRevision,2);c.acknowledge(retry,{revision:3,closed:false});assert.equal(c.isDirty(draft("later")),true);
});
test("a conflict prevents repeated autosave overwrites while retaining the local baseline",()=>{
 const c=new ClinicalSaveCoordinator(1,draft("old"));const op=c.begin(draft("mine"),"SAVE","one")!;c.reject(op,"conflict");assert.equal(c.conflicted,true);assert.equal(c.begin(draft("mine edited again"),"SAVE","two"),null);assert.equal(c.baseline.soap.subjetivo,"old");assert.equal(c.revision,1);
});
test("confirmed close never permits rewriting its original and reports later local edits",()=>{
 const c=new ClinicalSaveCoordinator(3,draft("old"));const op=c.begin(draft("final"),"CLOSE","close")!;c.acknowledge(op,{revision:4,closed:true});assert.equal(c.closed,true);assert.equal(c.isDirty(draft("late local change")),true);assert.equal(c.begin(draft("late local change"),"SAVE","bad"),null);
});
