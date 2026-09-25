import {isolationError} from './isolation-policy.mjs';
import {clinicalConfig,assertClinicalDatabase,assertClinicalPolicies} from './clinical-config.mjs';
import path from 'node:path';

const CASES=Object.freeze(['ASISTENTE','COORDINADOR']);
const TITLE=/^(ASISTENTE|COORDINADOR) sees the scoped week and month, without clinical fields or a foreign tenant$/;

export function receptionCiEnvironment(status,source) {
 if(status?.API_URL!=='http://127.0.0.1:54321'||typeof status?.ANON_KEY!=='string'||typeof status?.SERVICE_ROLE_KEY!=='string'||typeof status?.DB_URL!=='string')throw isolationError('Dedicated local Supabase status is incomplete.');
 const env={
  ...source,E2E_BASE_URL:'http://localhost:4420',FOLIO_TEST_ISOLATED:'1',FOLIO_TEST_CLINICAL:'1',
  FOLIO_TEST_SUPABASE_URL:status.API_URL,FOLIO_TEST_SUPABASE_ANON_KEY:status.ANON_KEY,
  FOLIO_TEST_SUPABASE_SERVICE_KEY:status.SERVICE_ROLE_KEY,FOLIO_TEST_DATABASE_URL:status.DB_URL,
 };
 const config={mode:'app',appUrl:env.E2E_BASE_URL,supabaseUrl:env.FOLIO_TEST_SUPABASE_URL,
  anonKey:env.FOLIO_TEST_SUPABASE_ANON_KEY,serviceKey:env.FOLIO_TEST_SUPABASE_SERVICE_KEY,
  databaseUrl:env.FOLIO_TEST_DATABASE_URL,realSupabase:true,clinical:true};
 env.FOLIO_TEST_APP_CONFIG=JSON.stringify(config);
 clinicalConfig(env);
 return env;
}

export function assertFreshReceptionDatabase(row,expectedVersions,actualVersions) {
 assertClinicalDatabase(row);
 if(!Array.isArray(expectedVersions)||expectedVersions.length===0||new Set(expectedVersions).size!==expectedVersions.length
  ||!Array.isArray(actualVersions)||actualVersions.length!==expectedVersions.length
  ||expectedVersions.some((version,index)=>version!==actualVersions[index]))throw isolationError('The hosted database migration ledger differs from this checkout.');
}

export function assertReceptionPolicies(row) {
 assertClinicalPolicies(row);
 if(row?.atomic_close!==true||row?.payment_settlement!==true)throw isolationError('Nine clinical controls are required before browser fixtures.');
}

export function summarizeReceptionReport(report) {
 const root=report?.config?.rootDir;
 if(typeof root!=='string'||path.resolve(root)!==path.resolve('tests'))throw isolationError('Reception browser report has an unexpected test root.');
 const specs=[];
 function visit(suite) {
  for(const spec of suite?.specs??[])specs.push(spec);
  for(const child of suite?.suites??[])visit(child);
 }
 for(const suite of report?.suites??[])visit(suite);
 const cases=[];
 for(const spec of specs) {
  const match=TITLE.exec(spec?.title??'');
  const specFile=spec?.file;
  if(!match||typeof specFile!=='string'||path.resolve(root,specFile)!==path.resolve(root,'e2e/calendario-reception.spec.ts')||spec.tests?.length!==1||spec.tests[0]?.results?.length!==1)throw isolationError('Reception browser report contains an unexpected case.');
  const result=spec.tests[0].results[0];
  const status=result?.status;
  if(!['passed','failed','skipped','timedOut','interrupted'].includes(status))throw isolationError('Reception browser report contains an unknown status.');
  const location=result.errors?.[0]?.location;
  const file=String(location?.file??'').replaceAll('\\','/');
  const source=file.endsWith('/tests/e2e/calendario-reception.spec.ts')?'spec':file.includes('/tests/fixtures/')?'fixture':file.includes('/app/')||file.includes('/lib/')?'app':'unknown';
  const line=Number.isInteger(location?.line)&&location.line>0&&location.line<10000?location.line:null;
  cases.push({role:match[1],status,source,line});
 }
 if(cases.length!==CASES.length||CASES.some(role=>cases.filter(item=>item.role===role).length!==1))throw isolationError('Reception browser must execute exactly two roles.');
 return {cases,passed:cases.every(item=>item.status==='passed'),executed:cases.filter(item=>item.status!=='skipped').length};
}
