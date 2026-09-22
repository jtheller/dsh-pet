import {readAnimationConfig} from './animation-config.mjs';
// Author-provided clips in the original multi-candidate working slot.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const WORKING_ALIASES=[
  ['写代码','fatfish-working-code'],
  ['轻快记录','fatfish-working-notes'],
  ['吃Token','fatfish-working-tokens'],
];
export const WORKING_POOL=['工作状态-忙碌点按',...WORKING_ALIASES.map(([,name])=>name)];

function configure(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const plugin=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'profiles/web/node_modules/dsh-pet');
  if(JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).version!=='0.2.11')throw Error('Review work animations against the installed upstream version');
  const data=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'dsh-pet'),path=join(data,'main-config.json');
  const raw=readFileSync(path,'utf8'),config=readAnimationConfig(plugin,raw),slots=config.animations?.events?.workStatus;
  if(!Array.isArray(slots)||slots.length!==6)throw Error('Expected six work status slots');
  const planned=WORKING_ALIASES.map(([source,name])=>({target:join(data,'main-animation/webm',name+'.webm'),bytes:readFileSync(join(plugin,'assets/webm',source+'.webm'))}));
  // Separate event names keep the original random/category animations independent.
  for(const p of planned)if(existsSync(p.target)&&!readFileSync(p.target).equals(p.bytes))throw Error('Working alias already exists with different content');
  if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed during preparation; retry');
  mkdirSync(join(data,'main-animation/webm'),{recursive:true});
  for(const p of planned)if(!existsSync(p.target))writeFileSync(p.target,p.bytes,{flag:'wx'});
  if(JSON.stringify(slots[1])===JSON.stringify(WORKING_POOL)){console.log('Working animation pool already configured');return;}
  mkdirSync(join(root,'.local'),{recursive:true});
  writeFileSync(join(root,'.local','before-working-config-'+Date.now()+'.json'),raw);
  slots[1]=WORKING_POOL;
  const next=JSON.stringify(config,null,2),temporary=path+'.fatfish-working-new';
  writeFileSync(temporary,next,'utf8');
  if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed before save; refusing overwrite');
  renameSync(temporary,path);
  console.log('Updated only animations.events.workStatus[1]: '+WORKING_POOL.join(', ')+'. Restart DSH to apply.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))configure();
