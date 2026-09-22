import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEATER_TOOLS, decodeTheaterReply, decodeTheaterPlan, createTheaterDirector } from '../src/theater.mjs';
const call = (name, args = { reply: '遵旨，我卷起小披风退场啦。' }) => ({ type: 'tool-call', name, arguments: JSON.stringify(args) });
const finished = { kind: 'tool-calls' };
test('dedicated model plan is validated and normal promises are not executable', () => {
  const block = text => [{type:'text',text}];
  assert.equal(decodeTheaterPlan(block('{"tool":"pet_hide","reply":"本鱼先去幕后了"}'), {kind:'stop'}).action, 'pet_hide');
  for(const text of ['好啦我走了', '{"tool":"exec","reply":"x"}', '{"tool":"pet_hide","reply":"bye","command":"x"}']) assert.throws(() => decodeTheaterPlan(block(text), {kind:'stop'}));
});

test('model-written dialogue passes through and only real tools trigger actions', () => {
  assert.equal(THEATER_TOOLS.length, 5);
  assert.throws(() => decodeTheaterReply([{ type: 'text', text: '我先退下了' }], { kind: 'stop' }), /没有选择/);
  assert.deepEqual(decodeTheaterReply([call('pet_reply', {reply: '退下吧？那是你说的台词。'})], finished), { ok: true, text: '退下吧？那是你说的台词。' });
  assert.deepEqual(decodeTheaterReply([call('pet_hide')], finished), { ok: true, text: '遵旨，我卷起小披风退场啦。', action: 'pet_hide' });
  assert.equal(decodeTheaterReply([call('pet_stay', { reply: '板凳都给你焊住了！' })], finished).text, '板凳都给你焊住了！');
});
test('reject unknown tools, extra arguments, broken JSON, duplicate and unfinished calls', () => {
  for (const blocks of [[call('exec')], [call('pet_hide', { reply: 'bye', command: 'bad' })], [call('pet_hide', { reply: '' })], [call('pet_hide'), call('pet_stay')], [{ ...call('pet_hide'), arguments: '{' }]]) assert.throws(() => decodeTheaterReply(blocks, finished));
  for (const kind of ['max-tokens', 'error', 'aborted', undefined]) assert.throws(() => decodeTheaterReply([call('pet_hide')], { kind }));
});
test('hide is delayed, new interaction cancels it, stale result cannot hide, stay restores', async () => {
  const tasks = new Map(); const actions = []; let id = 0;
  const director = createTheaterDirector({ hide: async pet => actions.push('hide:' + pet), show: async pet => actions.push('show:' + pet), schedule: (fn, ms) => { assert.equal(ms, 5000); tasks.set(++id, fn); return id; }, cancel: key => tasks.delete(key) });
  const first = director.begin('main');
  await director.commit('main', first.epoch, 'pet_hide');
  assert.deepEqual(actions, []);
  const second = director.begin('main');
  assert.equal(second.wasPending, true);
  assert.equal(tasks.size, 0);
  await director.commit('main', first.epoch, 'pet_hide');
  assert.equal(tasks.size, 0);
  await director.commit('main', second.epoch, 'pet_stay');
  assert.deepEqual(actions, ['show:main']);
  await director.commit('main', second.epoch, 'pet_hide');
  await [...tasks.values()][0]();
  assert.deepEqual(actions, ['show:main', 'hide:main']);
  director.dispose();
});
