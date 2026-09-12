export interface ClinicalConfig {appUrl:string;supabaseUrl:string;anonKey:string;serviceKey:string;databaseUrl:string;realSupabase:true;clinical:true;}
export function clinicalConfig(env:NodeJS.ProcessEnv|Record<string,string|undefined>):ClinicalConfig;
export function assertClinicalDatabase(row:Record<string,unknown>):void;
export const CLINICAL_POLICY_KEYS:readonly string[];
export function assertClinicalPolicies(row:Record<string,unknown>):void;
export function totp(secret:string,timeMs?:number):string;
