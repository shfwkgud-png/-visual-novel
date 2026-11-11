// PANDORA browser integration checks. Every external request is intercepted.
// No real login, real API key, external model call, or provider account is used.
// npm install --no-save --package-lock=false playwright@1.62.1
// npx playwright install --with-deps chromium
// node tests-browser.js
// Optional: PANDORA_BROWSER=webkit node tests-browser.js
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
  if (user.includes('사례금 열 닢')) {
    if (kind === 'state') return { state_update: { gold: 10 },
      choices: ['민서에게 영수증을 요청한다', '열람실로 간다'], chronicle: [] };
    return {
      narration: '아침 도서관 접수대에서 민서가 사례금 열 닢을 건네고 다온이 모두 받았다.',
      dialogue: [{ speaker: '민서', char_id: 'guide', emotion: 'normal', pose: 'upper', text: '사례금 열 닢의 지급을 확인했습니다.' }],
      background: null, mood: null, ending: null, cg: null, combat: false,
    };
  }
  const second = /일곱 닢|두 번째 책/.test(user);
  const third = /두 닢|세 번째 서가/.test(user);
  const delta = second ? 7 : third ? 2 : 4;
  if (kind === 'state') return {
    state_update: { gold: delta },
    choices: ['안내원에게 책의 위치를 묻는다', '열람실을 둘러본다'],
    chronicle: [],
  };
  return {
    narration: second ? '두 번째 책을 돌려주자 안내원이 일곱 닢의 사례를 건넸다.'
      : third ? '세 번째 서가를 정리하자 안내원이 두 닢의 사례를 건넸다.'
      : '안내원이 도서관 방문을 반기며 네 닢의 사례를 건넸다.',
    dialogue: [{ speaker: '안내원', char_id: 'guide', emotion: 'normal', pose: 'upper', text: '도와주셔서 감사합니다. 천천히 둘러보세요.' }],
    background: null, mood: null, ending: null, cg: null, combat: false,
  };
}

async function createFixturePage(origin, mobile, options = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const net = { calls: [], prompts: [], syncCalls: [], errors: [], externalBlocked: 0, holdState: null, nextMainStatus: null };
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
    if (url.hostname === 'pandora-sync.pasokong99.workers.dev' && ['/sync', '/sync/list'].includes(url.pathname)) {
      const key = url.pathname === '/sync/list' ? null : url.searchParams.get('key');
      net.syncCalls.push({ method: request.method(), path: url.pathname, key });
      if (request.method() !== 'GET') {
        net.errors.push('cloud write attempted while browser fixture cloud backup is off');
        await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Fixture rejects cloud writes"}' });
        return;
      }
      if (key === 'cfg') net.errors.push('cloud inspection fetched connection settings');
      const data = url.pathname === '/sync/list' ? { keys: Object.keys(CLOUD_FIXTURE) } : CLOUD_FIXTURE[key];
      await route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
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
        : /선택지 작가/.test(sys) ? 'choices' : 'main';
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
      if (kind === 'state' && net.holdState) {
        const held = net.holdState; net.holdState = null;
        held.reached.release();
        await held.resume.promise;
      }
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(fixtureReply(kind, user)) });
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
    if (await page.evaluate(() => inputMode && !sendBtn.disabled && !isShowing && dialogueQueue.length === 0)) return;
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
  throw new Error('Dialogue did not reach an input boundary: ' + await page.evaluate(() => JSON.stringify({ inputMode, busy: sendBtn.disabled, isShowing, waitingForTap, queued: dialogueQueue.length, phase: window._startPhase })));
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
    assert.equal(await page.locator('#orModelSel').inputValue(), 'google/gemini-3.1-pro-preview');
    assert.equal(await page.locator('#orOnlyStory').isChecked(), true);
    await page.locator('#freeTestModeChk').check();
    await page.locator('#apiModal .start-btn').click();
    const saved = await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('vn_cfg'));
      return { free: c.freeTestMode, freeModel: c.freeTestModel, normalModel: c.orModel, provider: c.provider,
        perStoryModel: c.orModelBy.nakin, keptGeminiKey: c.apiKey === 'AIza-test-no-network', nimUrl: c.nimUrl };
    });
    assert.deepEqual(saved, { free: true, freeModel: 'openrouter/free', normalModel: 'google/gemini-3.6-flash', provider: 'openrouter',
      perStoryModel: 'google/gemini-3.1-pro-preview', keptGeminiKey: true, nimUrl: 'https://nim-fixture.invalid' });
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
    assert.equal(cfg.orModel, 'google/gemini-3.6-flash');
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

(async () => {
  try {
    const origin = await startServer();
    const engineName = process.env.PANDORA_BROWSER || 'chromium';
    assert.ok(['chromium', 'webkit'].includes(engineName), 'PANDORA_BROWSER must be chromium or webkit');
    browser = await playwright[engineName].launch({ headless: true });
    for (const mobile of engineName === 'webkit' ? [true] : [false, true]) {
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
