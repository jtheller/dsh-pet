import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Fixed published bytes, independent of the user's installed plugin or mutable tags.
export const UPSTREAM_VERSION='0.2.11';
export const UPSTREAM_INTEGRITY='sha512-LliglXlKtl7hMVOUp2ZXRcdYOHqOYiOCTm7vuqABj/GZiCQcFfwqgBiZ4SqhXpKcEg53C5acx8UaF46jxslWMA==';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=join(root,'.local');
const archive=join(cache,'dsh-pet-0.2.11.tgz');
const release=join(cache,'upstream-package');
mkdirSync(cache,{recursive:true});
if(!existsSync(archive)){
  console.log('Downloading the pinned dsh-pet 0.2.11 package (includes original animation assets)...');
  const response=await fetch('https://registry.npmjs.org/dsh-pet/-/dsh-pet-0.2.11.tgz',{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('Upstream download failed: HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if('sha512-'+createHash('sha512').update(bytes).digest('base64')!==UPSTREAM_INTEGRITY)throw Error('Upstream archive integrity mismatch');
  writeFileSync(archive+'.part',bytes);renameSync(archive+'.part',archive);
}
if('sha512-'+createHash('sha512').update(readFileSync(archive)).digest('base64')!==UPSTREAM_INTEGRITY)throw Error('Cached upstream archive integrity mismatch; remove this cache archive and retry');
// Always extract verified bytes anew; no machine-local backup is trusted as a fixture.
const staging=mkdtempSync(join(cache,'upstream-extract-'));
try{
  execFileSync('tar',['-xzf',archive,'-C',staging],{windowsHide:true});
  if(JSON.parse(readFileSync(join(staging,'package/package.json'),'utf8')).version!==UPSTREAM_VERSION)throw Error('Unexpected upstream version');
  if(existsSync(release))rmSync(release,{recursive:true});
  renameSync(staging,release);
}finally{if(existsSync(staging))rmSync(staging,{recursive:true});}
console.log('Verified dsh-pet '+UPSTREAM_VERSION+' prepared. No installed files changed.');
