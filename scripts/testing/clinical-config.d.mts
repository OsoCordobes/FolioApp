export interface ClinicalConfig {appUrl:string;supabaseUrl:string;anonKey:string;serviceKey:string;databaseUrl:string;realSupabase:true;clinical:true;}
export function clinicalConfig(env:NodeJS.ProcessEnv|Record<string,string|undefined>):ClinicalConfig;
export function assertClinicalDatabase(row:Record<string,unknown>):void;
export const CLINICAL_POLICY_KEYS:readonly string[];
export function assertClinicalPolicies(row:Record<string,unknown>):void;
export type Aal1ProtectedReadResult={data:unknown[];error:null}|{data:unknown[]|null;error:{code:'42501';[key:string]:unknown}};
export function assertAal1ProtectedRead(result:unknown):asserts result is Aal1ProtectedReadResult;
export function totp(secret:string,timeMs?:number):string;
