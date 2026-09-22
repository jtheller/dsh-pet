import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// The upstream settings page saves a user overlay; a fresh overlay need not
// contain animations. Materialize only that missing field from pinned defaults.
export function readAnimationConfig(plugin,raw){
  const config=JSON.parse(raw);
  if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid pet configuration');
  if(config.animations===undefined){
    const jsonc=readFileSync(join(plugin,'assets/config.jsonc'),'utf8');
    const json=jsonc.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,part=>part.startsWith('"')?part:'');
    config.animations=JSON.parse(json).animations;
  }
  if(!config.animations?.events)throw Error('Invalid custom animation configuration; review it before applying presets');
  return config;
}
