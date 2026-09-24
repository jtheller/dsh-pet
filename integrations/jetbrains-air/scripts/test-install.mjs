import './prepare-upstream.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {FATFISH_PERSONA} from '../src/persona.mjs';
import {buildPatch} from '../src/patch.mjs';
import {patchTouchAsset} from '../src/touch-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const release=join(root,'.local/upstream-package/package');
const sandbox=mkdtempSync(join(tmpdir(),'fatfish-air-install-'));
try{
  const extension=join(sandbox,'extension'),home=join(sandbox,'dsh'),target=join(home,'profiles/web/node_modules/dsh-pet');
  for(const dir of ['src','scripts'])cpSync(join(root,dir),join(extension,dir),{recursive:true});
  cpSync(release,join(extension,'.local/upstream-package/package'),{recursive:true});
  cpSync(release,target,{recursive:true});
  const run=(script,args=[],ok=true)=>{
    const r=spawnSync(process.execPath,[join(extension,'scripts',script),...args],{env:{...process.env,DSH_HOME:home},encoding:'utf8',windowsHide:true});
    if(r.error)throw r.error;
    if(ok)assert.equal(r.status,0,r.stdout+r.stderr);else assert.notEqual(r.status,0,'Expected installer to reject an unknown edit');
    return r;
  };
  const host=join(target,'lib/index.js'),cleanHost=readFileSync(host,'utf8');
  writeFileSync(host,cleanHost+'\n// unknown edit\n');run('install.mjs',[],false);
  assert.ok(readFileSync(host,'utf8').endsWith('// unknown edit\n'));writeFileSync(host,cleanHost);
  run('install.mjs');run('install-touch.mjs');
  const names=['lib/index.js','lib/client.js',...['renderer','preload','main','shared-core','sprite','events'].map(n=>'runtime/electron-helper/'+n+'.js')];
  const runtime=['theater.mjs','visibility.mjs','usage-monitor.mjs','companion.mjs','attention.mjs','codex-quota.mjs'].map(n=>readFileSync(join(root,'src',n),'utf8')).join('\n');
  const touch=readFileSync(join(root,'src/touch.mjs'),'utf8');
  const first=new Map();
  for(const name of names){const actual=readFileSync(join(target,name),'utf8'),original=readFileSync(join(release,name),'utf8');assert.equal(actual,name==='lib/index.js'?buildPatch(original,runtime):patchTouchAsset(name,original,touch));first.set(name,actual);}
  run('install.mjs');run('install-touch.mjs');
  for(const [name,bytes] of first)assert.equal(readFileSync(join(target,name),'utf8'),bytes,'Repeated install changed '+name);
  assert.equal(JSON.parse(run('install.mjs',['--status']).stdout).matchesInstalledHash,true);
  assert.ok(JSON.parse(run('install-touch.mjs',['--status']).stdout).every(s=>s.matchesInstalledHash));
  const native=join(target,'runtime/electron-helper/main.js');writeFileSync(native,first.get('runtime/electron-helper/main.js')+'\n// external edit');
  run('install-touch.mjs',[],false);
  for(const [name,bytes] of first)if(!name.endsWith('/main.js'))assert.equal(readFileSync(join(target,name),'utf8'),bytes);
  writeFileSync(native,first.get('runtime/electron-helper/main.js'));
  const config=join(home,'dsh-pet/main-config.json');mkdirSync(join(home,'dsh-pet'),{recursive:true});
  writeFileSync(config,JSON.stringify({sentinel:'keep',pets:[{id:'main',display:'desktop'}]}));
  for(const script of ['configure-work-animations.mjs','configure-attention.mjs','configure-dialogue-animations.mjs'])run(script);
  const configured=readFileSync(config,'utf8');assert.equal(JSON.parse(configured).sentinel,'keep');assert.deepEqual(JSON.parse(configured).pets,[{id:'main',display:'desktop'}]);assert.ok(JSON.parse(configured).animations.idle);
  for(const script of ['configure-work-animations.mjs','configure-attention.mjs','configure-dialogue-animations.mjs'])run(script);
  assert.equal(readFileSync(config,'utf8'),configured);
  // Persona setup preserves unrelated fields and restores absence or a custom prompt.
  for(const previous of [undefined,'自定义旧人设']){
    const before={...JSON.parse(configured),...(previous===undefined?{}:{whisperPrompt:previous})};
    writeFileSync(config,JSON.stringify(before));
    run('configure-persona.mjs');
    const applied=readFileSync(config,'utf8');
    assert.deepEqual(JSON.parse(applied),{...before,whisperPrompt:FATFISH_PERSONA});
    run('configure-persona.mjs');assert.equal(readFileSync(config,'utf8'),applied);
    writeFileSync(config,JSON.stringify({...JSON.parse(applied),sentinel:'later setting',whisperPrompt:'later persona'}));
    const edited=readFileSync(config,'utf8');
    run('configure-persona.mjs',[],false);run('configure-persona.mjs',['--undo'],false);
    assert.equal(readFileSync(config,'utf8'),edited);
    writeFileSync(config,JSON.stringify({...JSON.parse(applied),sentinel:'later setting'}));
    run('configure-persona.mjs',['--undo']);
    assert.deepEqual(JSON.parse(readFileSync(config,'utf8')),{...before,sentinel:'later setting'});
  }
  run('install-touch.mjs',['--undo']);run('install.mjs',['--undo']);
  for(const name of names)assert.deepEqual(readFileSync(join(target,name)),readFileSync(join(release,name)),'Uninstall did not restore '+name);
  console.log('PASS: clean install, eight expected patches, repeat install, status, external-edit rejection, animation/persona setup, field-only persona restoration and byte-exact uninstall in isolated DSH_HOME.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
