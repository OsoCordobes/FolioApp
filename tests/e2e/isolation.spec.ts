import {test,expect} from '../fixtures/local-test';

test('owned local app is reachable while browser provider requests stay blocked',async({page,browser})=>{
 expect(process.env.FOLIO_TEST_ISOLATED).toBe('1');
 const response=await page.goto('/login');
 expect(response?.status()).toBe(200);
 await expect(page.locator('input[type="email"]').first()).toBeVisible();
 expect(new URL(page.url()).origin).toBe(new URL(process.env.E2E_BASE_URL!).origin);
 // Explicit new contexts must receive the same protection as the page fixture.
 const extra=await browser.newContext({baseURL:process.env.E2E_BASE_URL});
 try{
  const other=await extra.newPage();await other.goto('/login');
  expect(await other.evaluate(async()=>{try{await fetch('https://api.resend.com/');return 'escaped';}catch{return 'blocked';}})).toBe('blocked');
  expect(await other.evaluate(()=>new Promise<number|string>(resolve=>{const socket=new WebSocket('wss://api.resend.com/');socket.onclose=event=>resolve(event.code);setTimeout(()=>resolve('timeout'),2000);}))).toBe(1008);
 }finally{await extra.close();}
});
