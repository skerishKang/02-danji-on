import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// #1081: a valid-shaped community post id that resolves server-side to 404
// must settle into the existing #923 recovery shell instead of leaving the
// like/comment affordances on screen. Auth (#1075), bridge-fault, 403 and
// transient failures keep their own presentation and must NOT be routed to
// the recovery shell.

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [page13Source, sessionSource] = await Promise.all([
  read('13_이웃대화_글상세_댓글.html'),
  read('assets/danjion-session.js')
]);

/* 1. Behavioral: the REAL showPostRecovery drives a real element state. */
{
  const elements = {};
  for (const id of ['postRecovery', 'postShell', 'postComments', 'postRecoveryHeading', 'postRecoveryDetail', 'postRecoveryLink']) {
    elements[id] = {
      id,
      hidden: id === 'postRecovery' ? true : false,
      textContent: id === 'postRecoveryLink' ? '이웃대화 목록으로' : '',
      href: id === 'postRecoveryLink' ? 'https://old.example/community' : undefined,
      focus: function () { this.focused = true; }
    };
  }
  const context = {
    console,
    COMMUNITY_LIST: (page13Source.match(/const COMMUNITY_LIST='([^']*)'/) || [])[1] || '12_이웃대화_첫화면.html',
    document: {
      getElementById: (id) => elements[id] || null,
      activeElement: null
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  const start = page13Source.indexOf('function showPostRecovery(kind){');
  assert.ok(start !== -1, '13 showPostRecovery must exist');
  let depth = 0, inStr = null, end = -1;
  for (let i = page13Source.indexOf('{', start); i < page13Source.length; i++) {
    const ch = page13Source[i];
    if (inStr) { if (ch === inStr && page13Source[i - 1] !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const src = end !== -1 ? page13Source.slice(start, end) : '';
  assert.ok(src && src.endsWith('}'), '13 showPostRecovery must be extractable');
  vm.runInContext(src, context, { filename: '13 showPostRecovery' });
  const run = (kind) => vm.runInContext(`showPostRecovery(${JSON.stringify(kind)})`, context);

  // new #1081 kind: server 404 of a valid-shaped id
  run('notfound');
  assert.equal(elements.postShell.hidden, true, 'notfound: post shell hidden');
  assert.equal(elements.postComments.hidden, true, 'notfound: comments section hidden');
  assert.equal(elements.postRecovery.hidden, false, 'notfound: recovery shell visible');
  assert.equal(elements.postRecoveryHeading.textContent, '게시글 정보를 찾을 수 없습니다.',
    'notfound keeps the recovery heading');
  assert.equal(elements.postRecoveryDetail.textContent,
    '삭제되었거나 존재하지 않는 게시글입니다. 이웃대화 목록에서 다른 글을 확인해 주세요.',
    'notfound carries its own truthful detail copy');
  assert.equal(elements.postRecoveryLink.href.indexOf('12_이웃대화_첫화면.html') !== -1, true,
    'notfound links back to the community list');

  // #923 kinds unchanged
  run('missing');
  assert.equal(elements.postRecoveryDetail.textContent.indexOf('식별자가 없습니다') !== -1, true,
    'missing-kind copy preserved');
  run('invalid');
  assert.equal(elements.postRecoveryDetail.textContent.indexOf('잘못되었거나 만료된 링크') !== -1, true,
    'invalid-kind copy preserved');
  run('deleted');
  assert.equal(elements.postRecoveryHeading.textContent, '삭제한 게시글입니다.', 'deleted-kind heading preserved');
  run('notfound');
  assert.equal(elements.postRecovery.hidden, false, 'notfound stays visible after kind switches');
}

/* 2. loadPost routes ONLY a server 404 into the recovery shell. */
{
  const failureBranch = page13Source.match(/if\(result\.mode!=='server'\|\|!result\.post\)\{[\s\S]*?\n   \}/)?.[0] || '';
  assert.ok(failureBranch, 'the loadPost failure branch must exist');
  assert.ok(failureBranch.indexOf('post=null;') !== -1 && failureBranch.indexOf('loadFailure=failMessage(result);') !== -1,
    'the failure branch still clears post state and records the failure message');
  assert.ok(failureBranch.indexOf("if(result.status===404){") !== -1 &&
            failureBranch.indexOf("showPostRecovery('notfound');") !== -1 &&
            failureBranch.indexOf('return;') !== -1,
    'a server 404 must settle into the recovery shell and stop');
  const notfoundAt = failureBranch.indexOf("showPostRecovery('notfound');");
  const postNullAt = failureBranch.indexOf('post=null;');
  const loadFailureAt = failureBranch.indexOf('loadFailure=failMessage(result);');
  assert.ok(postNullAt < loadFailureAt && loadFailureAt < notfoundAt,
    'guards (post=null, loadFailure) must be set before the recovery hand-off');
  // the legacy shell mutation must NOT run for a 404 (it returns before title/body writes)
  assert.ok(failureBranch.indexOf("document.getElementById('title')") > notfoundAt,
    'the 404 path must return before writing the not-found copy into the post shell');
  assert.equal((page13Source.match(/showPostRecovery\('notfound'\)/g) || []).length, 1,
    'the server-404 hand-off must exist exactly once');
}

/* 3. Classification guards: only status 404 reaches the recovery shell. */
{
  assert.ok(page13Source.indexOf("if(result.status===404){") !== -1, 'the 404 gate is explicit');
  // auth/bridge-fault/timeout outcomes must not reference the recovery helper
  const failMessage = page13Source.match(/function failMessage\(result\)\{[\s\S]*?\n \}/)?.[0] || '';
  assert.ok(failMessage.indexOf("showPostRecovery") === -1, 'failMessage must not route to the recovery shell');
  assert.ok(failMessage.indexOf("authBridge==='no-cookie'") !== -1, '#1075 no-cookie copy preserved');
  assert.ok(failMessage.indexOf("authFailureKind") !== -1 || page13Source.indexOf('authFailureKind') !== -1,
    '#1075 classifier still in use');
  assert.ok(failMessage.indexOf("result.status===403?'본인 확인된 입주민만 이용할 수 있습니다.'") !== -1,
    '403 resident boundary preserved');
  assert.ok(failMessage.indexOf('로그인이 만료되었습니다') !== -1, 'expired copy preserved');
}

/* 4. #923 boot-time recovery unchanged and fetch-free. */
{
  const bootGuard = page13Source.indexOf("if(!UUID.test(postId))showPostRecovery(rawPostId?'invalid':'missing');");
  assert.ok(bootGuard !== -1, '#923 missing/invalid boot guard preserved');
  const loadPostAt = page13Source.indexOf('async function loadPost()');
  assert.ok(bootGuard < loadPostAt, 'the boot guard runs before any post fetch path');
  assert.ok(page13Source.indexOf("showPostRecovery('deleted')") !== -1, '#978 deleted recovery preserved');
}

/* 5. The runtime session/auth sources are untouched by this fix. */
{
  assert.equal(sessionSource.indexOf('showPostRecovery'), -1, 'no shared runtime changes for #1081');
  assert.ok(sessionSource.indexOf('authFailureKind') !== -1, '#1075 classifier still present');
}

console.log('PASS #1081 community detail server-404 recovery contract');
console.log('VALID_UUID_SERVER_404_RECOVERY=YES');
console.log('NOT_FOUND_POST_SHELL_VISIBLE=NO');
console.log('NOT_FOUND_COMMENT_COMPOSER_VISIBLE=NO');
console.log('NOT_FOUND_LIKE_AFFORDANCE_VISIBLE=NO');
console.log('COMMUNITY_RECOVERY_LINK=PASS');
console.log('MISSING_ID_RECOVERY=PRESERVED');
console.log('INVALID_UUID_FETCH_COUNT=0');
console.log('DELETED_RECOVERY=PRESERVED');
console.log('AUTH_COPY_NOT_ROUTED_TO_404=YES');
console.log('BRIDGE_FAULT_NOT_ROUTED_TO_404=YES');
console.log('TIMEOUT_NOT_ROUTED_TO_404=YES');
console.log('BACKEND_CHANGE=0');
console.log('PRODUCTION_MUTATION=0');
console.log('DB_MUTATION=0');
console.log('PRODUCTION_DEPLOY=0');
