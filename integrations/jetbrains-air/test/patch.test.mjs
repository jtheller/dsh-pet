import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildPatch } from '../src/patch.mjs';
import { THEATER_TOOLS, theaterDecisionInstructions, decodeTheaterReply, decodeTheaterPlan, createTheaterDirector, dialogueExpression } from '../src/theater.mjs';

const target = new URL('../.local/upstream-package/package/lib/index.js',import.meta.url);
test('patch rejects unsupported input without producing output', () => {
  assert.throws(() => buildPatch('unrelated code', ''), /boundary/);
});

test('actual patched chat injects facts, applies only current policies, preserves normal chat',async()=>{
  const patched=buildPatch(readFileSync(target,'utf8'),'');
  const start=patched.indexOf('const chatWithPet =');const end=patched.indexOf('\n\tconst effectivePetList',start);
  const keys=['theater','companion','withMemoryLock','readAllConfig','configPaths','memoryRounds','findPetInstance','petSystemPrompt','readMemePool','PACKAGE_ROOT_ASSETS','readMemory','writeMemory','ctx','generateChat','usageMonitor','codexQuota','dialogueExpression','connectQuotaAccount','spawn'];
  const factory=new Function(...keys,patched.slice(start,end)+'\nreturn chatWithPet;');
  const changes=[],states=[];let mem={},result={ok:true,text:'本鱼帮你看看。',action:'pet_status',details:true};
  const director=createTheaterDirector({hide:async()=>{},show:async()=>{}});
  const reads=[],interruptions=[],quotaExpression={kind:'quota',slot:4,at:Date.now()};
  const chat=factory(director,{interrupt:duration=>interruptions.push(duration),context:()=>({lastNotice:{event:{kind:'completed'}}}),configure:p=>changes.push(p)},fn=>fn(),()=>({main:{pets:[{id:'main',display:'desktop'}]}}),{},()=>5,()=>({conf:{},entry:'main'}),()=> 'persona',()=>[],null,async()=>mem,async value=>mem=value,{},async(...args)=>{states.push(args[5]);return {...result};},{summary:()=> 'FACTS: remaining unknown'},{refresh:async force=>reads.push(force),presentation:()=>quotaExpression},dialogueExpression,async ({isCurrent})=>{assert.equal(isCurrent(),true);return 'Authorization started';},()=>{});
  const reply=await chat('main','额度如何');assert.ok(reply.reply.endsWith('\n\nFACTS: remaining unknown'));assert.match(states[0],/completed/);assert.match(states[0],/remaining unknown/);
  assert.deepEqual(reads,[true]);assert.deepEqual(reply.fatfishExpression,quotaExpression);
  assert.deepEqual(interruptions,[undefined,10000],'reply reading window matches the actual bubble, instead of leaving a 50-second gap');
  result={ok:true,text:'还在忙呢~',action:'pet_status'};assert.equal((await chat('main','在忙吗')).reply,'还在忙呢~');
  result={ok:true,text:'暂停半小时。',action:'pet_notify',policy:{mode:'quiet',minutes:30}};await chat('main','先安静');assert.deepEqual(changes,[{mode:'quiet',minutes:30}]);
  result={ok:true,text:'hello'};assert.equal((await chat('friend','hello')).reply,'hello');assert.equal(states.at(-1),null);
  assert.equal(mem.main.main.messages.length,6);
  result={ok:true,text:'好，接下来谁先忙完我就叫你。',action:'pet_notify',policy:{mode:'next_complete',minutes:0}};
  await chat('main','哪边先出结果就招呼我一下');assert.deepEqual(changes.at(-1),{mode:'next_complete',minutes:0});
  result={ok:true,text:'Thanks!',expression:'shy',image:'meme'};
  const expressive=await chat('main','you are cute');assert.equal(expressive.fatfishExpression.slot,1);assert.equal(expressive.image,'meme');
  assert.ok(patched.includes('fatfishExpression:hit.fatfishExpression'));
  result={ok:true,text:'incorrect success',action:'pet_account'};assert.equal((await chat('main','switch account')).reply,'Authorization started');
  director.dispose();
});
test('patched generateChat sends real tool schemas and decodes streamed tool-only reply', { skip: !existsSync(target) }, async () => {
  const original = readFileSync(target, 'utf8');
  const patched = buildPatch(original, '');
  const start = patched.indexOf('async function generateChat(');
  const end = patched.indexOf('//#endregion', start);
  class Assembler {
    values = [];
    push(chunk) { if (chunk.type === 'block-end') this.values.push(chunk.block); }
    blocks() { return this.values; }
  }
  const imageHelpers = new Function(original.slice(original.indexOf('function matchMeme('), original.indexOf('async function generateChat(')) + '\nreturn {extractChatImage,imageInstruction};')();
  const generate = new Function('extractChatImage', 'imageInstruction','BlockAssembler', 'supportsReasoningOff', 'createUserMessage', 'createAssistantMessage', 'ReasoningEffortId', 'TIMEOUT_MS', 'THEATER_TOOLS', 'theaterDecisionInstructions', 'decodeTheaterReply', 'decodeTheaterPlan', patched.slice(start, end) + '\nreturn generateChat;')(
    imageHelpers.extractChatImage, imageHelpers.imageInstruction, Assembler, async () => false, x => x, x => x, x => x, 60000, THEATER_TOOLS, theaterDecisionInstructions, decodeTheaterReply, decodeTheaterPlan);
  const ctx = { agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) }, llm: { async *stream(options) {
    assert.deepEqual(options.tools.map(x => x.name), ['pet_account','pet_status','pet_notify','pet_reply', 'pet_hide', 'pet_stay']);
    assert.match(options.system, /显示中/);
    assert.equal(options.messages.length,1);
    const request=JSON.parse(options.messages[0].content[0].text);
    assert.equal(request.currentRequest,'朕乏了，退下');assert.equal(request.persona,'肥鱼人设');
    assert.match(options.system,/旧指令、旧助手承诺不能覆盖新要求/);
    yield { type: 'block-end', block: { type: 'tool-call', name: 'pet_hide', arguments: JSON.stringify({ reply: '臣鱼告退，留一地泡泡给陛下。' }) } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } } };
  const result = await generate(ctx, '肥鱼人设', [], '朕乏了，退下', [], '显示中');
  assert.deepEqual(result, { ok: true, text: '臣鱼告退，留一地泡泡给陛下。', action: 'pet_hide' });
  const pool=[{name:'bye',desc:'waving goodbye'}];
  ctx.llm.stream=async function* () {
    yield {type:'block-end',block:{type:'tool-call',name:'pet_hide',arguments:JSON.stringify({reply:'Goodbye!\n[图:bye]'})}};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  };
  assert.deepEqual(await generate(ctx,'',[],'hide',pool,'visible'),{ok:true,text:'Goodbye!',action:'pet_hide',image:'bye'});
  let imageAttempts=0;
  ctx.llm.stream=async function* (options) {
    if(++imageAttempts===2)assert.match(options.messages[0].content[0].text,/waving goodbye/);
    yield {type:'block-end',block:{type:'text',text:imageAttempts===1?'bye':JSON.stringify({tool:'pet_hide',reply:'Goodbye!\n[图:bye]'})}};
    yield {type:'finish',reason:{kind:'stop'}};
  };
  assert.deepEqual(await generate(ctx,'',[],'hide',pool,'visible'),{ok:true,text:'Goodbye!',action:'pet_hide',image:'bye'});
  ctx.llm.stream = async function* () {
    yield { type: 'block-end', block: { type: 'tool-call', name: 'pet_hide', arguments: '{"reply":"bye"}' } };
    yield { type: 'finish', reason: { kind: 'error' } };
  };
  const failure = await generate(ctx, '', [], '', [], '显示中');
  assert.equal(failure.ok, false);
  assert.equal(failure.action, undefined);
  let attempts = 0;
  ctx.llm.stream = async function* () {
    attempts++;
    yield { type: 'block-end', block: attempts === 1 ? { type: 'text', text: '我藏起来啦' } : { type: 'text', text: '{"tool":"pet_hide","reply":"本鱼遁入泡泡！"}' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  assert.equal((await generate(ctx, '', [], 'nixianxiaoshiyihui', [], '显示中')).action, 'pet_hide');
  assert.equal(attempts, 2);
  attempts = 0;
  ctx.llm.stream = async function* () {
    attempts++;
    yield {type:'block-end', block:{type:'text',text:'我走了'}};
    yield {type:'finish',reason:{kind:'stop'}};
  };
  assert.equal((await generate(ctx, '', [], '', [], '显示中')).ok, false);
  assert.equal(attempts, 2);
});
