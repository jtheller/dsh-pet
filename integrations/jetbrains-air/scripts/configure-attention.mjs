import {readAnimationConfig} from './animation-config.mjs';
// Use the author's existing multi-animation waiting slot, preserving every other setting.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'profiles/web/node_modules/dsh-pet');
if(JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).version!=='0.2.11')throw Error('Review waiting animations for this upstream version before changing settings');
const path=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'dsh-pet/main-config.json');
const raw=readFileSync(path,'utf8'),config=readAnimationConfig(plugin,raw),slots=config.animations?.events?.workStatus;
if(!Array.isArray(slots)||slots.length!==6)throw Error('Expected existing six-slot work status configuration; no changes made');
// Distinct names are necessary: upstream classifies event animations before clicks.
// Reusing a click name here could make ordinary clicks loop the waiting slot.
const assets=join(plugin,'assets/webm');
const custom=join(process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh'),'dsh-pet/main-animation/webm');
const aliases=[['点击回应-傲娇生气','fatfish-attention-angry'],['点击回应-元气挥手','fatfish-attention-wave']];
const planned=aliases.map(([source,name])=>({target:join(custom,name+'.webm'),data:readFileSync(join(assets,source+'.webm'))}));
for(const p of planned)if(existsSync(p.target)&&!readFileSync(p.target).equals(p.data))throw Error('Custom attention asset differs; refusing to overwrite');
mkdirSync(custom,{recursive:true});for(const p of planned)if(!existsSync(p.target))writeFileSync(p.target,p.data);
const chosen=['fatfish-attention-angry','fatfish-attention-wave','工作状态-原地踱步张望'];
if(JSON.stringify(slots[3])===JSON.stringify(chosen)){console.log('Waiting animations already configured');}
else{
  mkdirSync(join(root,'.local'),{recursive:true});
  writeFileSync(join(root,'.local','before-attention-config-'+Date.now()+'.json'),raw);
  slots[3]=chosen;writeFileSync(path,JSON.stringify(config,null,2),'utf8');
  console.log('Updated only animations.events.workStatus[3]; restart DSH to apply');
}
