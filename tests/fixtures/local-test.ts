import {test as base,expect,type Browser} from '@playwright/test';
import {guardBrowserContext} from '../../scripts/testing/browser-network.mjs';
export * from '@playwright/test';
export {expect};
export const test=base.extend({
 browser:async({browser},provide)=>{
  // Covers both built-in page/context fixtures and explicit browser.newContext.
  const create=browser.newContext.bind(browser);
  browser.newContext=async(options)=>{const context=await create({...options,serviceWorkers:'block'});await guardBrowserContext(context);return context;};
  try{await provide(browser as Browser);}finally{browser.newContext=create;}
 },
});
