import type {BrowserContext} from '@playwright/test';
export function guardBrowserContext(context:BrowserContext):Promise<void>;
export const LOCAL_BROWSER_ARGS: string[];
