import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FATFISH_PERSONA} from '../src/persona.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const home=process.env.DSH_HOME || join(process.env.USERPROFILE,'.dsh');
const path=join(home,'dsh-pet/main-config.json');
const stateDir=join(root,'.local'),statePath=join(stateDir,'persona-installation.json');
const raw=readFileSync(path,'utf8'),config=JSON.parse(raw);
if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid pet configuration');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):null;
const undo=process.argv.includes('--undo');
if(state&&(state.target!==path||config.whisperPrompt!==state.installedPrompt))throw Error('Persona changed externally; refusing overwrite');
if(undo){
  if(!state)throw Error('No persona installation record to restore');
  if(state.hadPrompt)config.whisperPrompt=state.previousPrompt;
  else delete config.whisperPrompt;
}else{
  if(config.whisperPrompt===FATFISH_PERSONA){console.log('Fatfish persona already configured.');process.exit(0);}
  mkdirSync(stateDir,{recursive:true});
  if(!state){
    writeFileSync(join(stateDir,'before-persona-config-'+Date.now()+'.json'),raw,{flag:'wx'});
    writeFileSync(statePath,JSON.stringify({target:path,hadPrompt:Object.hasOwn(config,'whisperPrompt'),previousPrompt:config.whisperPrompt,installedPrompt:FATFISH_PERSONA},null,2),{flag:'wx'});
  }
  config.whisperPrompt=FATFISH_PERSONA;
}
if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed; retry');
const temporary=path+'.fatfish-persona-new';
writeFileSync(temporary,JSON.stringify(config,null,2),'utf8');
if(readFileSync(path,'utf8')!==raw)throw Error('Settings changed before save');
renameSync(temporary,path);
if(undo)unlinkSync(statePath);
console.log(undo?'Restored previous persona; other settings preserved.':'Configured Fatfish persona for dialogue, whispers and Air reminders.');
