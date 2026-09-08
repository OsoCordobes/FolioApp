import {assertLocalUrl,assertLocalDatabase,isolationError} from './isolation-policy.mjs';
export function testAppConfig(env){
 const appUrl=env.E2E_BASE_URL??'http://127.0.0.1:4410';
 const app=assertLocalUrl(appUrl);
 if(app.protocol!=='http:'||!app.port||Number(app.port)<1024||app.pathname!=='/'||app.search||app.hash)throw isolationError('Use a dedicated loopback HTTP test server port.');
 if(['3010','3000'].includes(app.port))throw isolationError('The ordinary development server cannot be reused for automated tests.');
 const supabaseUrl=env.FOLIO_TEST_SUPABASE_URL??'http://127.0.0.1:54321';assertLocalUrl(supabaseUrl);
 const anonKey=env.FOLIO_TEST_SUPABASE_ANON_KEY,serviceKey=env.FOLIO_TEST_SUPABASE_SERVICE_KEY;
 const realSupabase=Boolean(env.FOLIO_TEST_SUPABASE_URL&&anonKey&&serviceKey);
 if((env.FOLIO_TEST_SUPABASE_URL||anonKey||serviceKey)&&!realSupabase)throw isolationError('Provide the URL and both keys of the dedicated local Supabase instance together.');
 for(const [key,role] of [[anonKey,'anon'],[serviceKey,'service_role']])if(key){
  let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw isolationError('Use the legacy JWT keys from the dedicated local Supabase status, never hosted keys.');}
  if(!['supabase-demo','supabase-local'].includes(claims.iss)||claims.role!==role||claims.ref)throw isolationError('Hosted Supabase keys are forbidden in automated tests.');
 }
 const databaseUrl=env.FOLIO_TEST_DATABASE_URL;if(databaseUrl)assertLocalDatabase(databaseUrl);
 const email=env.FOLIO_TEST_LOGIN_EMAIL,password=env.FOLIO_TEST_LOGIN_PASSWORD;
 if(email&&!/@(?:[a-z0-9.-]+\.invalid|example\.test)$/i.test(email))throw isolationError('Use a synthetic local login email.');
 const bookingSlug=env.FOLIO_TEST_BOOKING_SLUG;
 if(bookingSlug&&!/^folio-test-[a-z0-9-]+$/.test(bookingSlug))throw isolationError('Use a dedicated folio-test-* booking fixture.');
 return {mode:'app',appUrl:app.origin,supabaseUrl,anonKey,serviceKey,databaseUrl,realSupabase,email,password,bookingSlug,prototypeRoot:env.FOLIO_TEST_PROTOTYPE_ROOT};
}
