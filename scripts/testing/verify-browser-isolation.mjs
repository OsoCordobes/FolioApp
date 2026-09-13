import './unit-bootstrap.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {guardBrowserContext,LOCAL_BROWSER_ARGS} from './browser-network.mjs';
const server=http.createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end('<!doctype html><title>Synthetic isolation fixture</title>Local test');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
 const context=await browser.newContext({serviceWorkers:'block'});await guardBrowserContext(context);
 const page=await context.newPage();let blocked=false;
 page.on('requestfailed',request=>{if(request.url().startsWith('https://api.resend.com/'))blocked=request.failure()?.errorText.includes('BLOCKED_BY_CLIENT')??false;});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 assert.equal(await page.title(),'Synthetic isolation fixture');
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://api.resend.com/');return true;}catch{return false;}}),false);
 assert.equal(blocked,true);
 assert.equal(await page.evaluate(()=>new Promise(resolve=>{const socket=new WebSocket('wss://api.resend.com/');socket.onclose=event=>resolve(event.code);setTimeout(()=>resolve('timeout'),2000);})),1008);
 console.log('PASS actual Chromium: local fixture works; external HTTP and WebSocket requests blocked before dispatch.');
}finally{if(browser)await browser.close();server.close();}
