import {POSTGRES_CATEGORIES,safePostgresDiagnostic} from './postgres.mjs';

const knownErrors=new Map([
 ['database_url_invalid','configuration'],
 ['restore_target_not_confirmed_local_new_database','target_guard'],
 ['restore_target_not_empty_loopback','target_guard'],
 ['restore_postgres_version_incompatible','compatibility'],
 ['restore_requires_prepared_roles_no_global_changes_permitted','roles'],
 ['restore_overlap','overlap'],
 ['database_archive_missing','package'],
 ['backup_receipt_invalid','integrity'],
 ['backup_integrity_failed','integrity'],
 ['backup_path_invalid','package'],
 ['backup_manifest_invalid','package'],
 ['backup_artifacts_mismatch','integrity'],
 ['backup_artifact_path_invalid','package'],
 ['backup_manifest_integrity_failed','integrity'],
 ['backup_authentication_failed_or_limit_exceeded','integrity'],
 ['backup_artifact_memory_limit_exceeded','limit'],
 ['restore_managed_extensions_missing','extensions'],
 ['postgres_operation_timeout','timeout'],
 ['postgres_timeout_invalid','configuration'],
 ['postgres_tool_version_invalid','tool_version'],
]);
const postgresToolErrors=new Set(['backup_database_operation_failed','postgres_tool_failed_or_warned','postgres_diagnostic_capture_failed']);
const sqlStates=new Set(['08001','08006','23503','23505','28000','28P01','3D000','42501','42P01','42704']);
const systemCodes=new Map([
 ['ECONNREFUSED','connection'],
 ['ECONNRESET','connection'],
 ['EPIPE','connection'],
 ['ETIMEDOUT','timeout'],
 ['ENOTFOUND','dns'],
 ['EACCES','permission'],
]);
const pgRestoreCategories=new Set(['pg_cron_database_mismatch','extension_version','extension_preload','extension_schema','permission','missing_role','other']);
function safeProperty(error,key){
 try{const value=error?.[key];return typeof value==='string'?value:null;}
 catch{return null;}
}

/** Fixed public tokens only; never copy an exception message into CI output. */
export function safeRestoreDiagnostic(error,phase){
 const safePhase=phase==='database'||phase==='storage'?phase:'unknown';
 const message=safeProperty(error,'message');
 const code=safeProperty(error,'code');
 if(knownErrors.has(message))return {phase:safePhase,category:knownErrors.get(message),code:message};
 if(postgresToolErrors.has(message)){
  const {category}=safePostgresDiagnostic(error);
  return {phase:safePhase,category,code:message};
 }
 if(sqlStates.has(code))return {phase:safePhase,category:'sqlstate',code};
 if(systemCodes.has(code))return {phase:safePhase,category:systemCodes.get(code),code};
 return {phase:safePhase,category:'unknown',code:'unclassified'};
}

/** Parse only diagnostics emitted by this module; raw process stderr stays private. */
export function parseSafeRestoreDiagnostic(stderr){
 const match=String(stderr).match(/^c01_restore_diagnostic phase=(database|storage|unknown) category=([a-z_]+) code=([A-Za-z0-9_]+)$/m);
 if(!match)return null;
 const [,phase,category,code]=match;
 if(knownErrors.get(code)===category)return {phase,category,code};
 if(postgresToolErrors.has(code)&&[...POSTGRES_CATEGORIES,'unspecified'].includes(category))return {phase,category,code};
 if(sqlStates.has(code)&&category==='sqlstate')return {phase,category,code};
 if(systemCodes.get(code)===category)return {phase,category,code};
 if(category==='unknown'&&code==='unclassified')return {phase,category,code};
 return null;
}

/** Inspect bounded tool stderr in memory and return a fixed public category. */
export function classifyPgRestoreStderr(stderr){
 const value=Buffer.isBuffer(stderr)?stderr.toString('utf8'):String(stderr);
 if(/can only create extension in database/i.test(value)&&/pg_cron|cron\.database_name/i.test(value))return 'pg_cron_database_mismatch';
 if(/(?:extension .* is not available|could not open extension control file|no installation script|version .* is not available)/i.test(value))return 'extension_version';
 if(/(?:can only be loaded via shared_preload_libraries|must be loaded via shared_preload_libraries)/i.test(value))return 'extension_preload';
 if(/(?:extension .* must be installed in schema|schema .* already exists)/i.test(value))return 'extension_schema';
 if(/(?:permission denied|must be owner of|must be superuser)/i.test(value))return 'permission';
 if(/role .* does not exist/i.test(value))return 'missing_role';
 return 'other';
}

export function parseSafePgRestoreDiagnostic(stderr){
 const match=String(stderr).match(/^c01_pg_restore_diagnostic category=([a-z_]+)$/m);
 return match&&pgRestoreCategories.has(match[1])?match[1]:null;
}
