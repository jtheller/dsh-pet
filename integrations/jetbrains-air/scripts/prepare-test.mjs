import './prepare-upstream.mjs';
import {cpSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {patchTouchAsset} from '../src/touch-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const release=join(root,'.local/upstream-package/package');
const runtime=readFileSync(join(root,'src/touch.mjs'),'utf8');
const fixture=join(root,'.local/test-runtime');
mkdirSync(fixture,{recursive:true});
cpSync(join(release,'runtime'),join(fixture,'runtime'),{recursive:true});
for(const name of ['lib/client.js','runtime/electron-helper/renderer.js','runtime/electron-helper/preload.js','runtime/electron-helper/main.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite.js','runtime/electron-helper/events.js']){
  const target=join(fixture,name);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,patchTouchAsset(name,readFileSync(join(release,name),'utf8'),runtime));
}
console.log('Isolated browser fixtures prepared; no DSH installation or credentials read.');
