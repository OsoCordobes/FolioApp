export const BROWSER_PHASES=new Set([
 'launch','context','goto','prepare','save_ready','cookies','mobile_width','mobile_capture',
 'desktop_capture','save','complete_file','archive_open','archive_copy','archive_list',
 'document_extract','signature_extract','json_extract','manifest_extract','interrupt_enable',
 'interrupt_save','interrupt_ready','interrupt_state','preserve_hash','context_close',
 'unsupported_context','unsupported_goto','unsupported_prepare','unsupported_save_ready',
 'unsupported_save','unsupported_ready','unsupported_close','complete','cleanup',
]);

export const BROWSER_ASSERTION_CODES=new Set([
 'archive_page_unavailable','archive_mobile_overflow','browser_file_not_50mib',
 'browser_archive_name','browser_archive_magic','browser_archive_not_closed',
 'tar_entries_missing','withdrawn_bytes_in_tar','independent_tar_document_mismatch',
 'independent_tar_signature_mismatch','independent_tar_json_invalid',
 'withdrawn_metadata_missing','interruption_before_partial_write',
 'interrupted_writer_not_aborted','interruption_replaced_prior_file_size',
 'interruption_replaced_prior_file_hash',
]);

function safeText(value,key){
 try{const text=value?.[key];return typeof text==='string'?text:null;}catch{return null;}
}

export function browserAssertion(condition,code){
 if(condition)return;
 const error=new Error('b06_browser_assertion_failed');
 error.name='B06BrowserAssertion';
 error.browserAssertionCode=BROWSER_ASSERTION_CODES.has(code)?code:'unclassified';
 throw error;
}

export function browserFailureDiagnostic(error,phase){
 const safePhase=BROWSER_PHASES.has(phase)?phase:'cleanup';
 const name=safeText(error,'name');
 const ownCode=safeText(error,'browserAssertionCode');
 const kind=name==='B06BrowserAssertion'?'assertion':
  name==='TimeoutError'||name==='AbortError'?'timeout':
  name==='TargetClosedError'||name==='BrowserClosedError'?'browser_closed':'other';
 return {phase:safePhase,kind,
  code:kind==='assertion'&&BROWSER_ASSERTION_CODES.has(ownCode)?ownCode:'none'};
}

export function attachBrowserFailure(error,phase){
 const failure=error instanceof Error?error:new Error('b06_browser_failed');
 const value=browserFailureDiagnostic(error,phase);
 try{
  Object.defineProperty(failure,'b06BrowserDiagnostic',{
   value,enumerable:false,configurable:false,
  });
  return failure;
 }catch{
  const replacement=new Error('b06_browser_failed');
  Object.defineProperty(replacement,'b06BrowserDiagnostic',{
   value,enumerable:false,configurable:false,
  });
  return replacement;
 }
}

export function safeAttachedBrowserFailure(error){
 try{
  const value=error?.b06BrowserDiagnostic;
  if(!value||!BROWSER_PHASES.has(value.phase)||
     !['timeout','assertion','browser_closed','other'].includes(value.kind))return null;
  const code=value.kind==='assertion'&&BROWSER_ASSERTION_CODES.has(value.code)?value.code:'none';
  return {phase:value.phase,kind:value.kind,code};
 }catch{return null;}
}

export function browserDiagnosticLine(error){
 const value=safeAttachedBrowserFailure(error);
 return value?`b06b3_browser_diagnostic phase=${value.phase} kind=${value.kind} code=${value.code}`:null;
}
