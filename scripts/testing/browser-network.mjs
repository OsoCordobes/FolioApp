import {assertLocalUrl} from './isolation-policy.mjs';
export const LOCAL_BROWSER_ARGS=['--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]'];
export async function guardBrowserContext(context){
 await context.route('**/*',route=>{
  const value=route.request().url();
  try{assertLocalUrl(value);return route.continue();}catch{return route.abort('blockedbyclient');}
 });
 await context.routeWebSocket('**/*',socket=>{
  try{assertLocalUrl(socket.url(),['ws:','wss:']);socket.connectToServer();}catch{socket.close({code:1008,reason:'External network disabled in tests'});}
 });
}
