import {readFileSync,existsSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Read-only audit of the fixed release. Never update the clone or installed files.
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const checkout=join(root,'.local/upstream-0.2.11');
const upstream=join(checkout,'dsh-pet');
const installed=join(process.env.DSH_HOME||join(process.env.USERPROFILE,'.dsh'),'profiles/web/node_modules/dsh-pet');
const revision='8f57010f4517d06c0d9ae4efb60cdbd7abde21c3';
const git=(...args)=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8',windowsHide:true}).trim();
if(!existsSync(upstream))throw new Error('Missing audit checkout: clone PC2005-cloud/dsh-pet tag v0.2.11 into .local/upstream-0.2.11; this command never downloads code.');
if(git('rev-parse','HEAD')!==revision||git('status','--porcelain'))throw new Error('Upstream checkout must be the clean pinned v0.2.11 commit.');
if(JSON.parse(readFileSync(join(installed,'package.json'),'utf8')).version!=='0.2.11')throw new Error('Unsupported installed version.');
const touch=JSON.parse(readFileSync(join(root,'.local/touch/installation.json'),'utf8'));
const host=JSON.parse(readFileSync(join(root,'.local/installation.json'),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const release=join(root,'.local/upstream-package/package');
if(!existsSync(release))throw new Error('Missing npm release: npm pack dsh-pet@0.2.11 --ignore-scripts, then extract into .local/upstream-package.');
const releaseFiles=[];
const walk=(dir,prefix='')=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())walk(join(dir,entry.name),relative+'/');else releaseFiles.push(relative);}};
walk(release);
for(const file of releaseFiles){
  const candidate=file==='lib/index.js'?join(root,'.local',host.cleanFile):touch[file]?join(root,'.local/touch',touch[file].cleanFile):join(installed,file);
  if(!existsSync(candidate)||hash(readFileSync(candidate))!==hash(readFileSync(join(release,file))))throw new Error('Published release mismatch: '+file);
}
console.log(`Published release: ${releaseFiles.length} files match byte-for-byte (the ${1+Object.keys(touch).length} patches use verified clean backups).`);
for(const [state,dir] of [[host,'.local'],...Object.values(touch).map(s=>[s,'.local/touch'])]){
  if(hash(readFileSync(join(root,dir,state.cleanFile)))!==state.cleanHash)throw new Error('Clean backup checksum mismatch.');
  if(hash(readFileSync(state.target))!==state.installedHash)throw new Error('Installed file differs from recorded patch.');
}
const files=git('ls-files','-z').split('\0').filter(Boolean);
const report={revision,version:'0.2.11',releaseFiles:releaseFiles.length,matched:[],missing:[],different:[],repositoryOnly:[],patches:['lib/index.js',...Object.keys(touch)]};
for(const file of files){
  if(!file.startsWith('dsh-pet/')){report.repositoryOnly.push(file);continue;}
  const relative=file.slice('dsh-pet/'.length);
  const candidate=touch[relative]?join(root,'.local/touch',touch[relative].cleanFile):join(installed,relative);
  if(!existsSync(candidate)){report.missing.push(relative);continue;}
  // Git on Windows may check text out with CRLF; binary assets stay byte exact.
  const bytes=path=>{const data=readFileSync(path);return /\.(?:[cm]?[jt]s|jsonc?|md|html|css|ya?ml|gitattributes|gitignore)$/.test(path)?Buffer.from(data.toString('utf8').replaceAll('\r\n','\n')):data;};
  (bytes(join(checkout,file)).equals(bytes(candidate))?report.matched:report.different).push(relative);
}
mkdirSync(join(root,'.local'),{recursive:true});
writeFileSync(join(root,'.local/upstream-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({revision,matched:report.matched.length,notPublished:report.missing.length,different:report.different,patches:report.patches},null,2));
if(report.different.length||report.missing.some(p=>p.startsWith('src/')||p.startsWith('runtime/')))throw new Error('Unexpected source/runtime divergence.');
if(process.argv.includes('--test')){
  const loader=join(root,'.local/audit-dependencies.mjs'),register=join(root,'.local/audit-register.mjs');
  writeFileSync(loader,`import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const require=createRequire(${JSON.stringify(join(installed,'package.json'))});export async function resolve(s,c,next){try{return await next(s,c)}catch(e){if(s.startsWith('.')||s.startsWith('/')||s.includes(':'))throw e;return {url:pathToFileURL(require.resolve(s)).href,shortCircuit:true}}}\n`);
  writeFileSync(register,"import {register} from 'node:module';register('./audit-dependencies.mjs',import.meta.url);\n");
  const tests=files.filter(p=>p.startsWith('dsh-pet/src/')&&p.endsWith('.test.ts')).map(p=>join(checkout,p));
  const result=spawnSync(process.execPath,['--experimental-strip-types','--import',pathToFileURL(join(upstream,'scripts/test-register.mjs')).href,'--import',pathToFileURL(register).href,'--test',...tests],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
  writeFileSync(join(root,'.local/upstream-tests.log'),(result.stdout||'')+(result.stderr||''));
  console.log((result.stdout||'').split('\n').slice(-10).join('\n'));
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Upstream tests failed; see .local/upstream-tests.log.');
}
