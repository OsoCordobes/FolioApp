import assert from 'node:assert/strict';
import test from 'node:test';
import {servicesStatus} from './run.mjs';

test('reports only fixed services and bounded Compose fields',()=>{
 const output=[
  {Service:'db',State:'running',Health:'healthy',ExitCode:0,Name:'secret-container-name'},
  {Service:'minio-createbucket',State:'exited',Health:'',ExitCode:42,Publishers:'password=secret'},
  {Service:'injected-password',State:'running',Health:'healthy',ExitCode:0},
 ].map(row=>JSON.stringify(row)).join('\n');
 const status=servicesStatus(output);
 assert.match(status,/\bdb=running_healthy_exit0\b/);
 assert.match(status,/\bminio-createbucket=exited_none_exit42\b/);
 assert.match(status,/\bauth=missing\b/);
 assert.doesNotMatch(status,/secret|injected|container-name|password/);
});

test('rejects malformed rows and does not echo unknown status values',()=>{
 assert.equal(servicesStatus('password=secret'), 'ps=unavailable');
 const status=servicesStatus(JSON.stringify([{Service:'db',State:'secret',Health:'secret',ExitCode:'secret'},
  {Service:'auth',State:'exited',Health:null,ExitCode:null}]));
 assert.match(status,/\bdb=other_none_exitother\b/);
 assert.match(status,/\bauth=exited_none_exitother\b/);
 assert.doesNotMatch(status,/secret/);
});

test('accepts Compose JSON arrays as well as newline-delimited JSON',()=>{
 const rows=[{Service:'db',State:'running',Health:'starting',ExitCode:0}];
 assert.equal(servicesStatus(JSON.stringify(rows)),servicesStatus(rows.map(JSON.stringify).join('\n')));
});
