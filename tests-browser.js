// PANDORA browser integration checks. Every external request is intercepted.
// No real login, real API key, external model call, or provider account is used.
// npm install --no-save --package-lock=false playwright@1.62.1
// npx playwright install --with-deps chromium
// node tests-browser.js
// Optional: PANDORA_BROWSER=webkit node tests-browser.js
// Optional local runtime reuse: PANDORA_BROWSER_EXECUTABLE=/path/to/chromium
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const playwright = require('playwright');

const STORY_ID = 'u_browser_fixture';
const FIRST_INPUT = '검증자/25살/남/차분한 도서관 방문객';
const SECOND_INPUT = '책을 돌려주고 일곱 닢의 사례를 받는다.';
const THIRD_INPUT = '서가를 정리하고 두 닢의 사례를 받는다.';
const FIXTURE = {
  id: STORY_ID, title: '브라우저 검증 이야기', genre: '기타',
  desc: '네트워크를 차단한 자동 검증용 도서관 이야기.',
  worldLore: '평화로운 도서관이다. 모든 등장인물은 성인이다. 책을 정리하고 대화를 나눈다.',
  prologue: '조용한 도서관에 아침 햇살이 들어왔다.',
  startPromptText: '도서관에서 안내원에게 인사한다.',
  protagonist: { name: '검증자', desc: '25살 성인 방문객' },
  initialState: { status: '방문객', gold: 10, rep: 0, location: '도서관', time: '1일차 아침', injuries: [] },
  characters: { guide: { name: '안내원', role: '도서관 안내원', personality: '30살 성인. 친절하고 차분한 존댓말을 쓴다.' } },
  events: [], endings: [], startChars: ['guide'],
};
// Match a newly published creator story: it has startPrompt, not a built-in
// prologue or startPromptText. This is the legacy startup path that regressed.
const CUSTOM_START_FIXTURE = {
  id: 'u_browser_custom_start', title: '커스텀 시작 장면 검증', genre: '일상',
  desc: '성인 사서와 방문객이 조용한 도서관에서 약속을 지키는 이야기.',
  worldLore: '평화로운 도서관이다. 등장인물은 모두 성인이고, 지급과 수령이 끝난 거래만 기록한다.',
  protagonist: { name: '다온', desc: '26살 성인 방문객' },
  initialState: { status: '방문객', gold: 0, rep: 0, location: '도서관 접수대', time: '1일차 아침', injuries: [] },
  characters: { guide: { name: '민서', role: '도서관 사서', gender: '여성', age: '30살',
    personality: '30살 성인 사서. 영수증을 읽을 때는 반드시 “확인했습니다”라고 차분한 존댓말로 말한다.' } },
  customBgs: { library: { label: '도서관 접수대', url: 'https://fixture.invalid/library.png' } },
  startBg: 'library',
  startPrompt: '아침 도서관 접수대. 민서가 사례금 열 닢을 {이름}에게 지급하고 수령이 완료된 직후부터 시작한다.',
  startChars: ['guide'], events: [], endings: [],
};
const LONG_STORY_FIXTURE = {
  ...CUSTOM_START_FIXTURE,
  id: 'u_browser_long_session', title: '장기 저장·기억 전달 검증',
  desc: '50턴의 모의 응답으로 기억 전달과 저장 복원을 확인한다. 실제 모델 품질 검사가 아니다.',
  initialState: { ...CUSTOM_START_FIXTURE.initialState, gold: 7 },
  startPrompt: '민서와 다음 날 오전 10시 위층 열람실에서 장부를 확인하기로 이미 약속했다. 준호에게는 알리지 않았다. 오늘은 장부 1쪽부터 차례로 확인한다.',
  characters: { ...CUSTOM_START_FIXTURE.characters,
    friend: { name: '준호', role: '지하 서고의 기록원', age: '32살', personality: '약속을 전해 듣지 않은 성인 기록원.' } },
};
const LONG_PROMISE = '민서와 내일 오전 10시 위층 열람실에서 장부 확인. 준호에게 알리지 않음.';
const CLOUD_FIXTURE = {
  cfg: { orKey: 'fixture-cloud-key-never-read', freeTestMode: false, orModel: 'fixture-paid-setting-never-render' },
  'save:u_cloud_fixture': {
    gameState: { gold: 91, location: '도서관' }, turnCount: 7, savedAt: 1794355200000,
    gameHistory: [{ role: 'user', content: 'fixture-private-cloud-player-text' },
      { role: 'assistant', content: '{"narration":"fixture-private-cloud-story-text"}' }],
  },
  stories: { u_cloud_fixture: { title: 'fixture-private-cloud-episode-title' } },
  uploads: { faces: { guide: 'https://fixture.invalid/face.png' }, bgs: { library: 'https://fixture.invalid/library.png' } },
};
const CLOUD_DELETED_KEY = 'save:' + STORY_ID;
const CLOUD_PAST_SAVE = { dataVersion: 5, turnCount: 3, savedAt: 1794355100000,
  gameState: { gold: 17, location: '도서관', time: '1일차 아침' },
  gameHistory: [{ role: 'assistant', content: JSON.stringify({ narration: '보관된 세 번째 장면.', dialogue: [] }) }],
  dialogueLog: [], apiKey: 'fixture-old-key-must-not-be-imported' };
const ARTIFACTS = process.env.PANDORA_BROWSER_ARTIFACTS || path.join(os.tmpdir(), 'pandora-browser');
fs.mkdirSync(ARTIFACTS, { recursive: true });
const results = [];
let browser, server;

function deferred() {
  let resolve;
  return { promise: new Promise(r => { resolve = r; }), release: () => resolve() };
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label)), 12000);
    })]);
  } finally { clearTimeout(timer); }
}

// This server serves only checked-out test assets. It never proxies requests.
async function startServer() {
  const root = path.resolve(__dirname);
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/novel.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', ETag: '"browser-fixture"' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return 'http://127.0.0.1:' + server.address().port;
}

function sse(value) {
  const raw = JSON.stringify(value);
  const events = [];
  for (let i = 0; i < raw.length; i += 53) {
    events.push('data: ' + JSON.stringify({ model: 'fixture/model:free', choices: [{ delta: { content: raw.slice(i, i + 53) } }] }));
  }
  events.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0 } }));
  // CRLF and an unterminated final data line exercise production stream framing.
  return events.join('\r\n\r\n') + '\r\n\r\ndata: [DONE]';
}

function fixtureReply(kind, user) {
  if (kind === 'probe') return { ok: true };
  if (kind === 'choices') return { choices: ['안내원에게 책의 위치를 묻는다', '열람실을 둘러본다'] };
  // The recorder now also receives a settled-event ledger. Select the fixture
  // from its current scene, never from old quoted transactions in that ledger.
  const sceneMarker = '[이번 턴 장면]';
  const currentAction = /\[이번 행동과 이미 끝난 사건\]\n이번 플레이어 입력: ([\s\S]*?)\n현재 위치:/.exec(user);
  const current = user.includes(sceneMarker) ? user.slice(user.lastIndexOf(sceneMarker) + sceneMarker.length)
    : currentAction ? currentAction[1] : user;
  if (current.includes('사례금 열 닢')) {
    if (kind === 'state') return { state_update: { gold: 10 },
      transactions: [{ kind: 'reward', item: '사례금', counterparty: '민서', delta: 10,
        evidence: '아침 도서관 접수대에서 민서가 사례금 열 닢을 건네고 다온이 모두 받았다.' }],
      choices: ['민서에게 영수증을 요청한다', '열람실로 간다'], chronicle: [] };
    return {
      narration: '아침 도서관 접수대에서 민서가 사례금 열 닢을 건네고 다온이 모두 받았다.',
      dialogue: [{ speaker: '민서', char_id: 'guide', emotion: 'normal', pose: 'upper', text: '사례금 열 닢의 지급을 확인했습니다.' }],
      background: null, mood: null, ending: null, cg: null, combat: false,
    };
  }
  const second = /일곱 닢|두 번째 책/.test(current);
  const third = /두 닢|세 번째 서가/.test(current);
  const delta = second ? 7 : third ? 2 : 4;
  const narration = second ? '두 번째 책을 돌려주자 안내원이 일곱 닢의 사례를 건넸다.'
    : third ? '세 번째 서가를 정리하자 안내원이 두 닢의 사례를 건넸다.'
    : '안내원이 도서관 방문을 반기며 네 닢의 사례를 건넸다.';
  if (kind === 'state') return {
    state_update: { gold: delta },
    transactions: [{ kind: 'reward', item: second ? '책 반환 사례금' : third ? '서가 정리 사례금' : '방문 사례금',
      counterparty: '안내원', delta, evidence: narration }],
    choices: ['안내원에게 책의 위치를 묻는다', '열람실을 둘러본다'],
    chronicle: [],
  };
  return {
    narration,
    dialogue: [{ speaker: '안내원', char_id: 'guide', emotion: 'normal', pose: 'upper', text: '도와주셔서 감사합니다. 천천히 둘러보세요.' }],
    background: null, mood: null, ending: null, cg: null, combat: false,
  };
}

function longSessionReply(kind, turn) {
  if (kind === 'summary') return {
    summary: LONG_PROMISE + ' 현재 플레이에서는 새로운 거래 없이 장부를 차례로 확인했다.',
    chronicle: [],
  };
  const scene = `장기 검증 ${turn}번째 장면. 민서와 장부 ${turn}쪽을 확인했다. 새로운 거래는 없었다.`;
  if (kind === 'state') return {
    state_update: { location: '도서관 접수대', player: { note: LONG_PROMISE },
      chars: { guide: { knows: LONG_PROMISE } } },
    choices: [`장부 ${turn + 1}쪽을 확인한다`, '잠시 쉬며 창밖을 본다'], chronicle: [],
  };
  return { narration: scene,
    dialogue: [{ speaker: '민서', char_id: 'guide', emotion: 'normal', pose: 'upper', text: `${turn}쪽 확인했습니다.` }],
    background: null, mood: null, ending: null, cg: null, combat: false };
}

async function createFixturePage(origin, mobile, options = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const net = { calls: [], prompts: [], syncCalls: [], errors: [], externalBlocked: 0,
    holdState: null, nextMainStatus: null, nextStateStatus: null, mainTurn: 0, quotaCalls: 0 };
  const story = options.story || FIXTURE;
  await context.addInitScript(({ story, id, freeMode }) => {
    if (sessionStorage.getItem('pandora_fixture_seeded')) return;
    sessionStorage.setItem('pandora_fixture_seeded', '1');
    // Credentials here are intentionally invalid. External traffic is never continued.
    localStorage.setItem('vn_auth', 'local-browser-fixture-not-a-real-login');
    localStorage.setItem('vn_auth_user', 'browser-fixture');
    localStorage.setItem('vn_bgm2', '0');
    localStorage.setItem('vn_local_stories', JSON.stringify({ [id]: story }));
    localStorage.setItem('vn_cfg', JSON.stringify({
      provider: 'openrouter', orKey: 'sk-or-v1-test-no-network',
      apiKey: 'AIza-test-no-network', nimUrl: 'https://nim-fixture.invalid',
      orModel: 'google/gemini-3.6-flash', orModelBy: { nakin: 'google/gemini-3.1-pro-preview' },
      freeTestMode: freeMode, freeTestModel: 'openrouter/free', splitPipe: true,
    }));
  }, { story, id: story.id, freeMode: options.freeMode === true });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) { await route.continue(); return; }
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/key' && request.method() === 'GET') {
      net.quotaCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        is_free_tier: true, free_model_daily_requests: { used: 17, limit: 50, remaining: 33 },
      } }) });
      return;
    }
    if (url.hostname === 'pandora-sync.pasokong99.workers.dev' && ['/sync', '/sync/list', '/sync/capabilities', '/sync/versions'].includes(url.pathname)) {
      const key = url.searchParams.get('key');
      const history = url.searchParams.get('history') === '1', version = url.searchParams.get('version');
      net.syncCalls.push({ method: request.method(), path: url.pathname, key, history, version });
      if (request.method() !== 'GET') {
        net.errors.push('cloud write attempted while browser fixture cloud backup is off');
        await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Fixture rejects cloud writes"}' });
        return;
      }
      if (key === 'cfg') net.errors.push('cloud inspection fetched connection settings');
      const data = url.pathname === '/sync/list' ? { keys: history
        ? [...Object.keys(CLOUD_FIXTURE).filter(k => k.startsWith('save:')), CLOUD_DELETED_KEY] : Object.keys(CLOUD_FIXTURE),
        list_complete: true, ...(history ? { history: true } : {}) }
        : url.pathname === '/sync/capabilities' ? { protocol: 2, atomic: true, history: true, maxVersions: 6 }
        : url.pathname === '/sync/versions' ? { key, versions: key === CLOUD_DELETED_KEY ? [
          { revision: 'deleted-r4', savedAt: 1794355200000, deleted: true, bytes: 0, current: true },
          { revision: 'past-r3', savedAt: 1794355100000, deleted: false, bytes: 500, current: false },
        ] : [], maxVersions: 6 }
        : key === CLOUD_DELETED_KEY && version === 'past-r3' ? CLOUD_PAST_SAVE : CLOUD_FIXTURE[key];
      await route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json',
        headers: { ETag: data === undefined ? '"missing"' : '"fixture-' + encodeURIComponent(key || 'catalog') + '"' },
        body: JSON.stringify(data ?? null) });
      return;
    }
    const modelRequest = request.method() === 'POST' && (
      (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/chat/completions') ||
      (url.hostname === 'pandora-sync.pasokong99.workers.dev' && url.pathname === '/gen')
    );
    if (modelRequest) {
      let body;
      try { body = request.postDataJSON(); } catch { body = {}; }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const sys = String(messages[0]?.content || '');
      const user = String(messages[messages.length - 1]?.content || '');
      const kind = /boolean field ok/.test(sys) ? 'probe'
        : /상태 기록관/.test(sys) || /\[이번 턴 장면\]/.test(user) ? 'state'
        : /사실 기록원/.test(sys) && /통합 요약/.test(sys) ? 'summary'
        : /선택지 작가/.test(sys) ? 'choices' : 'main';
      if (kind === 'main') net.mainTurn++;
      net.calls.push({ kind, model: body.model, maxTokens: body.max_tokens, systemHead: sys.slice(0, 90) });
      // Only this explicitly requested fixture context retains prompt text for
      // assertions. Failure logging below continues to print metadata only.
      if (options.capturePrompts) net.prompts.push({ kind,
        messages: messages.map(message => ({ role: message.role, content: String(message.content || '') })) });
      try {
        assert.ok(body.model === 'openrouter/free' || /:free$/.test(body.model), 'free mode selected a paid model');
        assert.ok(!body.provider?.only?.includes('google-vertex'), 'free request retained Google Vertex-only routing');
        assert.equal(body.provider?.max_price?.prompt, 0, 'free request lacks a zero input-price cap');
        assert.equal(body.provider?.max_price?.completion, 0, 'free request lacks a zero output-price cap');
        assert.ok(body.max_tokens <= 8000, 'small/main request retained an unbounded 16K output budget');
        if (kind === 'probe') assert.ok(body.max_tokens <= 128, 'connection probe requested more than 128 output tokens');
      } catch (e) { net.errors.push(e.message); }
      if (kind === 'main' && net.nextMainStatus) {
        const status = net.nextMainStatus; net.nextMainStatus = null;
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status, message: 'Fixture free quota exhausted' } }) });
        return;
      }
      if (kind === 'state' && net.nextStateStatus) {
        const status = net.nextStateStatus; net.nextStateStatus = null;
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status, message: 'Fixture interrupted recorder' } }) });
        return;
      }
      if (kind === 'state' && net.holdState) {
        const held = net.holdState; net.holdState = null;
        held.reached.release();
        await held.resume.promise;
      }
      const reply = options.reply ? options.reply(kind, user, body) : options.longSession ? longSessionReply(kind, net.mainTurn) : fixtureReply(kind, user);
      if (options.integrated && kind === 'main') Object.assign(reply,
        options.reply ? options.reply('state', user, body) : fixtureReply('state', user));
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply) });
      return;
    }
    // Default deny is essential: newly introduced provider endpoints cannot escape.
    net.externalBlocked++;
    if (request.resourceType() === 'image') {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    } else {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"External network disabled by browser test"}' });
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  // A separate cloud-safety context installs its fake clock before application
  // timers exist. Existing playthrough scenarios retain their real clock.
  if (options.clock) await page.clock.install({ time: new Date('2026-11-11T00:00:00Z') });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin + '/novel.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('mainScreen')?.style.display === 'flex');
  await page.locator('.enter-btn').click();
  await page.locator('#introScreen').waitFor({ state: 'hidden' });
  return { context, page, net, errors, mobile };
}

async function check(ctx, name, fn) {
  const fullName = (ctx.mobile ? 'mobile' : 'desktop') + ': ' + name;
  try {
    await fn();
    assert.deepEqual(ctx.net.errors, [], 'outbound request policy failed');
    assert.deepEqual(ctx.errors, [], 'uncaught browser script error');
    results.push({ name: fullName, passed: true });
    console.log('PASS ' + fullName);
  } catch (e) {
    results.push({ name: fullName, passed: false, error: e.message });
    // Only fixture role/model metadata is logged; no headers, keys or full prompts.
    console.error('Fixture request roles:', JSON.stringify(ctx.net.calls));
    await ctx.page.screenshot({ path: path.join(ARTIFACTS, fullName.replace(/[^a-z0-9]+/gi, '-') + '.png'), fullPage: true }).catch(() => {});
    throw new Error(fullName + '\n' + e.stack);
  }
}

async function drainDialogue(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => inputMode && !sendBtn.disabled && !replaying && !isShowing &&
      !waitingForTap && dialogueQueue.length === 0 && inputBar.style.display !== 'none')) return;
    // A real click/tap exercises typewriter completion and dialogue queue transitions.
    if (await page.locator('#dialoguePanel').isVisible()) {
      const box = await page.locator('#dialoguePanel').boundingBox();
      if (box) {
        const x = box.x + box.width * 0.8, y = box.y + Math.min(box.height - 2, 14);
        if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
      }
    }
    await page.waitForTimeout(80);
  }
  throw new Error('Dialogue did not reach an input boundary: ' + await page.evaluate(() => JSON.stringify({ inputMode, busy: sendBtn.disabled, replaying, isShowing, waitingForTap, queued: dialogueQueue.length, phase: window._startPhase })));
}

async function waitForStoryChoice(page, sought) {
  for(let attempt=0; attempt<115; attempt++) {
    const button=page.locator('#choiceBox .choice-btn').filter({hasText:sought});
    if(await button.count() && await button.first().isVisible()) return;
    // Hogwarts magic submenus are overlaid near the dialogue on narrow mobile
    // viewports. For that one menu, advance narration through the app nav
    // handler; retain real taps for ordinary cinematic story progression.
    if(/마법 연습/.test(sought)){
      await page.evaluate(()=>{if(isShowing||waitingForTap)navNext();});
    } else if(await page.locator('#dialoguePanel').isVisible()) {
      const box=await page.locator('#dialoguePanel').boundingBox();
      if(box) {
        const x=box.x+box.width*0.8,y=box.y+Math.min(box.height-2,14);
        if(await page.evaluate(()=>navigator.maxTouchPoints>0))await page.touchscreen.tap(x,y);
        else await page.mouse.click(x,y);
      }
    }
    await page.waitForTimeout(70);
  }
  const debug=await page.evaluate(()=>({
    phase:window._startPhase,clock:gameState?.hogwarts?.date,
    house:gameState?.hogwarts?.house,
    director:gameState?.hogwarts?.scene,
    pending:gameState?.hogwarts?.world?.pending,
    active:gameState?.hogwarts?.world?.active,
    choiceTexts:[...document.querySelectorAll('#choiceBox .choice-btn')].map(x=>x.textContent),
    queue:dialogueQueue.length,inputMode,isShowing,waitingForTap,
    inFlight:!!window._inputRequest,busy:sendBtn.disabled,
    tail:gameHistory.slice(-2).map(x=>String(x.content||'').slice(0,160)),
    currentBgFile,windowPending:window._pendingChoices
  }));
  throw Error('Hogwarts choice not presented: '+sought+' | '+JSON.stringify(debug));
}

async function chooseHogwartsMenu(page, label) {
  await drainDialogue(page);
  await page.locator('#moreBtn').click();
  await page.locator('#hogwartsMenu button').filter({ hasText: label }).click();
}

async function enterText(page, text) {
  await drainDialogue(page);
  await page.locator('#userInput').fill(text);
  await page.locator('#sendBtn').click();
}

async function waitGold(page, gold) {
  await page.waitForFunction(expected => gameState.gold === expected && !sendBtn.disabled &&
    gameHistory[gameHistory.length - 1]?._stateExtract?.status === 'applied', gold);
  await drainDialogue(page);
}

async function openSlots(page) {
  await page.locator('#moreBtn').click();
  await page.locator('#topMenu button').filter({ hasText: '세이브 슬롯' }).click();
  await page.locator('#slotPanel').waitFor({ state: 'visible' });
}

async function configureAndStart(ctx) {
  const { page } = ctx;
  await check(ctx, 'free settings preserve the normal model and survive reload', async () => {
    await page.locator('#tabMy').click();
    await page.locator('#pageMy button').filter({ hasText: 'AI 연결 설정' }).click();
    await page.locator('#freeTestModeChk').check();
    await page.locator('#orKeyInput').fill('sk-or-v1-test-no-network');
    await page.locator('#freeModelSel').selectOption('openrouter/free');
    await page.locator('#freeTestModeChk').uncheck();
    assert.equal(await page.locator('#orModelSel').inputValue(), 'google/gemini-3.8-flash');
    assert.equal(await page.locator('#orOnlyStory').isChecked(), true);
    await page.locator('#freeTestModeChk').check();
    await page.locator('#apiModal .start-btn').click();
    const saved = await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('vn_cfg'));
      return { free: c.freeTestMode, freeModel: c.freeTestModel, normalModel: c.orModel, provider: c.provider,
        perStoryModel: c.orModelBy.nakin, keptGeminiKey: c.apiKey === 'AIza-test-no-network', nimUrl: c.nimUrl };
    });
    assert.deepEqual(saved, { free: true, freeModel: 'openrouter/free', normalModel: 'google/gemini-3.8-flash', provider: 'openrouter',
      perStoryModel: 'google/gemini-3.8-flash', keptGeminiKey: true, nimUrl: 'https://nim-fixture.invalid' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('mainScreen')?.style.display === 'flex');
    await page.locator('.enter-btn').click();
    await page.locator('#introScreen').waitFor({ state: 'hidden' });
    await page.locator('#tabMy').click();
    await page.locator('#pageMy button').filter({ hasText: 'AI 연결 설정' }).click();
    assert.equal(await page.locator('#freeTestModeChk').isChecked(), true);
    assert.equal(await page.locator('#freeModelSel').inputValue(), 'openrouter/free');
    await page.locator('#settingsCloseBtn').click();
  });
  await check(ctx, 'connection probe rejects a paid model and accepts a tiny free response', async () => {
    await page.locator('#pageMy button').filter({ hasText: 'AI 연결 설정' }).click();
    const before = ctx.net.calls.length;
    await page.locator('#freeModelSel').selectOption('custom');
    await page.locator('#freeModelInput').fill('google/gemini-3.6-flash');
    await page.locator('#freeApiCheckBtn').click();
    assert.equal(ctx.net.calls.length, before, 'invalid paid model reached the network');
    assert.match(await page.locator('#freeApiCheckStatus').innerText(), /무료 모델/);
    await page.locator('#freeModelSel').selectOption('openrouter/free');
    await page.locator('#freeApiCheckBtn').click();
    await page.waitForFunction(() => document.getElementById('freeApiCheckStatus').textContent.includes('연결 확인 완료'));
    assert.equal(ctx.net.calls.length, before + 1);
    assert.equal(ctx.net.calls[before].kind, 'probe');
    await page.locator('#settingsCloseBtn').click();
  });
  await check(ctx, 'real start controls and first state extraction commit once', async () => {
    await page.locator('#myStories .play-item').filter({ hasText: FIXTURE.title }).click();
    await page.locator('#detailNewBtn').click();
    await page.waitForFunction(() => window._startPhase === 'mode');
    await drainDialogue(page);
    await page.locator('#choiceBox .choice-btn').filter({ hasText: '스토리 모드' }).click();
    await page.waitForFunction(() => window._startPhase === 'setup');
    await drainDialogue(page);
    assert.equal(ctx.net.calls.filter(c => c.kind !== 'probe').length, 0,
      'fixed character setup must not generate an unnecessary model request');
    await enterText(page, FIRST_INPUT);
    await waitGold(page, 14);
    assert.equal(ctx.net.calls.filter(c => c.kind === 'main').length, 1);
    assert.equal(ctx.net.calls.filter(c => c.kind === 'state').length, 1);
    assert.ok((await page.locator('#dialogueText').textContent()).trim());
  });
}

async function playthrough(ctx) {
  const { page, net } = ctx;
  await configureAndStart(ctx);
  await check(ctx, 'two turns, slot save, regenerate and undo keep exact state', async () => {
    await openSlots(page);
    await page.locator('#slotList .slot-item').first().getByRole('button', { name: '저장', exact: true }).click();
    await page.locator('#slotPanel .my-btn').click();
    await enterText(page, SECOND_INPUT);
    await waitGold(page, 21);
    await page.locator('#redoBar button').filter({ hasText: '다시 답변' }).click();
    await waitGold(page, 21);
    assert.equal(net.calls.filter(c => c.kind === 'main').length, 3);
    await page.locator('#redoBar button').filter({ hasText: '되돌리기' }).click();
    await page.waitForFunction(() => gameState.gold === 14 && !sendBtn.disabled);
    assert.ok((await page.locator('#userInput').innerText()).includes('일곱 닢'));
  });
  await check(ctx, 'slot reload and browser reload do not call the model or duplicate state', async () => {
    const before = net.calls.length;
    await openSlots(page);
    await page.locator('#slotList .slot-item').first().getByRole('button', { name: '불러오기', exact: true }).click();
    await waitGold(page, 14);
    assert.equal(net.calls.length, before);
    // Wait for an actual IndexedDB read transaction after the production save writes.
    await page.evaluate(async () => {
      if (!_bulkDB) return;
      await new Promise((resolve, reject) => {
        const tx = _bulkDB.transaction(_bulkDB.objectStoreNames[0], 'readonly');
        tx.oncomplete = resolve; tx.onerror = reject;
        tx.objectStore(_bulkDB.objectStoreNames[0]).get(saveKeyFor(STORY.id));
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('mainScreen')?.style.display === 'flex');
    await page.locator('.enter-btn').click();
    await page.locator('#introScreen').waitFor({ state: 'hidden' });
    await page.locator('#tabMy').click();
    await page.locator('#myStories .play-item').filter({ hasText: FIXTURE.title }).click();
    await page.locator('#detailContinueBtn').click();
    await waitGold(page, 14);
    assert.equal(net.calls.length, before);
  });
  await check(ctx, 'slot two and browser reload hide input until AUTO finishes the restored scene', async () => {
    const before = net.calls.length;
    const history = await page.evaluate(() => JSON.stringify(gameHistory));
    const finishRestoredScene = async () => {
      await page.waitForFunction(() => replaying && !inputMode);
      assert.equal(await page.locator('#inputBar').isVisible(), false, 'restored dialogue exposed the next input before replay ended');
      assert.equal(await page.locator('#redoBar').isVisible(), false, 'restored dialogue exposed a stale redo bar');
      assert.equal(await page.locator('#choiceBox').count(), 0, 'restored dialogue kept stale choices visible');
      assert.equal(net.calls.length, before, 'loading a completed scene requested a model response');
      assert.equal(await page.evaluate(() => autoPlay), false);
      await page.locator('#autoBtn').click();
      await page.waitForFunction(() => !replaying && inputMode && !sendBtn.disabled && !isShowing &&
        !waitingForTap && dialogueQueue.length === 0, undefined, { timeout: 20000 });
      assert.equal(await page.locator('#inputBar').isVisible(), true, 'AUTO completion did not restore input');
      assert.equal(await page.evaluate(() => gameState.gold), 14);
      assert.equal(await page.evaluate(() => JSON.stringify(gameHistory)), history, 'replaying changed the canonical turn history');
      assert.equal(net.calls.length, before, 'AUTO playback generated a new turn');
      await page.locator('#autoBtn').click();
      assert.equal(await page.evaluate(() => autoPlay), false);
    };
    await openSlots(page);
    await page.locator('#slotList .slot-item').nth(1).getByRole('button', { name: '저장', exact: true }).click();
    await page.locator('#slotList .slot-item').nth(1).getByRole('button', { name: '불러오기', exact: true }).click();
    await finishRestoredScene();
    await flushLocalSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('mainScreen')?.style.display === 'flex');
    await page.locator('.enter-btn').click();
    await page.locator('#introScreen').waitFor({ state: 'hidden' });
    await page.locator('#tabMy').click();
    await page.locator('#myStories .play-item').filter({ hasText: FIXTURE.title }).click();
    await page.locator('#detailContinueBtn').click();
    await finishRestoredScene();
  });
  await check(ctx, 'next input waits for delayed extraction before requesting a new scene', async () => {
    const held = { reached: deferred(), resume: deferred() };
    net.holdState = held;
    try {
      await enterText(page, SECOND_INPUT);
      await within(held.reached.promise, 'the delayed state request');
      await drainDialogue(page);
      assert.equal(await page.evaluate(() => gameState.gold), 14);
      const mainBefore = net.calls.filter(c => c.kind === 'main').length;
      await page.locator('#userInput').fill(THIRD_INPUT);
      await page.locator('#sendBtn').click();
      await page.waitForFunction(() => !!window._inputRequest && sendBtn.disabled);
      assert.equal(net.calls.filter(c => c.kind === 'main').length, mainBefore, 'new scene requested before the old state committed');
      held.resume.release();
      await waitGold(page, 23);
      assert.equal(net.calls.filter(c => c.kind === 'main').length, mainBefore + 1);
      assert.equal(await page.evaluate(() => gameHistory[gameHistory.length - 1]._turnBefore.state.gold), 21);
    } finally { held.resume.release(); }
  });
  await check(ctx, 'free quota error stops without retrying or switching to a paid model', async () => {
    const before = net.calls.length;
    net.nextMainStatus = 429;
    await enterText(page, '열람실의 책을 살펴본다.');
    await page.waitForFunction(() => !sendBtn.disabled && !window._mainRequest && !window._inputRequest);
    assert.equal(net.calls.length, before + 1, 'quota error generated additional API attempts');
    assert.equal(await page.evaluate(() => gameState.gold), 23);
    await page.waitForFunction(() => document.getElementById('dialogueText').textContent.trim().length > 0);
    assert.ok((await page.locator('#dialogueText').innerText()).trim(), 'failure left an empty dialogue screen');
    // Exercise the resume listener with its recorded background scope. This is a
    // synthetic visibility event, not a claim about physical iOS suspension.
    await page.evaluate(() => {
      window._bgDuringGen = true;
      window._bgGenScope = turnWorkScope();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(850);
    assert.equal(net.calls.length, before + 1, 'visibility resume retried an exhausted free quota');
  });
  await check(ctx, 'input and menus fit the viewport after orientation and focus changes', async () => {
    await page.evaluate(() => enterInputMode());
    for (const size of ctx.mobile ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }] : [{ width: 1280, height: 900 }]) {
      await page.setViewportSize(size);
      await page.locator('#userInput').focus();
      await page.waitForTimeout(220);
      const bounds = await page.evaluate(() => {
        const b = document.getElementById('inputBar').getBoundingClientRect();
        const s = document.getElementById('sendBtn').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          inputLeft: b.left, inputRight: b.right, sendLeft: s.left, sendRight: s.right, sendBottom: s.bottom };
      });
      assert.ok(bounds.scrollWidth <= bounds.width + 2, 'document overflows horizontally');
      assert.ok(bounds.inputLeft >= -2 && bounds.inputRight <= bounds.width + 2, 'input bar exceeds viewport width');
      assert.ok(bounds.sendLeft >= 0 && bounds.sendRight <= bounds.width + 2 && bounds.sendBottom <= bounds.height + 2, 'send control is outside the viewport');
      await page.locator('#userInput').blur();
    }
    await page.screenshot({ path: path.join(ARTIFACTS, (ctx.mobile ? 'mobile' : 'desktop') + '-game.png'), fullPage: true });
  });
}

async function cloudSafetyChecks(ctx) {
  const { page, net } = ctx;
  await check(ctx, 'logged-in MY defaults cloud backup off and autosave never uploads after 25 seconds', async () => {
    await page.locator('#tabMy').click();
    assert.match(await page.locator('#myProfile').innerText(), /browser-fixture/);
    assert.match(await page.locator('#myProfile').innerText(), /클라우드 백업 꺼짐/);
    assert.equal(await page.getByRole('button', { name: '자동 백업 켜기', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '↑ 지금 백업', exact: true }).isDisabled(), true);
    // Exercise the real local autosave entry point, including its cloud-backup
    // scheduling hook, in a fresh logged-in browser without enabling uploads.
    await page.evaluate(() => autoSave());
    await page.clock.fastForward(25000);
    await page.evaluate(async () => { await Promise.allSettled([..._cloudPendingWrites]); });
    assert.equal(net.syncCalls.filter(call => call.method !== 'GET').length, 0, 'autosave uploaded despite the default cloud-off state');
    assert.equal(net.calls.length, 0, 'cloud safety checks unexpectedly generated a model request');
    assert.match(await page.locator('#myProfile').innerText(), /클라우드 백업 꺼짐/);
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('vn_cfg')));
    assert.equal(cfg.freeTestMode, true); assert.equal(cfg.provider, 'openrouter');
    assert.equal(cfg.orModel, 'google/gemini-3.8-flash');
  });
  await check(ctx, 'backup inspection is GET-only, omits credentials and preserves local free settings and saves', async () => {
    const snapshot = () => page.evaluate(() => ({
      cfg: localStorage.getItem('vn_cfg'), stories: localStorage.getItem('vn_local_stories'),
      saves: Object.fromEntries(bulkKeys(/^vn_save_|^nakin_save$|^vn_slot_/).map(key => [key, bulkGet(key)])),
    }));
    const before = await snapshot();
    await page.getByRole('button', { name: '백업 확인', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('읽기만 완료'));
    const status = await page.locator('#syncStatus').innerText();
    assert.match(status, /클라우드 4개 항목/);
    assert.match(status, /save:u_cloud_fixture.*7턴.*기록 2개/);
    assert.match(status, /제작 에피소드 1개/); assert.match(status, /이미지 목록 2개/);
    assert.match(status, /연결 설정 백업 있음/);
    for (const forbidden of ['fixture-cloud-key-never-read', 'fixture-paid-setting-never-render',
      'fixture-private-cloud-player-text', 'fixture-private-cloud-story-text', 'fixture-private-cloud-episode-title']) {
      assert.ok(!status.includes(forbidden), 'cloud inspection exposed private backup contents');
    }
    assert.ok(net.syncCalls.some(call => call.path === '/sync/list'), 'inspection never queried the backup list');
    assert.ok(net.syncCalls.every(call => call.method === 'GET'), 'inspection wrote to cloud storage');
    assert.equal(net.syncCalls.filter(call => call.key === 'cfg').length, 0, 'inspection downloaded API settings');
    assert.deepEqual(await snapshot(), before, 'read-only inspection changed local settings or saves');
    await page.clock.fastForward(25000);
    await page.evaluate(async () => { await Promise.allSettled([..._cloudPendingWrites]); });
    assert.ok(net.syncCalls.every(call => call.method === 'GET'), 'inspection enabled a delayed cloud upload');
    assert.equal(await page.getByRole('button', { name: '↑ 지금 백업', exact: true }).isDisabled(), true);
    await page.locator('#pageMy button').filter({ hasText: 'AI 연결 설정' }).click();
    assert.equal(await page.locator('#freeTestModeChk').isChecked(), true);
    assert.equal(await page.locator('#freeModelSel').inputValue(), 'openrouter/free');
    await page.locator('#settingsCloseBtn').click();
    await page.screenshot({ path: path.join(ARTIFACTS, (ctx.mobile ? 'mobile' : 'desktop') + '-cloud-inspection.png'), fullPage: true });
  });
  await check(ctx, 'a deleted cloud save is selectable in history and recovers into an empty local slot', async () => {
    const before = await page.evaluate(() => ({ cfg: localStorage.getItem('vn_cfg'),
      current: Object.fromEntries(bulkKeys(/^vn_save_|^nakin_save$/).map(key => [key, bulkGet(key)])) }));
    await page.getByRole('button', { name: '이전 백업 보기 · 빈 슬롯으로 복구', exact: true }).click();
    await page.locator('#cloudHistoryPanel select').selectOption(CLOUD_DELETED_KEY);
    const versions = page.locator('#cloudHistoryVersions button');
    await versions.first().waitFor({ state: 'visible' });
    assert.equal(await versions.count(), 1, 'deleted head itself appeared as a recoverable revision');
    await versions.first().click();
    await page.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('1번 빈 슬롯에 복구했습니다'));
    const after = await page.evaluate(id => ({ cfg: localStorage.getItem('vn_cfg'),
      current: Object.fromEntries(bulkKeys(/^vn_save_|^nakin_save$/).map(key => [key, bulkGet(key)])),
      restored: JSON.parse(bulkGet('vn_slot_' + id + '_1')), cloudEnabled: cloudWritesEnabled() }), STORY_ID);
    assert.equal(after.cfg, before.cfg); assert.deepEqual(after.current, before.current);
    assert.equal(after.restored.turnCount, 3); assert.equal(after.restored.restoredFrom.revision, 'past-r3');
    assert.equal(after.restored.apiKey, undefined); assert.equal(after.cloudEnabled, false);
    assert.ok(net.syncCalls.some(call => call.path === '/sync/list' && call.history));
    assert.ok(net.syncCalls.some(call => call.key === CLOUD_DELETED_KEY && call.version === 'past-r3'));
    assert.ok(net.syncCalls.every(call => call.method === 'GET'));
    assert.equal(net.calls.length, 0);
  });
}

async function customStartChecks(ctx) {
  const { page, net } = ctx;
  await check(ctx, 'creator-shaped custom story starts locally then sends its opening and full start-character card once', async () => {
    await page.locator('#tabMy').click();
    await page.locator('#myStories .play-item').filter({ hasText: CUSTOM_START_FIXTURE.title }).click();
    await page.locator('#detailNewBtn').click();
    await page.waitForFunction(() => window._startPhase === 'mode');
    await drainDialogue(page);
    assert.equal(net.calls.length, 0, 'custom prologue unexpectedly called a model');
    assert.ok((await page.locator('#dialogueText').innerText()).includes(CUSTOM_START_FIXTURE.desc),
      'custom prologue did not render the public synopsis');

    await page.locator('#choiceBox .choice-btn').filter({ hasText: '스토리 모드' }).click();
    await page.waitForFunction(() => window._startPhase === 'setup');
    await drainDialogue(page);
    assert.equal(net.calls.length, 0, 'custom mode selection or character setup called a model');
    assert.match(await page.locator('#dialogueText').innerText(), /캐릭터를 설정해 주세요/);

    await enterText(page, '다온/26살/남/차분한 성인 방문객');
    await waitGold(page, 10);
    assert.deepEqual(net.calls.map(call => call.kind), ['main', 'state'],
      'custom startup must make one main request and one state extraction only');
    const firstMain = net.prompts.filter(prompt => prompt.kind === 'main');
    assert.equal(firstMain.length, 1);
    const lastUser = [...firstMain[0].messages].reverse().find(message => message.role === 'user');
    assert.ok(lastUser, 'main request omitted the player setup input');
    assert.ok(lastUser.content.includes(CUSTOM_START_FIXTURE.startPrompt.replace('{이름}', '다온')),
      'creator startPrompt was lost before the first main request');
    assert.ok(lastUser.content.includes(CUSTOM_START_FIXTURE.characters.guide.personality),
      'the selected start character reached the request as a name without its detailed card');
    assert.ok(lastUser.content.includes("반드시 '민서'"), 'opening request did not require the selected first character');
    const completePrompt = firstMain[0].messages.map(message => message.content).join('\n');
    assert.ok(!completePrompt.includes('이번 첫 응답은 "프롤로그"다'),
      'legacy AI prologue instructions leaked into the first playable scene');
    assert.ok(!completePrompt.includes('프롤로그에는 특정 인물을 등장'),
      'first playable scene still forbids the selected NPC from appearing');
    assert.equal(await page.evaluate(() => window._startPhase), 'playing');
  });
}

async function flushLocalSave(page) {
  await page.evaluate(async () => {
    if (!_bulkDB) return;
    await new Promise((resolve, reject) => {
      const tx = _bulkDB.transaction('kv', 'readonly');
      tx.oncomplete = resolve; tx.onerror = reject;
      tx.objectStore('kv').get(saveKeyFor(STORY.id));
    });
  });
}

async function startFixtureStory(ctx, fixture, setup = FIRST_INPUT) {
  const { page } = ctx;
  await page.locator('#tabMy').click();
  await page.locator('#myStories .play-item').filter({ hasText: fixture.title }).click();
  await page.locator('#detailNewBtn').click();
  await page.waitForFunction(() => window._startPhase === 'mode');
  await drainDialogue(page);
  await page.locator('#choiceBox .choice-btn').filter({ hasText: '스토리 모드' }).click();
  await page.waitForFunction(() => window._startPhase === 'setup');
  await enterText(page, setup);
}

async function quotaAndIntegratedChecks(ctx) {
  const { page, net } = ctx;
  await check(ctx, 'quota inspection uses GET only and integrated setting saves one request per ordinary turn', async () => {
    await page.locator('#tabMy').click();
    await page.locator('#pageMy button').filter({ hasText: 'AI 연결 설정' }).click();
    await page.locator('#freeApiQuotaBtn').click();
    await page.waitForFunction(() => /33/.test(document.getElementById('freeApiQuotaStatus').textContent));
    assert.equal(net.quotaCalls, 1);
    assert.equal(net.calls.length, 0, 'looking up the quota generated a model response');
    await page.locator('#aiPipelineSel').selectOption('integrated');
    await page.locator('#apiModal .start-btn').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vn_cfg')).splitPipe), false);
    await startFixtureStory(ctx, FIXTURE);
    await page.waitForFunction(() => turnCount === 1 && gameState.gold === 14 && !sendBtn.disabled);
    await drainDialogue(page);
    assert.deepEqual(net.calls.map(call => call.kind), ['main'], 'integrated first turn still ran a state extraction');
    await enterText(page, SECOND_INPUT);
    await page.waitForFunction(() => turnCount === 2 && gameState.gold === 21 && !sendBtn.disabled);
    await drainDialogue(page);
    assert.deepEqual(net.calls.map(call => call.kind), ['main', 'main']);
    assert.equal(await page.evaluate(() => pendingStateExtractEntry()), null);
  });
}

async function longSessionChecks(ctx) {
  const { page, net } = ctx;
  let checkpoint;
  await check(ctx, '50 fixture turns retain the private promise across real summary, history trimming and slot writes', async () => {
    await startFixtureStory(ctx, LONG_STORY_FIXTURE, '다온/26살/남/차분한 성인 방문객');
    await waitGold(page, 7);
    for (let turn = 2; turn <= 50; turn++) {
      await enterText(page, `[장기 검증 ${turn}] 새로운 거래 없이 장부 ${turn}쪽을 민서와 확인한다.`);
      await page.waitForFunction(expected => turnCount === expected && !sendBtn.disabled &&
        gameHistory[gameHistory.length - 1]?._stateExtract?.status === 'applied', turn);
      await drainDialogue(page);
      if (turn === 25) {
        await page.waitForFunction(() => !window._summaryPending);
        checkpoint = await page.evaluate(() => ({ state: JSON.parse(JSON.stringify(gameState)),
          summary: storySummary, boundary: summaryIndex, dropped: histDropped, turn: turnCount }));
        await openSlots(page);
        await page.locator('#slotList .slot-item').first().getByRole('button', { name: '저장', exact: true }).click();
        await page.locator('#slotPanel .my-btn').click();
      }
    }
    await page.waitForFunction(() => !window._summaryPending);
    const memory = await page.evaluate(() => ({ gold: gameState.gold, turn: turnCount,
      summary: storySummary, history: gameHistory.length, dropped: histDropped,
      remaining: gameHistory.length - summaryIndex, currentWindow: recentWindowCount(),
      guideKnows: gameState.metChars.guide?.knows || '', friendKnows: gameState.metChars.friend?.knows || '',
      pending: !!pendingStateExtractEntry() }));
    assert.equal(memory.turn, 50); assert.equal(memory.gold, 7);
    assert.ok(memory.dropped > 0, 'long test never crossed the history trim boundary');
    assert.ok(memory.history <= 60, 'successfully summarized history grew beyond its retention cap');
    assert.ok(memory.currentWindow >= memory.remaining, 'unsummarized original text was omitted from the next prompt');
    assert.ok(memory.summary.includes(LONG_PROMISE));
    assert.ok(memory.guideKnows.includes('오전 10시'));
    assert.ok(!memory.friendKnows.includes('오전 10시'), 'private knowledge was assigned to the absent character');
    assert.equal(memory.pending, false);
    assert.equal(net.calls.filter(call => call.kind === 'main').length, 50);
    assert.equal(net.calls.filter(call => call.kind === 'state').length, 50);
    assert.ok(net.calls.filter(call => call.kind === 'summary').length >= 5, 'long test did not exercise repeated memory updates');
    const lastMain = net.prompts.filter(prompt => prompt.kind === 'main').at(-1);
    assert.ok(lastMain.messages.some(message => message.content.includes(LONG_PROMISE)),
      'the retained promise never reached the actual main request');
  });
  await check(ctx, 'interrupted turn survives browser reload and a 25-turn slot restores its exact memory without a new scene', async () => {
    net.nextStateStatus = 503;
    await enterText(page, '[장기 검증 51] 새로운 거래 없이 장부 51쪽을 민서와 확인한다.');
    await page.waitForFunction(() => turnCount === 51 && !sendBtn.disabled &&
      gameHistory[gameHistory.length - 1]?._stateExtract?.status === 'failed');
    await drainDialogue(page);
    await flushLocalSave(page);
    const mainBefore = net.calls.filter(call => call.kind === 'main').length;
    const stateBefore = net.calls.filter(call => call.kind === 'state').length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('mainScreen')?.style.display === 'flex');
    await page.locator('.enter-btn').click();
    await page.locator('#introScreen').waitFor({ state: 'hidden' });
    await page.locator('#tabMy').click();
    await page.locator('#myStories .play-item').filter({ hasText: LONG_STORY_FIXTURE.title }).click();
    await page.locator('#detailContinueBtn').click();
    await waitGold(page, 7);
    assert.equal(await page.evaluate(() => turnCount), 51);
    assert.equal(net.calls.filter(call => call.kind === 'main').length, mainBefore, 'reload generated the story a second time');
    assert.equal(net.calls.filter(call => call.kind === 'state').length, stateBefore + 1,
      'persisted failed receipt did not resume exactly once');
    const callsBefore = net.calls.length;
    await openSlots(page);
    await page.locator('#slotList .slot-item').first().getByRole('button', { name: '불러오기', exact: true }).click();
    await waitGold(page, 7);
    const restored = await page.evaluate(() => ({ state: JSON.parse(JSON.stringify(gameState)),
      summary: storySummary, boundary: summaryIndex, dropped: histDropped, turn: turnCount }));
    assert.deepEqual(restored, checkpoint, 'slot restore mixed a later scene or summary into an earlier checkpoint');
    assert.equal(net.calls.length, callsBefore, 'restoring a completed slot called a model');
    await page.evaluate(() => {
      window._bgDuringGen = true; window._bgGenScope = turnWorkScope();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(850);
    assert.equal(net.calls.length, callsBefore, 'synthetic foreground return generated a completed turn again');
  });
}


const HOGWARTS_CAPTURE_SCENE='루핀은 결박된 페티그루의 지팡이를 회수했다. 도주를 막은 일행은 목격 증거와 함께 그를 마법부 경비대에 인계했다.';
function hogwartsArtReply(kind, user = '', body = {}) {
  if(user.includes('[의상 검증]')){
    if(kind!=='main') return {state_update:{},choices:[],chronicle:[]};
    const npc=user.slice(user.lastIndexOf('[의상 검증]')).includes('헤르미온느가 크룸과 춤춘다.');
    return {background:'ballroom',cg:'hermione/dance',narration:'무도회 음악이 조용히 흐른다.',
      dialogue:[{char_id:'hermione',speaker:'헤르미온느',emotion:'smile',text:npc?'난 크룸과 춤추러 갈게.':'좋아. 이번 곡은 너랑 출게.'}],
      visuals:{cgPartner:npc?'krum':'player',cgConsent:'mutual'},mood:null};
  }
  const input=/\[플레이어 입력\] ([\s\S]*?)\n\[본편 응답/.exec(user)?.[1]||user;
  const capture=/페티그루.{0,50}구금/.test(input);
  const switched=input.includes('약속을 취소')&&input.includes('말포이');
  const sleeping=/침실에서 잠을 잔다/.test(input);
  const narration=capture?HOGWARTS_CAPTURE_SCENE:switched
    ?'헤르미온느는 취소를 듣고 책을 덮었다. 말포이는 빈 의자를 내주며 모임에 온 당신을 맞았다.'
    :sleeping?'기숙사 침대에서 잠든 뒤 다음 날 아침에 눈을 떴다.'
    :'대연회장에서 분류가 끝나고 학생들이 이야기를 나눈다.';
  if (kind !== 'main') {
    const system=body.messages?.find(x=>x.role==='system')?.content||'';
    const event=/event_id는 (null|"[^"]+")이다/.exec(system);
    const button=capture&&input.includes('[호그와트 사건 진행 중 플레이어의 실제 개입]');
    const evidence=capture?'리무스 루핀: 신병을 인계했네.':narration;
    return {state_update:{event:null,hogwarts:{event_id:event?JSON.parse(event[1]):null,
      summary:narration,evidence,complete:capture||switched||sleeping,
      choice:capture?(button?'capture':'freeform'):switched?'malfoy':null,
      ties:capture?{lupin:2,harry:2}:switched?{hermione:-1,malfoy:2}:{},
      canon:capture&&!button?[{id:'b03c20s01',outcome:'prevented',
        summary:'페티그루가 구금되어 원작 탈출이 발생하지 않았다.',evidence,effects:{pettigrew_captured:true}}]:[],
      ...(sleeping?{time:{value:'1991-09-04 아침',days:1,evidence:narration}}:{})}},
      choices:['친구들에게 인사한다'],chronicle:[]};
  }
  return {
    ...(sleeping ? {time:'1991년 9월 4일 아침'} : {}),
    narration,
    dialogue: capture?[{char_id:'lupin',speaker:'lupin',text:'신병을 인계했네.'},
      {char_id:'harry',speaker:'해리 포터',text:'도망치지 못했어.'}]:switched?[
      {char_id:'hermione',speaker:'헤르미온느',text:'알겠어. 난 여기서 공부할게.'},
      {char_id:'malfoy',speaker:'드레이코 말포이',text:'이쪽으로 와.'}]:[
      { char_id: 'mcgonagall', speaker: '맥고나걸 교수', emotion: 'normal', text: '슬리데린에 오신 것을 환영합니다.' },
      { char_id: 'malfoy', speaker: '드레이코 말포이', emotion: 'smile', text: '반가워. 길을 알아둘 필요는 있겠지.' },
      { char_id: 'hermione', speaker: '헤르미온느', emotion: 'smile', text: '책은 도서관에 있을 거야.' },
      { char_id: 'ron', speaker: '론 위즐리', emotion: 'sad', text: '퍼시 형한테 또 한소리 듣겠네.' },
      { char_id: 'harry', speaker: '해리', emotion: 'angry', text: '일단 사실부터 확인하자.' }
    ],
    background: 'great_hall', mood: null, cg: null, ending: null, combat: false
  };
}

async function hogwartsRPCheck(ctx){
  const {page,net}=ctx;
  await check(ctx,'Hogwarts arrival accepts a real interruption without a forced corridor jump',async()=>{
    await page.locator('[onclick="openStoryDetail(\'hogwarts\')"]:visible').first().click();
    await page.locator('#detailNewBtn').click();
    await drainDialogue(page);
    await page.locator('#choiceBox .choice-btn').filter({hasText:'스토리 모드'}).click();
    await page.waitForFunction(()=>window._startPhase==='setup');
    await enterText(page,FIRST_INPUT);
    await page.waitForFunction(()=>window._startPhase==='hogwarts_sort');
    await drainDialogue(page);
    await page.locator('#choiceBox .choice-btn').filter({hasText:'그리핀도르'}).click();
    for(let i=0;i<20;i++){
      if(await page.evaluate(()=>gameState.hogwarts.scene.paused&&inputMode&&!isShowing&&dialogueQueue.length===0))break;
      await page.evaluate(()=>navNext());await page.waitForTimeout(50);
    }
    assert(await page.locator('#inputBar').isVisible());
    assert.equal(await page.evaluate(()=>!!gameState.hogwarts.scene.visited.arrival_speech),false);
    await page.locator('#userInput').fill('교수님, 연설 전에 학교생활에 관해 질문해도 될까요?');
    await page.locator('#sendBtn').click();
    await drainDialogue(page);
    await page.waitForFunction(()=>gameHistory.at(-1)?._stateExtract?.status==='applied');
    assert.deepEqual(await page.evaluate(()=>({phase:gameState.hogwarts.scene.phase,
      queued:gameState.hogwarts.scene.queue.length,room:!!gameState.hogwarts.scene.visited.arrival_common_room,
      place:gameState.location})),{phase:'idle',queued:0,room:false,place:'호그와트 대연회장'});
  });
  await check(ctx,'Hogwarts click and free text commit the same causal world through the real recorder',async()=>{
    const worlds=[];
    for(const input of ['button','typed']){
      await page.evaluate(async()=>{
        await ensureStateExtractReady();
        const hp=gameState.hogwarts;
        hp.date='1994-06-15';hp.slot=3;hp.scene=PandoraHogwartsScenes.createState();
        hp.world=PandoraHogwartsWorld.createState();
        hp.world.agency={dementor:'study',chapter_b03c08:'inquire',chapter_b03c13:'engage'};
        hp.canon=PandoraHogwartsBridge.sync(HOGWARTS_CANON_BUNDLE,null,'1994-06-14',[]).state;
        PandoraHogwartsWorld.offer(hp.world,PandoraHogwartsWorld.EVENTS.find(x=>x.id==='pettigrew_crossroads'));
        PandoraHogwartsWorld.startAmbient(hp.world);
        gameState.time=PandoraHogwartsTime.display(hp);gameState.location='비명을 지르는 오두막';
        gameState.event='비명을 지르는 오두막의 비밀';
        document.getElementById('choiceBox')?.remove();
        showChoices(PandoraHogwartsWorld.activeChoices(hp.world));
      });
      const held={reached:deferred(),resume:deferred()};net.holdState=held;
      try{
        if(input==='button')await page.locator('#choiceBox .choice-btn').filter({hasText:'확보한 목격 증거'}).click();
        else await enterText(page,'확보한 목격 증거와 루핀의 도움으로 페티그루를 구금한다');
        await held.reached.promise;
        assert.equal(await page.evaluate(async()=>{await syncHogwartsCanon();return gameState.hogwarts.canon.statuses.b03c20s01||null;}),null,
          'canon must wait for the displayed action receipt');
      }finally{held.resume.release();}
      await page.waitForFunction(()=>gameHistory.at(-1)?._stateExtract?.status==='applied'&&!sendBtn.disabled);
      await drainDialogue(page);
      const state=await page.evaluate(async()=>{
        await syncHogwartsCanon();
        const hp=gameState.hogwarts;
        PandoraHogwartsTime.moveToScene(hp,'1995-06-24',2);
        await syncHogwartsCanon();
        gameState.time=PandoraHogwartsTime.display(hp);autoSave();
        return {escape:hp.canon.statuses.b03c20s01,ritual:hp.canon.statuses.b04c32s02,
          captured:hp.canon.world.pettigrew_captured,ties:hp.world.ties,active:hp.world.active};
      });
      assert.deepEqual(state,{escape:'prevented',ritual:'altered',captured:true,ties:{lupin:2,harry:2},active:null});
      worlds.push(state);
    }
    assert.deepEqual(worlds[0],worlds[1]);
    await flushLocalSave(page);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('mainScreen')?.style.display==='flex');
    await page.locator('.enter-btn').click();
    await page.locator('[onclick="openStoryDetail(\'hogwarts\')"]:visible').first().click();
    await page.locator('#detailContinueBtn').click();
    await drainDialogue(page);
    assert.deepEqual(await page.evaluate(()=>({captured:gameState.hogwarts.canon.world.pettigrew_captured,
      ritual:gameState.hogwarts.canon.statuses.b04c32s02})),{captured:true,ritual:'altered'});
  });
  await check(ctx,'Hogwarts a cancelled study plan records the actual meeting and relationship',async()=>{
    await page.evaluate(async()=>{
      await syncHogwartsCanon();
      const hp=gameState.hogwarts;
      hp.date='1991-09-03';hp.slot=2;hp.world=PandoraHogwartsWorld.createState();
      hp.canon=PandoraHogwartsBridge.sync(HOGWARTS_CANON_BUNDLE,null,'1991-09-02',[]).state;
      const p=PandoraHogwartsWorld.offer(hp.world,PandoraHogwartsWorld.EVENTS.find(x=>x.id==='first_invitations'));
      PandoraHogwartsWorld.start(hp.world,p.choices.find(x=>x.includes('] hermione —')));
      gameState.time=PandoraHogwartsTime.display(hp);gameState.event='겹친 약속';
      document.getElementById('choiceBox')?.remove();enterInputMode();
    });
    await enterText(page,'헤르미온느에게 약속을 취소한다고 말하고 말포이의 모임에 간다.');
    await page.waitForFunction(()=>gameHistory.at(-1)?._stateExtract?.status==='applied');
    await drainDialogue(page);
    assert.deepEqual(await page.evaluate(()=>({circle:gameState.hogwarts.world.agency.first_circle,
      ties:gameState.hogwarts.world.ties})),{circle:'malfoy',ties:{hermione:-1,malfoy:2}});
  });
}

async function hogwartsArtCheck(ctx) {
  const { page } = ctx;
  await check(ctx, 'Hogwarts opens from the library and loads its own WebP portraits and house rooms', async () => {
    await page.locator('[onclick="openStoryDetail(\'hogwarts\')"]:visible').first().click();
    assert.match(await page.locator('#detailCover').getAttribute('style'), /hogwarts_courtyard_portrait\.webp/);
    const gallery = await page.locator('#detailChars .d-char').evaluateAll(cards => cards.map(card => ({
      name: card.querySelector('.d-char-name').textContent,
      image: card.querySelector('.d-char-img').style.backgroundImage
    })));
    assert.equal(gallery.length, 12);
    assert.match(gallery[0].name, /해리/);
    assert.match(gallery[0].image, /harry\/2d\/1_neutral_v2\.webp/);
    assert.match(gallery[2].name, /헤르미온느/);
    assert.match(gallery[2].image, /hermione\/2d\/1_neutral_v2\.webp/);
    assert.ok(gallery.every(card => card.image.includes('sd_samples/characters/hogwarts/')));
    await page.locator('#detailChars .d-char').first().click();
    await page.waitForFunction(() => document.querySelector('#imgViewerImg')?.naturalWidth > 0);
    await page.evaluate(() => closeImgViewer());
    await page.locator('#detailNewBtn').click();
    await page.waitForFunction(() => window._startPhase === 'mode');
    await drainDialogue(page);
    await page.locator('#choiceBox .choice-btn').filter({ hasText: '스토리 모드' }).click();
    await page.waitForFunction(() => window._startPhase === 'setup');
    await enterText(page, FIRST_INPUT);
    await page.waitForFunction(() => window._startPhase === 'hogwarts_sort');
    const profileAfterSetup=await page.evaluate(()=>({
      source:gameState.hogwarts.magic.profile?.description,
      aptitude:gameState.hogwarts.magic.profile?.aptitude?.general,
      name:gameState.name
    }));
    assert.match(profileAfterSetup.source,/차분한 도서관 방문객/);
    assert.equal(profileAfterSetup.aptitude,50,'ordinary setup stays ordinary');
    assert.equal(profileAfterSetup.name,'검증자');
    await drainDialogue(page);
    await page.locator('#choiceBox .choice-btn').filter({ hasText: '슬리데린' }).click();
    await page.waitForFunction(() => gameState.hogwarts.house === '슬리데린' && !sendBtn.disabled);
    // New Hogwarts opening: the headmaster's welcome, feast, prefect escort
    // and the Slytherin entrance all play as ordinary narration (no choice).
    await drainDialogue(page);
    const arrival=await page.evaluate(() => ({
      finished:gameState.hogwarts.scene.arrivalCompleted,
      visited:gameState.hogwarts.scene.visited,
      bg:currentBgFile,
      speakers:dialogueLog.map(x=>x.speaker)
    }));
    assert.equal(arrival.finished,true);
    assert(arrival.visited.arrival_speech && arrival.visited.arrival_feast &&
      arrival.visited.arrival_entrance && arrival.visited.arrival_common_room);
    assert.equal(arrival.bg,'slytherin_common_room');
    assert(arrival.speakers.some(x=>x==='덤블도어'));
    assert(arrival.speakers.some(x=>x==='슬리데린 반장'));
    const controls = await page.locator('#choiceBox .choice-btn').allTextContents();
    assert.ok(controls.every(text => !/다음 장면|장면 마치기|마법 도감/.test(text)));
    await chooseHogwartsMenu(page,'다음 장면');
    await waitForStoryChoice(page,'헤르미온느와 도서관');
    assert.equal(await page.evaluate(() => gameState.hogwarts.world.active?.choice), 'observe');
    assert.ok((await page.locator('#choiceBox').innerText()).indexOf('[first_invitations]') === -1);
    await enterText(page,'말포이, 먼저 무슨 모임인지 듣고 결정할게.');
    await drainDialogue(page);
    assert.ok(await page.evaluate(() => gameState.hogwarts.world.active.actions
      .includes('말포이, 먼저 무슨 모임인지 듣고 결정할게.')));
    await page.locator('#choiceBox .choice-btn').filter({hasText:'헤르미온느와 도서관'}).click();
    await drainDialogue(page);
    try {
      await page.waitForFunction(() => ['harry', 'ron'].every(id => document.getElementById('sprite_' + id)?.naturalWidth === 1024)
        && bgLayer.style.backgroundImage.includes('great_hall_portrait.webp'),null,{timeout:22000});
    } catch(error) {
      const state=await page.evaluate(()=>({
        date:gameState?.hogwarts?.date,
        scene:gameState?.hogwarts?.scene,
        worldActive:gameState?.hogwarts?.world?.active,
        currentBgFile,background:bgLayer.style.backgroundImage,
        sprites:['harry','ron'].map(id=>({id,src:document.getElementById('sprite_'+id)?.src,
          width:document.getElementById('sprite_'+id)?.naturalWidth})),
        choices:[...document.querySelectorAll('#choiceBox .choice-btn')].map(x=>x.textContent),
        inputMode,isShowing,waitingForTap,queued:dialogueQueue.length,
        recent:gameHistory.slice(-2).map(x=>String(x.content||'').slice(0,80))
      }));
      throw new Error('Hogwarts art/story transition never resolved: '+JSON.stringify(state)+'; '+error.message);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('#charLayer img')]
      .every(img => getComputedStyle(img).opacity === '1'));
    const scene = await page.evaluate(() => ({
      art: [...document.querySelectorAll('#charLayer img')].map(img => [img.id, img.getAttribute('src'), img.naturalWidth]),
      bg: bgUrlFor(currentBgFile), dorm: bgUrlFor('dormitory'), room: bgUrlFor('common_room'),
      filters: [bgLayer, document.getElementById('bgLayerB')].map(el => getComputedStyle(el).filter)
    }));
    const firstTurn = ctx.net.prompts.find(call => call.kind === 'main');
    assert.ok(firstTurn, 'the opening scene reached the model prompt');
    const voiceCues=await page.evaluate(()=>Object.fromEntries(['hermione','malfoy','crabbe','goyle']
      .map(id=>[id,CHARACTERS[id].speech])));
    for(const [id,cue] of Object.entries(voiceCues)){
      assert(cue,id+' voice cue must exist');
      assert(firstTurn.messages.some(message=>message.content.includes(cue)),id+' voice must reach the actual model request');
    }
    const system = firstTurn.messages[0].content;
    assert.match(system, /여성 말포이는 해리를 명성과 기숙사 경쟁의 맞수로 대하고/);
    assert.match(system,/현재 인물 카드.*과거에 잘못 생성된 어조보다 우선/);
    assert.match(system, /말포이는 경쟁 구도 속에서도 해리에게 사적인 호감/);
    assert.match(system, /서로 신뢰와 마음을 확인해 나가면 연애로 이어질 수 있다/);
    assert.ok(firstTurn.messages.some(message => message.content.includes('친구 무리로 굳어지기 전')),
      'the opening model prompt did not receive the unformed trio state');
    assert.equal(scene.bg, 'sd_samples/backgrounds/hogwarts/great_hall_portrait.webp');
    assert.equal(scene.dorm, 'sd_samples/backgrounds/hogwarts/slytherin_dormitory_portrait.webp');
    assert.equal(scene.room, 'sd_samples/backgrounds/hogwarts/slytherin_common_room_portrait.webp');
    assert.equal(scene.art.length, 2);
    assert.deepEqual(scene.filters, ['blur(6px) brightness(0.78)', 'blur(6px) brightness(0.78)']);
    assert.ok(scene.art.every(([,src,width]) => src.startsWith('sd_samples/characters/hogwarts/') && width === 1024));
    assert.ok(scene.art.some(([id,src]) => id === 'sprite_harry' && src.endsWith('/3_anger_v4.webp')));
    assert.ok(scene.art.some(([id,src]) => id === 'sprite_ron' && src.endsWith('/4_sadness_v6.webp')));
    await page.screenshot({ path: path.join(ARTIFACTS, 'hogwarts-opening-' + (ctx.mobile ? 'mobile' : 'desktop') + '.png') });
    const houseScenes = await page.evaluate(async () => {
      const previous = gameState.hogwarts.house;
      const scenes = {};
      try {
        for (const house of ['그리핀도르', '슬리데린', '레번클로', '후플푸프']) {
          gameState.hogwarts.house = house;
          scenes[house] = await Promise.all(['common_room', 'dormitory'].map(async key => {
            const img = new Image();
            img.src = bgUrlFor(key);
            await img.decode();
            return { filename: img.src.split('/').pop(), isPortrait: img.naturalHeight > img.naturalWidth };
          }));
        }
      } finally {
        gameState.hogwarts.house = previous;
      }
      return scenes;
    });
    for (const [house, slug] of Object.entries({ 그리핀도르: 'gryffindor', 슬리데린: 'slytherin', 레번클로: 'ravenclaw', 후플푸프: 'hufflepuff' })) {
      assert.deepEqual(houseScenes[house], ['common_room', 'dormitory'].map(key => ({
        filename: `${slug}_${key}_portrait.webp`, isPortrait: true
      })));
    }
    // Old four-person history must restore the current speaker within the two-person stage.
    const restored = await page.evaluate(() => {
      rebuildSprites(['harry', 'ron', 'hermione', 'malfoy'], 'harry', 'normal', 'upper');
      return { ids: [...shownSprites], speaker: document.querySelector('.char-sprite.speaking')?.id };
    });
    assert.deepEqual(restored.ids, ['malfoy', 'harry']);
    assert.equal(restored.speaker, 'sprite_harry');
    const missingSpeaker = await page.evaluate(() => {
      rebuildSprites(['crabbe'], 'malfoy', 'normal', 'upper');
      return { ids: [...shownSprites], speaker: document.querySelector('.char-sprite.speaking')?.id };
    });
    assert.deepEqual(missingSpeaker.ids, ['crabbe', 'malfoy']);
    assert.equal(missingSpeaker.speaker, 'sprite_malfoy');
    const rolled = await page.evaluate(() => {
      ensureSprite('ron'); highlightSpeaker('ron', 'normal', 'upper');
      ensureSprite('harry'); highlightSpeaker('harry', 'normal', 'upper');
      ensureSprite('hermione'); highlightSpeaker('hermione', 'smile', 'upper');
      return [...shownSprites];
    });
    assert.deepEqual(rolled, ['harry', 'hermione']);
    await page.evaluate(() => {
      // Rendering asset assay: the actual entrance gate is tested above and
      // in tests-hogwarts-scenes. Mark it completed before setting the room
      // background directly in this isolated visual/sprite test.
      gameState.hogwarts.scene.lastLocation='slytherin_common_room';
      setBg('common_room');
      rebuildSprites(['fred', 'aberforth'], 'fred', 'angry', 'upper');
    });
    await page.waitForFunction(() => document.getElementById('sprite_fred')?.naturalWidth > 0 &&
      bgLayer.style.backgroundImage.includes('slytherin_common_room_portrait.webp'));
    assert.equal(await page.locator('#sprite_aberforth').count(), 0);
    assert.match(await page.locator('#sprite_fred').getAttribute('src'), /fred\/2d\/1_neutral\.webp$/);
    await page.evaluate(() => rebuildSprites(['crabbe', 'goyle'], 'goyle', 'sad', 'upper'));
    await page.waitForFunction(() =>
      document.getElementById('sprite_crabbe')?.naturalWidth === 1024 &&
      document.getElementById('sprite_goyle')?.naturalWidth === 1024);
    assert.match(await page.locator('#sprite_goyle').getAttribute('src'), /goyle\/2d\/4_sadness\.webp$/);
    for (const [id, emotion, file] of [
      ['harry', 'angry', '3_anger_v4'],
      ['george', 'smile', '2_joy_v2'],
      ['kingsley', 'smile', '2_joy_v2'],
      ['moody', 'smile', '2_joy_v2'],
      ['theodore', 'normal', '1_neutral_v2'],
      ['hermione', 'normal', '1_neutral_v2'],
      ['hermione', 'smile', '2_joy_v2'],
      ['hermione', 'angry', '3_anger_v2'],
      ['hermione', 'sad', '4_sadness_v2'],
      ['hermione', 'pleasure', '5_pleasure_v2'],
      ['hermione', 'pain', '6_pain_v2'],
    ]) {
      await page.evaluate(id => rebuildSprites(['malfoy', id], id, 'normal', 'upper'), id);
      await page.waitForFunction(id => {
        const img = document.getElementById('sprite_' + id);
        return img?.naturalWidth === 1024 && img.style.getPropertyValue('--arScale');
      }, id);
      const before = await page.locator('#sprite_' + id).evaluate(img => Number(img.style.getPropertyValue('--arScale')));
      await page.evaluate(({ id, emotion }) => highlightSpeaker(id, emotion, 'upper'), { id, emotion });
      await page.waitForFunction(({ id, file }) => {
        const img = document.getElementById('sprite_' + id);
        return img?.currentSrc.endsWith('/' + file + '.webp') && img.complete && img.naturalWidth === 1024;
      }, { id, file });
      const after = await page.locator('#sprite_' + id).evaluate(img => Number(img.style.getPropertyValue('--arScale')));
      assert.ok(Math.abs(before - after) <= 0.13, id + ' jumps in size when its expression changes');
      assert.equal(await page.locator('#charLayer img').count(), 2);
      if (ctx.mobile) await page.screenshot({ path: path.join(ARTIFACTS, id + '-' + emotion + '-mobile.png') });
    }
  });
  await check(ctx, 'saved speaker names restore their own portraits and entrance actions stay narration', async () => {
    const restored = await page.evaluate(() => {
      const start = dialogueLog.length;
      const lines = [
        {speaker:'드레이코 말포이',char_id:null,sprites:['crabbe'],text:'진짜로 올 줄은 몰랐는데.'},
        {speaker:'빈센트 크래브',char_id:'malfoy',sprites:['hermione'],text:'말포이, 굳이 부를 필요가 있었어?'},
        {speaker:'퍼시 위즐리',char_id:'percy',sprites:['percy'],
          text:PandoraHogwartsScenes.HOUSES['그리핀도르'].arrival.answer},
      ];
      dialogueLog.push(...lines);
      const result = lines.map((line, i) => {
        historyPos = start + i;
        renderHistoryEntry();
        return {speaker:line.speaker,id:line.char_id,
          sprite:document.querySelector('.char-sprite.speaking')?.id || null,
          narrator:document.getElementById('nameplate').classList.contains('narrator')};
      });
      dialogueLog.splice(start);
      return result;
    });
    assert.deepEqual(restored, [
      {speaker:'드레이코 말포이',id:'malfoy',sprite:'sprite_malfoy',narrator:false},
      {speaker:'빈센트 크래브',id:'crabbe',sprite:'sprite_crabbe',narrator:false},
      {speaker:'나레이터',id:null,sprite:null,narrator:true},
    ]);
    // Replay a received line so the visual proof checks its name and portrait together.
    await page.evaluate(() => {
      historyPos=dialogueLog.findLastIndex(line=>line.char_id==='hermione' && line.text==='책은 도서관에 있을 거야.');
      if(historyPos<0) throw new Error('Received Hermione dialogue missing from history');
      renderHistoryEntry();
    });
    await page.waitForFunction(()=>document.querySelector('.char-sprite.speaking')?.id==='sprite_hermione' &&
      document.getElementById('sprite_hermione')?.naturalWidth===1024 &&
      document.getElementById('sprite_hermione')?.currentSrc.endsWith('/2_joy_v2.webp'));
    assert.match(await page.locator('#nameplate').innerText(),/헤르미온느/);
    assert.equal(await page.locator('#dialogueText').innerText(),'책은 도서관에 있을 거야.');
    if(ctx.mobile) await page.screenshot({path:path.join(ARTIFACTS,'hermione-dialogue-mobile.png')});
    await page.evaluate(()=>{historyPos=dialogueLog.length-1;renderHistoryEntry();});
  });
  await check(ctx, 'Hogwarts spellbook, first lesson and magic-only state save', async () => {
    await drainDialogue(page);
    // Spellbook is now tested independently after the cinematic art fixture.
    // This keeps the first canonical scene and model art checks unchanged.
    const magicLoaded=await page.evaluate(() => ({
      exists:!!window.PandoraHogwartsMagic,subjectCount:PandoraHogwartsMagic.SUBJECTS.length,
      spellCount:PandoraHogwartsMagic.SPELLS.length,study:gameState.hogwarts.magic
    }));
    assert.equal(magicLoaded.exists,true);
    assert.equal(magicLoaded.subjectCount,14);
    assert.equal(magicLoaded.spellCount,51);
    assert.equal(magicLoaded.study.schemaVersion,1);
    await chooseHogwartsMenu(page,'마법 도감');
    await drainDialogue(page);
    await page.waitForFunction(() => !window._inputRequest && !sendBtn.disabled);
    await page.locator('#choiceBox .choice-btn').filter({hasText:'마법 수업'}).first().click();
    await waitForStoryChoice(page,'마법 연습 — 지팡이 빛');
    await page.locator('#choiceBox .choice-btn').filter({hasText:'마법 연습 — 지팡이 빛'}).first().click();
    await page.waitForFunction(() => (gameState?.hogwarts?.magic?.spells?.lumos?.xp||0)>0);
    await drainDialogue(page);
    const firstNight=await page.evaluate(() => ({
      xp:gameState.hogwarts.magic.spells.lumos?.xp||0,
      date:gameState.hogwarts.date,
      last:dialogueText.textContent
    }));
    assert.equal(firstNight.date,'1991-09-03');
    assert(firstNight.xp>0,'spell lesson after school begins must record practice');
    await page.locator('#choiceBox .choice-btn').filter({hasText:'마법 메뉴 닫기'}).first().click();
    await drainDialogue(page);
  });
  await check(ctx, 'Hogwarts prodigy profile loaded in both desktop and mobile engine', async () => {
    const result=await page.evaluate(()=>{
      const M=window.PandoraHogwartsMagic,P=window.PandoraHogwartsProfile;
      const state=M.createState('1991-09-01');
      const desc='나는 호그와트 역사상 가장 뛰어난 마법적 재능을 가진 천재다. 어둠의 마법에 천부적인 소질이 있다. 하지만 능력을 숨긴다.';
      const profile=P.configure(state,desc,{spells:M.SPELLS,worldMode:'canon_centered'});
      const blocked=M.cast(state,'crucio',{date:'1991-09-03'});
      const learned=M.lesson(state,'accio',{date:'1991-09-03',location:'호그와트 도서관',
        selfStudy:true,studyMethod:'book'});
      const known=state.profile.knownBy;
      const parsed=P.parseSetup(desc,'신입생');
      const serialized=JSON.parse(JSON.stringify(state));
      return {exists:!!P, aptitude:profile.aptitude.general,dark:profile.aptitude.dark,
        conceal:profile.concealAbilities,world:profile.worldMode,
        blocked:blocked.ok,learned:learned.ok,known:Object.keys(known).length,
        parsed:parsed.description,restore:P.ensure(serialized).aptitude.general};
    });
    assert.equal(result.exists,true);
    assert.equal(result.aptitude,100);
    assert.equal(result.dark,100);
    assert.equal(result.conceal,true);
    assert.equal(result.world,'canon_centered');
    assert.equal(result.blocked,false);
    assert.equal(result.learned,true);
    assert.equal(result.known,0);
    assert.match(result.parsed,/호그와트 역사상/);
    assert.equal(result.restore,100);
  });
  await check(ctx, 'Hogwarts rapid background updates reject stale crossfade callbacks', async()=>{
    await page.evaluate(()=>{setBg('corridor');setBg('great_hall');});
    await page.waitForTimeout(1200);
    const bg=await page.evaluate(()=>({
      key:currentBgFile,actual:bgLayer.style.backgroundImage,
      fading:_bgFading,revision:_bgTransitionRevision
    }));
    assert.equal(bg.key,'great_hall','scene state must retain final destination');
    assert.match(bg.actual,/great_hall_portrait\.webp/,
      'stale image preload/fade must never overwrite the latest background');
  });
  await check(ctx, 'Hogwarts roleplay sleep advances the saved date without a scene control', async () => {
    const before = await page.evaluate(() => gameState.hogwarts.date);
    await enterText(page,'내일은 무슨 수업이야?');
    await drainDialogue(page);
    assert.equal(await page.evaluate(() => gameState.hogwarts.date),before,'a future plan keeps the current date');
    await enterText(page,'(침실에서 잠을 잔다.)');
    await drainDialogue(page);
    assert.deepEqual(await page.evaluate(() => ({date:gameState.hogwarts.date,
      slot:gameState.hogwarts.slot,active:gameState.hogwarts.world.active})),
      {date:'1991-09-04',slot:0,active:null});
    await flushLocalSave(page);
    assert.equal(await page.evaluate(() => JSON.parse(bulkGet(saveKeyFor(STORY.id))).gameState.hogwarts.date),
      '1991-09-04');
  });
}

async function appUpdateChecks(ctx){
  const {page,context}=ctx;
  const loaded=await page.evaluate(()=>APP_BUILD);
  const fixture={loaded,latest:loaded,status:200,etag:'"same-content"'};
  await context.route('**/app-build.json?*',route=>route.fulfill({status:fixture.status,
    contentType:'application/json',headers:{ETag:fixture.etag},body:JSON.stringify({build:fixture.latest})}));
  await context.route('**/novel.html*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/(<meta name="pandora-build" content=")[a-f0-9]{64}(">)/,
      (_match,before,after)=>before+fixture.loaded+after);
    await route.fulfill({response,body});
  });
  await check(ctx,'same loaded app ignores compressed ETags, resume and failed update checks',async()=>{
    const before=page.url();
    for(const etag of ['"same-content"','W/"same-content"','"new-deploy-identical-code"']){
      fixture.etag=etag;
      assert.equal(await page.evaluate(()=>checkAppUpdate()),false);
      assert.equal(await page.locator('#appUpdateBanner').count(),0);
    }
    const checked=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/app-build.json'));
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await checked;
    assert.equal(page.url(),before,'same-version bfcache resume must not replace the page');
    fixture.status=503;
    assert.equal(await page.evaluate(()=>checkAppUpdate()),false);
    fixture.status=200;
    assert.equal(await page.evaluate(()=>checkAppUpdate()),false);
    assert.equal(await page.locator('#appUpdateBanner').count(),0);
  });
  await check(ctx,'new code on a cached first load shows one readable dismissible update banner',async()=>{
    fixture.latest='b'.repeat(64);
    assert.equal(await page.evaluate(()=>checkAppUpdate()),true);
    await page.evaluate(()=>checkAppUpdate());
    assert.equal(await page.locator('#appUpdateBanner').count(),1);
    await page.getByRole('button',{name:'갱신 알림 닫기'}).click();
    await page.evaluate(()=>checkAppUpdate());
    assert.equal(await page.locator('#appUpdateBanner').count(),0);
    fixture.latest='c'.repeat(64);
    await page.evaluate(()=>checkAppUpdate());
    const viewport=page.viewportSize();
    await page.setViewportSize({width:320,height:viewport.height});
    const banner=await page.locator('#appUpdateBanner').boundingBox();
    const button=page.locator('#appUpdateBanner').getByRole('button',{name:'갱신',exact:true});
    assert(banner.x>=8&&banner.x+banner.width<=312,'banner must fit a narrow phone');
    assert.equal(await button.evaluate(e=>getComputedStyle(e).whiteSpace),'nowrap');
    const bounds=await button.boundingBox();assert(bounds.width>bounds.height,'갱신 must remain one horizontal label');
    await page.setViewportSize(viewport);
    await page.screenshot({path:path.join(ARTIFACTS,'app-update-banner-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
  });
  await check(ctx,'actual update navigation preserves the local career and does not repeat the banner',async()=>{
    await page.evaluate(()=>autoSave());await flushLocalSave(page);
    const snapshot=()=>page.evaluate(()=>({name:playerName,desc:playerDesc,date:gameState.hogwarts.date,
      house:gameState.hogwarts.house,profile:gameState.hogwarts.magic.profile,turns:turnCount,
      summary:storySummary,gold:gameState.gold,model:OPENROUTER_MODEL,free:FREE_TEST_MODE}));
    const before=await snapshot(),mainCalls=ctx.net.calls.filter(c=>c.kind==='main').length,url=page.url();
    fixture.loaded=fixture.latest;
    await Promise.all([page.waitForURL(next=>next.href!==url),
      page.locator('#appUpdateBanner').getByRole('button',{name:'갱신',exact:true}).click()]);
    await page.waitForFunction(()=>document.getElementById('mainScreen')?.style.display==='flex');
    assert.equal(await page.evaluate(()=>APP_BUILD),fixture.latest);
    assert.equal(await page.evaluate(()=>checkAppUpdate()),false);
    assert.equal(await page.locator('#appUpdateBanner').count(),0);
    await page.locator('.enter-btn').click();
    await page.locator('[onclick="openStoryDetail(\'hogwarts\')"]:visible').first().click();
    await page.locator('#detailContinueBtn').click();await drainDialogue(page);
    assert.deepEqual(await snapshot(),before,'refresh must keep character, progress, ability and connection preferences');
    assert.equal(ctx.net.calls.filter(c=>c.kind==='main').length,mainCalls,'restoring an update must not request a new AI scene');
    await page.evaluate(()=>checkAppUpdate());
    assert.equal(await page.locator('#appUpdateBanner').count(),0);
    await page.screenshot({path:path.join(ARTIFACTS,'app-update-restored-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
  });
}

async function hogwartsLooksCheck(ctx){
  const {page}=ctx;
  await check(ctx,'Hogwarts Yule costumes keep their look across emotions and recorded speakers',async()=>{
    await page.evaluate(()=>{
      gameState.hogwarts.world=PandoraHogwartsWorld.createState();
      gameState.hogwarts.date='1994-12-25';gameState.hogwarts.slot=2;
      window._looksRespond=data=>{
        document.querySelectorAll('#choiceBox').forEach(e=>e.remove());
        inputMode=false;inputBar.style.display='none';waitingForTap=false;
        const reply={narration:'',choices:null,state_update:null,cg:null,...data};
        gameHistory.push({role:'assistant',content:JSON.stringify(reply)});
        processResponse(reply,(reply.dialogue||[]).map(d=>d.char_id));
      };
      window._looksRespond({background:'ballroom',dialogue:['hermione','parvati','padma','cho','ron'].map(id=>({
        char_id:id,speaker:CHARACTERS[id].name,emotion:'angry',text:CHARACTERS[id].name+'의 무도회 대사.'
      }))});
    });
    await drainDialogue(page);
    const recorded=await page.evaluate(()=>['hermione','parvati','padma','cho','ron'].map(id=>{
      const row=dialogueLog.findLast(d=>d.char_id===id&&d.text.endsWith('의 무도회 대사.'));
      return {id,outfit:row?.looks?.[id],sprite:PandoraHogwartsLooks.sprite(CHARACTERS[id],'angry',row?.looks?.[id])};
    }));
    for(const row of recorded){assert.equal(row.outfit,'yule');assert.match(row.sprite,new RegExp('/'+row.id+'/outfits/yule/'));}
    assert.match(recorded.find(row=>row.id==='ron').sprite,/ron\/outfits\/yule\/1_neutral_v2\.webp$/);
    await page.evaluate(()=>{
      historyBack();
      while(historyPos>0&&dialogueLog[historyPos].char_id!=='hermione')historyBack();
    });
    await page.waitForFunction(()=>document.getElementById('sprite_hermione')?.complete&&
      document.getElementById('sprite_hermione')?.naturalWidth>0);
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/hermione\/outfits\/yule\/1_neutral_v1\.webp$/);
    await page.screenshot({path:path.join(ARTIFACTS,'hogwarts-yule-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
    await page.evaluate(()=>exitHistory());
  });
  await check(ctx,'Hogwarts streaming never shows a player dance CG for an NPC partner',async()=>{
    await page.evaluate(()=>{
      window._looksCGCalls=[];window._looksOriginalCG=showEventCG;
      showEventCG=name=>{window._looksCGCalls.push(name);return window._looksOriginalCG(name);};
    });
    await enterText(page,'[의상 검증] 헤르미온느가 크룸과 춤춘다.');
    await drainDialogue(page);
    assert.deepEqual(await page.evaluate(()=>window._looksCGCalls),[],
      'even a transient streamed CG call must wait for partner validation');
    assert.equal(await page.evaluate(()=>currentCG),null);
    await enterText(page,'[의상 검증] 서로 동의하고 헤르미온느와 춤춘다.');
    await drainDialogue(page);
    await page.waitForFunction(()=>currentCG==='hermione/dance'&&document.getElementById('eventCG').naturalHeight>
      document.getElementById('eventCG').naturalWidth&&document.getElementById('eventCG').naturalWidth>0);
    assert.match(await page.locator('#eventCG').getAttribute('src'),/^sd_samples\/cg\/hogwarts\/hermione\/dance_v1\.webp$/);
    assert.equal(await page.locator('#eventCG').evaluate(e=>getComputedStyle(e).objectFit),'contain');
    const prompt=ctx.net.prompts.findLast(call=>call.kind==='main');
    assert(prompt.messages.some(m=>m.content.includes('cgPartner="player"')));
    await page.evaluate(()=>{showEventCG=window._looksOriginalCG;delete window._looksOriginalCG;});
    await page.screenshot({path:path.join(ARTIFACTS,'hogwarts-player-dance-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
  });
  await check(ctx,'Hogwarts saves and reloads the gown and player CG without resetting the career',async()=>{
    await flushLocalSave(page);
    const before=await page.evaluate(()=>({name:playerName,date:gameState.hogwarts.date,house:gameState.hogwarts.house,
      profile:gameState.hogwarts.magic.profile,visuals:gameState.hogwarts.visuals}));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('mainScreen')?.style.display==='flex');
    await page.locator('.enter-btn').click();
    await page.locator('[onclick="openStoryDetail(\'hogwarts\')"]:visible').first().click();
    await page.locator('#detailContinueBtn').click();
    await drainDialogue(page);
    const after=await page.evaluate(()=>({name:playerName,date:gameState.hogwarts.date,house:gameState.hogwarts.house,
      profile:gameState.hogwarts.magic.profile,visuals:gameState.hogwarts.visuals}));
    assert.deepEqual(after,before);
    assert.equal(await page.evaluate(()=>currentCG),'hermione/dance');
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/\/outfits\/yule\//);
    await page.evaluate(()=>{
      const reply={background:'library',cg:null,narration:'',choices:null,state_update:null,
        dialogue:[{char_id:'hermione',speaker:'헤르미온느',text:'책은 여기 있어.',emotion:'normal'}]};
      document.querySelectorAll('#choiceBox').forEach(e=>e.remove());
      inputMode=false;inputBar.style.display='none';waitingForTap=false;
      gameHistory.push({role:'assistant',content:JSON.stringify(reply)});processResponse(reply,['hermione']);
    });
    await drainDialogue(page);
    await page.evaluate(()=>{
      historyBack();
      while(historyPos>0&&dialogueLog[historyPos].cg!=='hermione/dance')historyBack();
    });
    assert.equal(await page.evaluate(()=>currentCG),'hermione/dance');
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/\/outfits\/yule\//);
    await page.evaluate(()=>exitHistory());
    assert.equal(await page.evaluate(()=>currentCG),null);
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/\/2d\/1_neutral_v2\.webp$/);
  });
  await check(ctx,'Hogwarts Quidditch participants and spectators keep distinct clothes and flight history',async()=>{
    await page.evaluate(()=>{
      const reply={background:'quidditch',cg:'ron/flying',narration:'',choices:null,state_update:null,
        visuals:{outfits:{ron:'quidditch'},action:'flying'},dialogue:[
          {char_id:'hermione',speaker:'헤르미온느',text:'난 관중석에서 볼게.'},
          {char_id:'ron',speaker:'론 위즐리',text:'빗자루를 타고 올라갈게.',emotion:'angry'}]};
      document.querySelectorAll('#choiceBox').forEach(e=>e.remove());
      inputMode=false;inputBar.style.display='none';waitingForTap=false;
      gameHistory.push({role:'assistant',content:JSON.stringify(reply)});processResponse(reply,['hermione','ron']);
    });
    await drainDialogue(page);
    await page.waitForFunction(()=>document.getElementById('eventCG').naturalWidth>0&&currentCG==='ron/flying');
    assert.match(await page.locator('#sprite_ron').getAttribute('src'),/ron\/outfits\/quidditch\/1_neutral_v2\.webp$/);
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/hermione\/2d\//);
    assert.equal(await page.evaluate(()=>dialogueLog.findLast(d=>d.char_id==='ron').cg),'ron/flying');
    assert.match(await page.locator('#eventCG').getAttribute('src'),/ron\/flying_v2\.webp$/);
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('eventCG')).opacity==='1');
    await page.screenshot({path:path.join(ARTIFACTS,'hogwarts-flight-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
  });
  await check(ctx,'Hogwarts Malfoy, Crabbe, Lavender, Luna and Romilda use their individual dance CG and matching gown',async()=>{
    for(const id of ['malfoy','crabbe','lavender','luna','romilda']){
      await page.evaluate(id=>{
        const text={malfoy:'발은 밟지 마. 이번 곡은 내가 고를 테니까.',crabbe:'천천히 시작하자. 박자는 맞출 수 있어.',
          lavender:'이 음악 좋지? 한 바퀴 더 돌자!',luna:'발이 가는 대로 가 봐. 음악도 길을 찾을 거야.',
          romilda:'자, 이번엔 내가 돌게. 손 들어 봐!'}[id];
        const reply={background:'ballroom',cg:id+'/dance',narration:'',state_update:null,
          choices:['(음악에 맞춰 춤을 춘다)','(천천히 이야기를 나눈다)'],
          visuals:{outfits:{[id]:'yule'},cgPartner:'player',cgConsent:'mutual'},
          dialogue:[{char_id:id,speaker:CHARACTERS[id].name,text,emotion:'smile'}]};
        document.querySelectorAll('#choiceBox').forEach(e=>e.remove());
        inputMode=false;inputBar.style.display='none';waitingForTap=false;
        gameHistory.push({role:'assistant',content:JSON.stringify(reply)});processResponse(reply,[id]);
      },id);
      await drainDialogue(page);
      await page.waitForFunction(id=>currentCG===id+'/dance'&&document.getElementById('eventCG').complete&&document.getElementById('eventCG').naturalWidth>0,id);
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('eventCG')).opacity==='1');
      assert.equal(await page.locator('#choiceBox').count(),1);
      assert.match(await page.locator('#eventCG').getAttribute('src'),new RegExp('/'+id+'/dance_v1\\.webp$'));
      const gown=await page.evaluate(id=>CHARACTERS[id].outfits.yule.normal,id);
      assert.equal(await page.locator('#sprite_'+id).getAttribute('src'),gown);
      if(id==='crabbe'||id==='lavender')assert.match(gown,/1_neutral_v2\.webp$/);
      assert.equal(await page.evaluate(()=>dialogueLog.findLast(d=>!d.isPlayer).cg),id+'/dance');
      if(id==='malfoy'||id==='lavender'||id==='romilda')
        await page.screenshot({path:path.join(ARTIFACTS,'hogwarts-'+id+'-dance-'+(ctx.mobile?'mobile':'desktop')+'.jpg'),type:'jpeg',quality:100});
    }
  });
  await check(ctx,'Hogwarts pending per-line wardrobe survives restore and legacy saves infer a ballroom look',async()=>{
    const result=await page.evaluate(()=>{
      const before={date:gameState.hogwarts.date,house:gameState.hogwarts.house};
      const reply={background:'library',cg:null,narration:'',choices:null,state_update:null,dialogue:[
        {char_id:'hermione',speaker:'헤르미온느',text:'먼저 책부터 돌려놓을게.',outfit:'default'},
        {char_id:'hermione',speaker:'헤르미온느',text:'예복으로 갈아입었어.',outfit:'yule',emotion:'angry'}]};
      document.querySelectorAll('#choiceBox').forEach(e=>e.remove());
      inputMode=false;inputBar.style.display='none';waitingForTap=false;
      gameHistory.push({role:'assistant',content:JSON.stringify(reply)});processResponse(reply,['hermione']);
      const pending=dialogueLog.findLast(d=>d.pending&&d.outfit==='yule');
      autoSave();const save=JSON.parse(bulkGet(saveKeyFor(STORY.id)));restoreAndReplay(save,false);
      return {before,pending:!!pending};
    });
    assert.equal(result.pending,true);
    await drainDialogue(page);
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/\/outfits\/yule\//);
    const legacy=await page.evaluate(()=>{
      autoSave();const save=JSON.parse(bulkGet(saveKeyFor(STORY.id)));
      delete save.gameState.hogwarts.visuals;
      for(const d of save.dialogueLog){delete d.looks;delete d.cg;delete d.outfit;}
      save.lastBg='ballroom';
      const last=save.gameHistory.findLast(h=>h.role==='assistant');
      last.content=JSON.stringify({background:'ballroom',dialogue:[{char_id:'hermione',speaker:'헤르미온느',text:'음악이 시작됐네.',emotion:'angry'}]});
      restoreAndReplay(save,false);
      return {date:gameState.hogwarts.date,house:gameState.hogwarts.house};
    });
    await drainDialogue(page);
    assert.deepEqual(legacy,result.before);
    assert.match(await page.locator('#sprite_hermione').getAttribute('src'),/\/outfits\/yule\//);
  });
}

(async () => {
  try {
    const origin = await startServer();
    const engineName = process.env.PANDORA_BROWSER || 'chromium';
    assert.ok(['chromium', 'webkit'].includes(engineName), 'PANDORA_BROWSER must be chromium or webkit');
    const launch = { headless: true };
    if (process.env.PANDORA_BROWSER_EXECUTABLE) launch.executablePath = process.env.PANDORA_BROWSER_EXECUTABLE;
    browser = await playwright[engineName].launch(launch);
    for (const mobile of engineName === 'webkit' ? [true] : [false, true]) {
      const hogwartsCtx = await createFixturePage(origin, mobile, {
        freeMode: true, integrated: true, reply: hogwartsArtReply, capturePrompts: true
      });
      try { await hogwartsArtCheck(hogwartsCtx); await hogwartsLooksCheck(hogwartsCtx); await appUpdateChecks(hogwartsCtx); }
      finally { await hogwartsCtx.context.close(); }
      const hogwartsRPCtx=await createFixturePage(origin,mobile,{freeMode:true,reply:hogwartsArtReply,capturePrompts:true});
      try{await hogwartsRPCheck(hogwartsRPCtx);}
      finally{await hogwartsRPCtx.context.close();}
      const ctx = await createFixturePage(origin, mobile);
      try { await playthrough(ctx); }
      finally { await ctx.context.close(); }
      const cloudCtx = await createFixturePage(origin, mobile, { freeMode: true, clock: true });
      try { await cloudSafetyChecks(cloudCtx); }
      finally { await cloudCtx.context.close(); }
      const customCtx = await createFixturePage(origin, mobile, {
        freeMode: true, story: CUSTOM_START_FIXTURE, capturePrompts: true,
      });
      try { await customStartChecks(customCtx); }
      finally { await customCtx.context.close(); }
      const integratedCtx = await createFixturePage(origin, mobile, { freeMode: true, integrated: true });
      try { await quotaAndIntegratedChecks(integratedCtx); }
      finally { await integratedCtx.context.close(); }
      if (mobile) {
        const longCtx = await createFixturePage(origin, mobile, {
          freeMode: true, story: LONG_STORY_FIXTURE, longSession: true, capturePrompts: true,
        });
        try { await longSessionChecks(longCtx); }
        finally { await longCtx.context.close(); }
      }
    }
    console.log('\n' + results.length + '/' + results.length + ' browser scenarios passed (' + engineName + '). All model responses were local fixtures.');
  } catch (e) {
    console.error(e.stack || e);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(ARTIFACTS, 'results-' + (process.env.PANDORA_BROWSER || 'chromium') + '.json'), JSON.stringify(results, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
