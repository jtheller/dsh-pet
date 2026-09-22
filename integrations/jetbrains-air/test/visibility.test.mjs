import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPatch } from '../src/patch.mjs';
import { createVisibilityController } from '../src/visibility.mjs';
import { createTheaterDirector } from '../src/theater.mjs';

// Exercise the actual upstream save/reset handler with in-memory filesystem dependencies.
const original = readFileSync(new URL('../.local/upstream-package/package/lib/index.js',import.meta.url), 'utf8');
const patched = buildPatch(original, '');
const saveStart = original.indexOf('function saveUserConfig(');
const saveEnd = original.indexOf('\n}', saveStart) + 2;
const save = new Function('ID_FORBIDDEN', 'PET_DISPLAY_SET', 'CORNER_SET', original.slice(saveStart, saveEnd) + '; return saveUserConfig;')(
  /[\\/:\x00-\x1f]/, new Set(['desktop','web','both','none']), new Set(['top-left','top-right','bottom-left','bottom-right']));
const start = patched.indexOf('const handlePetRoute = async');
const end = patched.indexOf('\n\t\tif (rest === "config/meta")', start);
assert.ok(start > 0 && end > start);
const routeFactory = new Function('ROUTE_PREFIX', 'readAllConfig', 'configPaths', 'readFile', 'userConfigPath', 'saveUserConfig', 'mkdir', 'userRoot', 'writeFile', 'syncDesktop', 'rm', 'theater', patched.slice(start, end) + '\n}; return handlePetRoute;');

function harness(initial) {
  const pet = {id:'main',name:'肥鱼',size:462,balanceEnabled:false,display:'both',position:{corner:'bottom-right',marginX:24,marginY:48}};
  const defaults = {pets:[pet]};
  let stored = initial;
  let previous;
  let refreshes = 0;
  const tasks = new Map(); let counter = 0;
  let visibility;
  const director = createTheaterDirector({hide:id=>visibility(id,false),show:id=>visibility(id,true),schedule:fn=>{tasks.set(++counter,fn);return counter;},cancel:id=>tasks.delete(id)});
  const load = () => ({main: structuredClone({...defaults,...stored})});
  const route = routeFactory('/dsh-pet-7340',load,{},async()=>{if(!stored)throw Error('ENOENT');return JSON.stringify(stored);},'config',save,async()=>{},'root',async(_,text)=>{stored=JSON.parse(text);},()=>refreshes++,async()=>{stored=undefined;},director);
  visibility=createVisibilityController({route,remember:async value=>{previous=value;},recall:async()=>previous});
  return {route,visibility,director,tasks,load,getStored:()=>stored,getRefreshes:()=>refreshes};
}

test('upstream defaults work after reset; hide/show preserve display mode', async () => {
  const h=harness(undefined);
  await h.visibility('main',false);
  assert.equal(h.getStored().pets[0].display,'none');
  await h.visibility('main',true);
  assert.equal(h.getStored().pets[0].display,'both');
  assert.equal(h.getRefreshes(),2);
});
test('settings route preserves advanced config and other pets; manual save cancels queued departure',async()=>{
  const h=harness({physics:{gravity:123},animations:{idle:['custom']},whisperPrompt:'custom persona'});
  const settings=h.load().main;
  settings.pets.push({...settings.pets[0],id:'friend',display:'web'});
  assert.equal((await h.route('/dsh-pet-7340/config','PUT',JSON.stringify({pets:settings.pets}))).status,200);
  await h.visibility('main',false);
  assert.equal(h.getStored().physics.gravity,123);
  assert.deepEqual(h.getStored().animations,{idle:['custom']});
  assert.equal(h.getStored().whisperPrompt,'custom persona');
  assert.equal(h.getStored().pets[1].display,'web');
  await h.visibility('main',true);
  const ticket=h.director.begin('main');
  await h.director.commit('main',ticket.epoch,'pet_hide');
  assert.equal(h.tasks.size,1);
  const update=h.load().main.pets; update[0].size=520;
  await h.route('/dsh-pet-7340/config','PUT',JSON.stringify({pets:update}));
  assert.equal(h.tasks.size,0);
  await h.director.commit('main',ticket.epoch,'pet_hide');
  assert.equal(h.tasks.size,0);
  assert.equal(h.getStored().pets[0].size,520);
});
test('upstream reset invalidates in-flight model result; bad saves and missing pets fail',async()=>{
  const h=harness(undefined);
  const ticket=h.director.begin('main');
  await h.route('/dsh-pet-7340/config','DELETE');
  await h.director.commit('main',ticket.epoch,'pet_hide');
  assert.equal(h.tasks.size,0);
  assert.equal((await h.route('/dsh-pet-7340/config','PUT','{"pets":[]}')).status,400);
  await assert.rejects(h.visibility('missing',false),/no longer exists/);
});
