import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {patchTouchAsset,TOUCH_MARKER} from '../src/touch-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const stateDir=join(root,'.local/touch');mkdirSync(stateDir,{recursive:true});
const home=process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh');
const pkg=join(home,'profiles/web/node_modules/dsh-pet');
const names=['lib/client.js','runtime/electron-helper/renderer.js','runtime/electron-helper/preload.js','runtime/electron-helper/main.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite.js','runtime/electron-helper/events.js'];
const statePath=join(stateDir,'installation.json');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
const hash=text=>createHash('sha256').update(text).digest('hex');
if(process.argv.includes('--status')){
  console.log(JSON.stringify(names.map(name=>{const text=readFileSync(join(pkg,name),'utf8');return {file:name,installed:text.includes(TOUCH_MARKER),matchesInstalledHash:state[name]?.installedHash===hash(text)};}),null,2));process.exit(0);
}
if(JSON.parse(readFileSync(join(pkg,'package.json'),'utf8')).version!=='0.2.11')throw new Error('Review touch adapter for new upstream version');
const runtime=readFileSync(join(root,'src/touch.mjs'),'utf8');
const undo=process.argv.includes('--undo');
const planned=names.map((name,index)=>{
  const target=join(pkg,name),current=readFileSync(target,'utf8');
  let clean=current;
  if(!state[name]&&!undo){
    const released=join(root,'.local/upstream-package/package',name);
    if(!existsSync(released)||hash(readFileSync(released,'utf8'))!==hash(current))throw Error('Untracked UI differs from clean release: '+name);
  }
  if(current.includes(TOUCH_MARKER) || undo){
    if(!state[name] || state[name].target!==target || state[name].installedHash!==hash(current))throw new Error('UI changed externally; refusing overwrite: '+name);
    clean=readFileSync(join(stateDir,state[name].cleanFile),'utf8');
    if(hash(clean)!==state[name].cleanHash)throw new Error('Touch backup checksum mismatch');
  }
  const next=undo?clean:patchTouchAsset(name,clean,runtime);
  const candidate=join(stateDir,'candidate-'+index+(name.endsWith('client.js')?'.mjs':'.cjs'));
  writeFileSync(candidate,next);
  const check=spawnSync(process.execPath,['--check',candidate],{encoding:'utf8'});
  if(check.status!==0)throw new Error(check.stderr);
  return {name,target,current,clean,next};
});
const nextState={};
for(const p of planned){
  const cleanFile='upstream-'+hash(p.clean)+'.js';writeFileSync(join(stateDir,cleanFile),p.clean);
  writeFileSync(join(stateDir,'before-'+hash(p.current)+'.js'),p.current);
  nextState[p.name]={target:p.target,cleanFile,cleanHash:hash(p.clean),installedHash:hash(p.next)};
}
try{
  for(const p of planned){const temp=p.target+'.fatfish-touch-new';writeFileSync(temp,p.next);renameSync(temp,p.target);}
  writeFileSync(statePath,JSON.stringify(nextState,null,2));
}catch(error){for(const p of planned)writeFileSync(p.target,p.current);throw error;}
console.log(undo?'Touch UI restored to upstream. Restart DSH and reload browser.':'Touch UI installed. Restart DSH and reload browser.');
