// Package an existing, reviewed local runtime. Never captures or schedules.
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileDigest } from './envelope.mjs';
import { OWNER_ROOT, validateOwnedRoot } from './owned-workflow.mjs';
const sourceFiles = ['capture-owned.mjs','core.mjs','envelope.mjs','lock.mjs','owned-task.mjs','owned-task.ps1','owned-workflow.mjs','paths.mjs','postgres.mjs','restore-local.mjs','restore.mjs','retention.mjs','run.mjs','source.mjs','storage-restore.mjs','storage.mjs','verify-owned-structure.mjs'].map(name=>`scripts/backup/${name}`).concat('scripts/recovery/envelope.mjs');
const internalFiles = new Set(['runtime-manifest.json','invoke-owned-backup.ps1']);
/** Extract only pg's already locked dependency closure, including integrity
 * hashes. No registry metadata lookup or fresh version resolution is needed. */
export function pgRuntimeLock(source) {
  const text=source.replace(/\r\n/g,'\n');
  if(!text.startsWith("lockfileVersion: '9.0'\n"))throw Error('runtime_lock_version');
  const packageText=text.split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0];
  const snapshotText=text.split('\nsnapshots:\n')[1];
  if(!packageText||!snapshotText)throw Error('runtime_lock_invalid');
  function blocks(section) {
    const matches=[...section.matchAll(/^  (\S[^:\n]*):(?: \{\})?$/gm)];
    return new Map(matches.map((match,index)=>[match[1].replace(/^['"]|['"]$/g,''),section.slice(match.index,matches[index+1]?.index??section.length).trimEnd()+'\n']));
  }
  const packages=blocks(packageText),snapshots=blocks(snapshotText),wanted=new Set(),queue=['pg@8.21.0'];
  while(queue.length) {
    const key=queue.pop();if(wanted.has(key))continue;
    const block=snapshots.get(key);if(!block)throw Error('runtime_lock_missing');wanted.add(key);
    for(const match of block.matchAll(/^      ([a-z0-9-]+): ([^\s]+)$/gm))queue.push(`${match[1]}@${match[2]}`);
    if(wanted.size>30)throw Error('runtime_lock_unexpected');
  }
  const packageKeys=[...new Set([...wanted].map(key=>key.split('(')[0]))].sort();
  const selected=packageKeys.map(key=>{const block=packages.get(key);if(!block)throw Error('runtime_lock_missing');return block;});
  return "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    dependencies:\n      pg:\n        specifier: 8.21.0\n        version: 8.21.0\n\npackages:\n\n"+selected.join('\n')+'\nsnapshots:\n\n'+[...wanted].sort().map(key=>snapshots.get(key)).join('\n');
}
async function approvedDirectory(directory, expectedRoot) {
  if (!path.isAbsolute(directory) || !/^backup-runtime-[a-zA-Z0-9-]+$/.test(path.basename(directory))) throw Error('runtime_path_invalid');
  const root = await validateOwnedRoot(path.dirname(directory), expectedRoot);
  if (path.resolve(directory)!==path.join(root,path.basename(directory))) throw Error('runtime_path_invalid');
  return root;
}
export async function stageOwnedRuntime({directory,sourceRoot,nodeExecutable=process.execPath,expectedRoot=OWNER_ROOT}) {
  await approvedDirectory(directory,expectedRoot);
  sourceRoot=await realpath(sourceRoot);
  const executable=await lstat(nodeExecutable);
  if(!executable.isFile()||executable.isSymbolicLink())throw Error('runtime_node_invalid');
  // No reuse/overwrite: an existing package remains intact, including partials.
  await mkdir(directory,{mode:0o700});
  for(const relative of sourceFiles) {
    const source=path.join(sourceRoot,relative),state=await lstat(source);
    if(!state.isFile()||state.isSymbolicLink())throw Error('runtime_source_invalid');
    const target=path.join(directory,relative);await mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await copyFile(source,target,constants.COPYFILE_EXCL);
  }
  await mkdir(path.join(directory,'bin'),{mode:0o700});
  await copyFile(nodeExecutable,path.join(directory,'bin/node.exe'),constants.COPYFILE_EXCL);
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name:'folio-owned-backup-runtime',version:'2026.9.8',private:true,type:'module',dependencies:{pg:'8.21.0'}},null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(path.join(directory,'pnpm-lock.yaml'),pgRuntimeLock(await readFile(path.join(sourceRoot,'pnpm-lock.yaml'),'utf8')),{flag:'wx',mode:0o600});
  return {directory,sourceFiles:sourceFiles.length,pgVersion:'8.21.0'};
}
async function inventory(directory) {
  if((await lstat(directory)).isSymbolicLink())throw Error('runtime_link_invalid');
  const found=[];
  async function visit(relative='') {
    for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){
      const file=relative?`${relative}/${entry.name}`:entry.name;
      if(entry.isSymbolicLink())throw Error('runtime_link_invalid');
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&!internalFiles.has(file))found.push({path:file,bytes:(await lstat(path.join(directory,file))).size,sha256:await fileDigest(path.join(directory,file))});
      else if(!entry.isFile())throw Error('runtime_file_invalid');
    }
  }
  await visit();return found.sort((a,b)=>a.path.localeCompare(b.path));
}
function launcher(manifestSha256) {
  return `# Generated from scripts/backup/package-owned-runtime.mjs. No task is registered.
[CmdletBinding()]
param([ValidateSet('Status','CatchUp')][string]$Mode='Status')
$ErrorActionPreference='Stop'
$runtimePreviousPath=$env:PATH
$runtimePreviousNodeOptions=$env:NODE_OPTIONS
$runtimePreviousNodePath=$env:NODE_PATH
$runtimePreviousModulePath=$env:PSModulePath
try {
  # A Node/Codex parent can inherit PowerShell Core's module search path while
  # launching Windows PowerShell. Only this host's bundled modules are needed.
  $env:PSModulePath=Join-Path $PSHOME 'Modules'
  $runtimeRoot=[IO.Path]::GetFullPath($PSScriptRoot)
  if ((Get-Item -LiteralPath $runtimeRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'runtime_invalid' }
  $runtimeManifestPath=Join-Path $runtimeRoot 'runtime-manifest.json'
  if ((Get-FileHash -LiteralPath $runtimeManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${manifestSha256}') { throw 'runtime_invalid' }
  $runtimeManifest=Get-Content -LiteralPath $runtimeManifestPath -Raw | ConvertFrom-Json
  $runtimeSeen=@{}
  foreach($runtimeEntry in $runtimeManifest.files) {
    if ($runtimeEntry.path -match '(^|[\\/])\\.\\.([\\/]|$)|:|^[\\/]' -or $runtimeSeen.ContainsKey($runtimeEntry.path)) { throw 'runtime_invalid' }
    $runtimeFile=[IO.Path]::GetFullPath((Join-Path $runtimeRoot $runtimeEntry.path))
    if (-not $runtimeFile.StartsWith($runtimeRoot+'\\',[StringComparison]::OrdinalIgnoreCase)) { throw 'runtime_invalid' }
    $runtimeState=Get-Item -LiteralPath $runtimeFile -Force
    if ($runtimeState.PSIsContainer -or ($runtimeState.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $runtimeState.Length -ne $runtimeEntry.bytes) { throw 'runtime_invalid' }
    if ((Get-FileHash -LiteralPath $runtimeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeEntry.sha256) { throw 'runtime_invalid' }
    $runtimeSeen[$runtimeEntry.path]=$true
  }
  $runtimeActual=@(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Force | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'runtime_invalid' }
    if (-not $_.PSIsContainer -and $_.FullName -ne $runtimeManifestPath -and $_.FullName -ne $PSCommandPath) { $_.FullName }
  })
  if ($runtimeActual.Count -ne $runtimeSeen.Count) { throw 'runtime_invalid' }
  $runtimeNode=Join-Path $runtimeRoot 'bin\\node.exe'
  if (-not (Test-Path -LiteralPath $runtimeNode -PathType Leaf)) { throw 'runtime_invalid' }
  $env:PATH=(Join-Path $runtimeRoot 'bin')+';'+$env:SystemRoot+'\\System32;'+$env:SystemRoot
  $env:NODE_OPTIONS=$null
  $env:NODE_PATH=$null
  & (Join-Path $runtimeRoot 'scripts\\backup\\owned-task.ps1') -Mode $Mode -RecoveryRoot $runtimeManifest.ownerRoot
  exit $LASTEXITCODE
} catch {
  @{status='runtime_integrity_failed';ownerCustodyPending=$true;restorationProven=$false;platformConfigurationComplete=$false} | ConvertTo-Json -Compress
  exit 12
} finally {
  $env:PATH=$runtimePreviousPath
  $env:NODE_OPTIONS=$runtimePreviousNodeOptions
  $env:NODE_PATH=$runtimePreviousNodePath
  $env:PSModulePath=$runtimePreviousModulePath
  $env:FOLIO_RECOVERY_PASSPHRASE=$null
}
`;
}
export async function sealOwnedRuntime(directory,{expectedRoot=OWNER_ROOT}={}) {
  const root=await approvedDirectory(directory,expectedRoot);
  const pkg=JSON.parse(await readFile(path.join(directory,'node_modules/pg/package.json'),'utf8'));
  if(pkg.version!=='8.21.0')throw Error('runtime_dependency_invalid');
  const files=await inventory(directory);
  for(const required of [...sourceFiles,'bin/node.exe','package.json','node_modules/pg/package.json'])if(!files.some(file=>file.path===required))throw Error('runtime_incomplete');
  const manifest={version:1,createdAt:new Date().toISOString(),ownerRoot:root,node:'bin/node.exe',pgVersion:'8.21.0',installation:'offline-ignore-scripts-copy-hoisted',platformConfigurationComplete:false,restorationProven:false,ownerCustodyPending:true,files};
  await writeFile(path.join(directory,'runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  const manifestSha256=await fileDigest(path.join(directory,'runtime-manifest.json'));
  await writeFile(path.join(directory,'invoke-owned-backup.ps1'),launcher(manifestSha256),{flag:'wx',mode:0o600});
  return {directory,manifestSha256,launcherSha256:await fileDigest(path.join(directory,'invoke-owned-backup.ps1')),files:files.length};
}
export async function verifyOwnedRuntime(directory,manifestSha256) {
  if(!/^[a-f0-9]{64}$/.test(manifestSha256)||await fileDigest(path.join(directory,'runtime-manifest.json'))!==manifestSha256)throw Error('runtime_manifest_changed');
  const manifest=JSON.parse(await readFile(path.join(directory,'runtime-manifest.json'),'utf8'));
  if(JSON.stringify(await inventory(directory))!==JSON.stringify(manifest.files))throw Error('runtime_files_changed');
  return {verified:true,files:manifest.files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [mode,directory,hash,...extra]=process.argv.slice(2);
    if(extra.length||!['stage','seal','verify'].includes(mode)||(mode==='verify'?!hash:hash!==undefined))throw Error('runtime_arguments_invalid');
    const result=mode==='stage'?await stageOwnedRuntime({directory,sourceRoot:fileURLToPath(new URL('../../',import.meta.url))}):mode==='seal'?await sealOwnedRuntime(directory):await verifyOwnedRuntime(directory,hash);
    console.log(JSON.stringify(result));
  } catch { console.error(JSON.stringify({status:'runtime_preparation_failed'}));process.exitCode=12; }
}

