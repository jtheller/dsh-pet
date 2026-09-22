import {readAnimationConfig} from './animation-config.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const DIALOGUE_ALIASES=[
  ['点击回应-开心跃动','fatfish-dialogue-happy'],
  ['点击回应-害羞惊讶','fatfish-dialogue-shy'],
  ['点击回应-傲娇生气','fatfish-dialogue-angry'],
  ['点击回应-元气挥手','fatfish-dialogue-wave'],
  ['超大伸懒腰','fatfish-dialogue-relaxed'],
  ['女仆屈膝礼仪','fatfish-dialogue-bow'],
];
function configure(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const plugin=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'profiles/web/node_modules/dsh-pet');
  if(JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).version!=='0.2.11')throw Error('Review dialogue animations for new upstream version');
  const data=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'dsh-pet'),path=join(data,'main-config.json');
  const raw=readFileSync(path,'utf8'),config=readAnimationConfig(plugin,raw),events=config.animations?.events;
  if(!events)throw Error('Missing configured events');
  const pool=DIALOGUE_ALIASES.map(([,name])=>name);
  if(events.fatfishDialogue&&JSON.stringify(events.fatfishDialogue)!==JSON.stringify(pool))throw Error('Dialogue pool changed externally');
  const planned=DIALOGUE_ALIASES.map(([source,name])=>({target:join(data,'main-animation/webm',name+'.webm'),bytes:readFileSync(join(plugin,'assets/webm',source+'.webm'))}));
  for(const p of planned)if(existsSync(p.target)&&!readFileSync(p.target).equals(p.bytes))throw Error('Dialogue alias contains different content');
  if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed; retry');
  mkdirSync(join(data,'main-animation/webm'),{recursive:true});
  for(const p of planned)if(!existsSync(p.target))writeFileSync(p.target,p.bytes,{flag:'wx'});
  if(events.fatfishDialogue){console.log('Dialogue animation pool already configured');return;}
  mkdirSync(join(root,'.local'),{recursive:true});
  writeFileSync(join(root,'.local','before-dialogue-config-'+Date.now()+'.json'),raw);
  events.fatfishDialogue=pool;
  const temporary=path+'.fatfish-dialogue-new';writeFileSync(temporary,JSON.stringify(config,null,2),'utf8');
  if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed before save');
  renameSync(temporary,path);
  console.log('Configured only animations.events.fatfishDialogue with six original-clip aliases. Restart DSH.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))configure();
