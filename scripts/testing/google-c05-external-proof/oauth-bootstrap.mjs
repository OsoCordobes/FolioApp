import assert from 'node:assert/strict';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateManifest,validateGrant,SCOPE} from './contract.mjs';
export function bootstrapChallenge(manifest,now=Date.now()){
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
 return {version:1,runId:manifest.runId,state,verifier,expiresAt:now+10*60000,
  challenge:createHash('sha256').update(verifier).digest('base64url')};
}
export function validateCallback(callback,challenge,manifest,now=Date.now()){
 assert.equal(challenge.runId,manifest.runId,'oauth_run');assert.ok(challenge.expiresAt>now,'oauth_expired');
 assert.equal(typeof callback?.state,'string','oauth_state');const a=Buffer.from(callback.state),b=Buffer.from(challenge.state);
 assert.ok(a.length===b.length&&timingSafeEqual(a,b),'oauth_state');
 assert.ok(typeof callback.code==='string'&&callback.code.length>10&&callback.code.length<4096,'oauth_code');
}
export async function consentUrl(manifest,challenge){
 // Reuse Folio's current scope/helper; PKCE is added only for this bootstrap.
 process.env.GOOGLE_OAUTH_CLIENT_ID=manifest.clientId;process.env.GOOGLE_OAUTH_CLIENT_SECRET='bootstrap-private-placeholder';
 process.env.GOOGLE_OAUTH_REDIRECT_URI=manifest.redirectUri;
 const oauth=await import('../../../lib/google/oauth.ts');const url=new URL((oauth.default??oauth).getAuthUrl(challenge.state));
 url.searchParams.set('code_challenge',challenge.challenge);url.searchParams.set('code_challenge_method','S256');
 url.searchParams.set('login_hint',manifest.accountEmail);
 assert.equal(url.searchParams.get('scope'),SCOPE,'oauth_scope');return url.toString();
}
export async function exchange({manifest,challenge,callback,clientSecret,fetchImpl,now=Date.now()}){
 validateCallback(callback,challenge,manifest,now);
 const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:manifest.clientId,client_secret:clientSecret,code:callback.code,
   redirect_uri:manifest.redirectUri,grant_type:'authorization_code',code_verifier:challenge.verifier})});
 if(!response.ok)throw Error('oauth_exchange_failed');const tokens=await response.json();
 assert.deepEqual(tokens.scope?.split(' ').sort(),[SCOPE],'oauth_scope');
 const grant={version:1,clientId:manifest.clientId,accountEmail:manifest.accountEmail,calendarId:manifest.calendarId,
  scopes:[SCOPE],refreshToken:tokens.refresh_token,consentAt:new Date(now).toISOString(),custodianConfirmedDedicatedAccount:true};
 return validateGrant(grant,manifest,now);
}
async function privateRead(file){const s=await stat(file);assert.ok(s.isFile()&&s.size<16384,'private_input');if(process.platform!=='win32')assert.equal(s.mode&0o077,0,'private_permissions');return JSON.parse(await readFile(file,'utf8'));}
async function main(){
 const [mode,manifestFile,privateDirectory]=process.argv.slice(2);assert.ok(['--prepare','--exchange'].includes(mode),'bootstrap_mode');
 assert.ok(manifestFile&&privateDirectory,'bootstrap_inputs');
 const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),dir=path.resolve(privateDirectory);
 assert.ok(dir!==repo&&!dir.startsWith(repo+path.sep),'private_directory_outside_repo');
 if(process.platform!=='win32')assert.equal((await stat(dir)).mode&0o077,0,'private_directory_permissions');
 const m=await privateRead(manifestFile);validateManifest(m,{sha:process.env.C05_CANDIDATE,environment:process.env.C05_ENVIRONMENT,authorizationId:process.env.C05_AUTHORIZATION_ID});
 if(mode==='--prepare'){
  const challenge=bootstrapChallenge(m),url=await consentUrl(m,challenge);
  await writeFile(path.join(dir,'challenge.json'),JSON.stringify(challenge),{mode:0o600,flag:'wx'});
  await writeFile(path.join(dir,'consent-url.txt'),url,{mode:0o600,flag:'wx'});
 }else{
  assert.equal(process.env.C05_CONSENT_EXCHANGE,'authorized','consent_exchange_closed');
  assert.equal(process.env.C05_CUSTODIAN_CONFIRMED_ACCOUNT,m.accountEmail,'custodian_account_required');
  const challenge=await privateRead(path.join(dir,'challenge.json')),callback=await privateRead(path.join(dir,'callback.json'));
  const secret=await privateRead(path.join(dir,'client.json'));assert.equal(secret.clientId,m.clientId,'client_mismatch');
  // Mark attempted before sending: interrupted/uncertain exchange is never blindly retried.
  await writeFile(path.join(dir,'exchange-attempt.json'),JSON.stringify({runId:m.runId,attempted:true}),{mode:0o600,flag:'wx'});
  const grant=await exchange({manifest:m,challenge,callback,clientSecret:secret.clientSecret,fetchImpl:globalThis.fetch});
  await writeFile(path.join(dir,'grant.json'),JSON.stringify(grant),{mode:0o600,flag:'wx'});
 }
 console.log('c05_bootstrap_private_output_created');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('c05_bootstrap_rejected');process.exitCode=1;});
