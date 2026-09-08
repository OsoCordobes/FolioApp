import {spawn} from 'node:child_process';
import path from 'node:path';
import {safeEnvironment,isolationError} from './isolation-policy.mjs';
const input=process.argv.slice(2).filter(value=>value!=='--');
for(const arg of input){
 if(/^--test-(name-pattern|skip-pattern|reporter|concurrency)=/.test(arg)||arg==='--test-only')continue;
 const resolved=path.resolve(arg),root=path.resolve('tests/unit')+path.sep;
 if(!resolved.startsWith(root)||!resolved.endsWith('.test.ts'))throw isolationError('Only unit test paths and test selection options are accepted.');
}
const files=input.some(arg=>!arg.startsWith('--'))?input:[...input,'tests/unit/**/*.test.ts'];
const child=spawn(process.execPath,['--test','--conditions','react-server','--import',new URL('./unit-bootstrap.mjs',import.meta.url).href,'--import','tsx',...files],{stdio:'inherit',env:safeEnvironment(process.env)});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
