import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [sessionSource, myInfo, index] = await Promise.all([
  read('../assets/danjion-session.js'),
  read('../19_내정보_메인.html'),
  read('../index.html')
]);

assert.match(sessionSource, /function sendVerificationEmail\(fetchImpl, email, loc\)/);
assert.match(sessionSource, /'\/api\/auth\/send-verification-email'/);
assert.match(sessionSource, /emailVerificationCallbackURL/);
assert.match(sessionSource, /session\.raw\.user\?\.emailVerified === true/);
assert.match(sessionSource, /이메일 인증 필요/);
assert.match(sessionSource, /인증메일 다시 받기/);

assert.match(myInfo, /id="mi-email-row"/);
assert.match(myInfo, /id="mi-email-state"/);
assert.match(myInfo, /id="mi-email-resend"/);
assert.match(myInfo, /user&&user\.emailVerified===false/);
assert.match(myInfo, /이메일 인증 후 주민 상태 확인/);
assert.match(myInfo, /메일 제목 “\[단지온\] 이메일 주소를 확인해 주세요”/);

const unverifiedBlock = myInfo.match(/Promise\.all\(\[sessionIdentity\(\),resolveResidentExemption\(\)\]\)[\s\S]*?loadResidentState\(\);\n  \}\);/);
assert.ok(unverifiedBlock, 'startup gate must be present');
const text = unverifiedBlock[0];
const guardIndex = text.indexOf('user&&user.emailVerified===false');
const residentDataIndex = text.indexOf('loadResidentData()');
assert.ok(guardIndex >= 0 && residentDataIndex > guardIndex, 'email-unverified gate must precede resident traffic');

assert.match(index, /\[단지온\] 이메일 주소를 확인해 주세요/);
assert.match(index, /이메일 확인하기/);

const listeners = {};
const fakeMenuHost = {
  classList: { add(){} },
  textContent: '',
  contains(){ return false; },
  append(){}
};
function el(tag){
  return {
    tag,
    className:'',
    textContent:'',
    title:'',
    hidden:false,
    disabled:false,
    classList:{ add(){} },
    style:{},
    setAttribute(){},
    addEventListener(type,fn){ listeners[tag+':'+type]=fn; },
    append(){}
  };
}
const ctx = {
  URL, URLSearchParams, Headers, Request, Response,
  location:{hostname:'danjion.pages.dev',origin:'https://danjion.pages.dev',pathname:'/19_내정보_메인.html',search:'',href:'https://danjion.pages.dev/19_내정보_메인.html'},
  sessionStorage:{removeItem(){}},
  document:{
    readyState:'loading',
    addEventListener(){},
    querySelector(sel){ return sel==='.identity'?fakeMenuHost:null; },
    getElementById(){ return null; },
    createElement:el,
    head:{appendChild(){}}
  }
};
ctx.globalThis=ctx;ctx.window=ctx;
vm.runInNewContext(sessionSource,ctx);
assert.equal(typeof ctx.DanjionSession.sendVerificationEmail,'function');
assert.equal(decodeURI(ctx.DanjionSession.emailVerificationCallbackURL(ctx.location)),'https://danjion.pages.dev/19_내정보_메인.html?emailVerified=1');

console.log('leaf-email-verification-account-state-contract: PASS');
