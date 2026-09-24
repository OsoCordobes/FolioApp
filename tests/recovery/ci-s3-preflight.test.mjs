import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {requireEmptyS3Bucket} from '../../scripts/recovery/ci-s3-preflight.mjs';

const compose=readFileSync(new URL('../../scripts/recovery/ci-compose.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const proof=readFileSync(new URL('../../scripts/recovery/ci-proof.mjs',import.meta.url),'utf8');
const service=name=>compose.split(`  ${name}:\n`)[1]?.split(/^  [a-z][a-z-]*:/m)[0]??'';

test('synthetic S3 uses pinned official-overlay images and an internal project volume',()=>{
 assert.match(service('storage'),/image: supabase\/storage-api:v1\.74\.0/);
 assert.match(service('storage'),/STORAGE_BACKEND: s3/);
 assert.match(service('storage'),/GLOBAL_S3_ENDPOINT: http:\/\/minio:9000/);
 assert.match(service('storage'),/GLOBAL_S3_FORCE_PATH_STYLE: "true"/);
 assert.match(service('storage'),/minio-createbucket: \{condition: service_completed_successfully\}/);
 assert.match(service('minio'),/image: cgr\.dev\/chainguard\/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1/);
 assert.match(service('minio-createbucket'),/image: cgr\.dev\/chainguard\/minio-client@sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8/);
 assert.match(service('minio'),/minio-data:\/data/);
 assert.match(compose,/networks:\n  default:\n    internal: true/);
 assert.doesNotMatch(compose,/^\s+ports:|STORAGE_BACKEND: file|FILE_STORAGE_BACKEND_PATH|storagefiles:/m);
 assert.match(proof,/const source='folio_c01_source',destination='folio_c01_destination'/);
 assert.match(proof,/C01_MINIO_USER:randomBytes\(16\)\.toString\('hex'\),C01_MINIO_PASSWORD:b64\(36\)/);
 assert.match(proof,/const destinationEnv=\{\.\.\.env,C01_CRON_DATABASE:targetDatabase,C01_MINIO_USER:randomBytes\(16\)\.toString\('hex'\),C01_MINIO_PASSWORD:b64\(36\)\}/);
});

test('destination bucket preflight runs before database restore and exposes no object names',()=>{
 const init=service('minio-createbucket');
 assert.match(init,/objects="\$\$\(mc --json ls --recursive .* 2>\/dev\/null\)" \|\| exit 43/);
 assert.match(init,/\[ -z "\$\$objects" \] \|\| exit 44/);
 assert.match(init,/printf 'c01_s3_bucket_empty\\n'/);
 assert.ok(proof.indexOf("stage='target_s3_preflight';await preflightEmptyDestinationBucket(destinationEnv)")<proof.indexOf("stage='database_restore';await restore("));
 assert.equal(requireEmptyS3Bucket({code:0,output:'c01_s3_bucket_empty\n',errorOutput:''}),undefined);
 for(const result of [
  {code:44,output:'SECRET/object',errorOutput:''},
  {code:0,output:'c01_s3_bucket_empty\nSECRET/object',errorOutput:''},
  {code:0,output:'c01_s3_bucket_empty\n',errorOutput:'SECRET SDK BODY'},
  {code:0,output:'',errorOutput:''},
 ]) assert.throws(()=>requireEmptyS3Bucket(result),error=>error.message==='c01_s3_bucket_preflight_failed');
});
