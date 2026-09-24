/** Accept only the fixed success marker from the isolated bucket initializer. */
export function requireEmptyS3Bucket(result){
 if(result?.code!==0||typeof result?.output!=='string'||result.output.trim()!=='c01_s3_bucket_empty'||typeof result?.errorOutput!=='string'||result.errorOutput.trim()!=='')
  throw Error('c01_s3_bucket_preflight_failed');
}
