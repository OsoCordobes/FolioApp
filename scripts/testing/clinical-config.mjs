import {createHmac} from 'node:crypto';
import {testAppConfig} from './app-config.mjs';
import {isolationError} from './isolation-policy.mjs';

/** Revalidate the runner's configuration before any fixture connection or write. */
export function clinicalConfig(env) {
 let source;
 try { source=JSON.parse(env.FOLIO_TEST_APP_CONFIG??'null'); } catch { throw isolationError('Invalid encoded local clinical configuration.'); }
 if(env.FOLIO_TEST_ISOLATED!=='1'||env.FOLIO_TEST_CLINICAL!=='1'||source?.clinical!==true)throw isolationError('Use the isolated clinical runner with explicit local credentials.');
 const config=testAppConfig({E2E_BASE_URL:source.appUrl,FOLIO_TEST_SUPABASE_URL:source.supabaseUrl,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl,FOLIO_TEST_CLINICAL:'1'});
 // This suite is tied to this repository's dedicated Supabase profile. A generic
 // localhost Postgres or ordinary development app is insufficient.
 const api=new URL(config.supabaseUrl),database=new URL(config.databaseUrl);
 if(api.origin!=='http://127.0.0.1:54321'||api.pathname!=='/'||api.search||api.hash||database.hostname!=='127.0.0.1'||database.port!=='54322'||database.pathname!=='/postgres'||config.appUrl!=='http://127.0.0.1:4410')throw isolationError('Clinical integration requires the dedicated 4410/54321/54322 local profile.');
 return config;
}

/** No migration, user, or patient write is allowed before this preflight passes. */
export function assertClinicalDatabase(row) {
 if(!row||!Number.isInteger(Number(row.version))||Number(row.version)<170000||Number(row.version)>=180000||row.real_auth!==true||row.real_storage!==true||row.migrations_ready!==true||Number(row.unsafe_organizations)!==0||Number(row.unsafe_auth_users)!==0)throw isolationError('The clinical target must be a migrated PostgreSQL 17 Supabase with real Auth/Storage and exclusively synthetic local fixtures.');
}

export const CLINICAL_POLICY_KEYS=Object.freeze(['mfa_ready','mfa_enforced','attachments','population','sessions','availability','representatives']);
export function assertClinicalPolicies(row) {
 if(!row||CLINICAL_POLICY_KEYS.some(key=>row[key]!==true))throw isolationError('Clinical policies are not all enforced; an unprotected happy path is not a valid integration result.');
}

/** RFC 6238 SHA1. Only synthetic local authenticator secrets enter this helper. */
export function totp(secret,timeMs=Date.now()) {
 if(typeof secret!=='string'||!/^[A-Z2-7]{16,128}$/i.test(secret)||!Number.isSafeInteger(timeMs)||timeMs<0)throw new Error('Invalid synthetic TOTP input.');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0;const bytes=[];
 for(const letter of secret.toUpperCase()){value=(value<<5)|alphabet.indexOf(letter);bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(timeMs/30000)));
 const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=digest[digest.length-1]&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
