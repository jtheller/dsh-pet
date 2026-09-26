import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {connectQuotaAccount,decodeTheaterPlan} from '../src/theater.mjs';

test('account action supports JSON fallback and rejects model supplied URLs',()=>{
  const decode=p=>decodeTheaterPlan([{type:'text',text:JSON.stringify(p)}],{kind:'stop'});
  assert.equal(decode({tool:'pet_account',reply:'开始授权'}).action,'pet_account');
  assert.throws(()=>decode({tool:'pet_account',reply:'开始',url:'https://example.com'}));
});
test('authorization opens only validated URL and reports actual launch outcome',async()=>{
  let opened=0;
  const options={isCurrent:()=>true,login:async()=>({authUrl:'https://auth.openai.com/authorize?x=1&y=2'}),spawn:(exe,args,opts)=>{
    opened++;assert.equal(exe,'powershell.exe');assert.equal(opts.windowsHide,true);
    assert.equal(opts.env.FATFISH_AUTH_URL,'https://auth.openai.com/authorize?x=1&y=2');
    const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;
  }};
  assert.match(await connectQuotaAccount(options),/已请求浏览器/);assert.equal(opened,1);
  assert.match(await connectQuotaAccount({...options,isCurrent:()=>false}),/取消/);assert.equal(opened,1);
  assert.match(await connectQuotaAccount({...options,login:async()=>({authUrl:'https://evil.example/'})}),/没能打开/);assert.equal(opened,1);
  assert.match(await connectQuotaAccount({...options,spawn:()=>{throw Error('failed');}}),/没能打开/);
  let current=true;
  assert.match(await connectQuotaAccount({...options,isCurrent:()=>current,login:async()=>{current=false;return {authUrl:'https://auth.openai.com/'};}}),/取消/);
  assert.equal(opened,1);
});
