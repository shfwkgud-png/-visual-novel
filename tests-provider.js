'use strict';
// Real provider serializers/parsers with deterministic network fixtures. No API keys or model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
function grab(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert(start >= 0, name + ' missing');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const helpers = ['isFreeApiMode', 'isFreeOpenRouterModel', 'providerRequestError', 'llmRequestCurrent',
  'llmRequestProfile', 'callLlmTask', 'createSseParser', 'readProviderStream', 'providerText',
  'fetchGemini', 'fetchNim', 'parseSseTranscript', 'llmSmall'];
const cases = [];
const test = (name, run) => cases.push({ name, run });
const sse = (events, tail = true) => events.map(j => 'data: ' + JSON.stringify(j)).join('\r\n\r\n') + (tail ? '\r\n\r\ndata: [DONE]\r\n\r\n' : '');
function stream(text, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text); let index = 0;
  return { ok: true, status: 200, body: { getReader: () => ({
    read: async () => index >= bytes.length ? { done: true } : { done: false, value: bytes.slice(index, index += chunkSize) },
    releaseLock() {}
  }) } };
}
const answer = (text = '{"state_update":{}}', finish = 'stop') => stream(sse([
  { choices: [{ delta: { content: text }, finish_reason: finish }] },
  { usage: { prompt_tokens: 30, completion_tokens: 20 } }
]));
function harness(overrides = {}) {
  const calls = [], tokens = [], timers = new Map(), toasts = [];
  let timerId = 0;
  const sb = {
    PROVIDER: 'openrouter', FREE_TEST_MODE: false, GEMINI_MODEL: 'gemini-3.5-flash',
    OPENROUTER_KEY: 'fixture-only', API_KEY: 'fixture-only', OPENROUTER_URL: 'https://fixture.invalid/openrouter',
    NIM_URL: 'https://fixture.invalid/nim', NIM_MODEL: 'qwen/test', SLOW_FALLBACK_MODEL: 'google/gemini-2.5-pro',
    curORModel: () => 'google/gemini-3.5-flash', AbortController, TextDecoder, Date, console,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    recTokens: (...args) => tokens.push(args), showStatToast: text => toasts.push(text),
    fetch: async () => answer(), ...overrides
  };
  const fixtureFetch = sb.fetch;
  sb.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body), signal: options.signal });
    return await fixtureFetch(url, options);
  };
  sb.window = sb;
  vm.createContext(sb); vm.runInContext(helpers.map(grab).join('\n'), sb);
  return { sb, calls, tokens, timers, toasts };
}

test('utility output limits no longer inherit the main 16k allowance', () => {
  const h = harness();
  assert.equal(h.sb.llmRequestProfile('openrouter', 'google/gemini-3.5-flash', 4000, 'main').maxTokens, 16000);
  assert.equal(h.sb.llmRequestProfile('openrouter', 'google/gemini-3.5-flash', 2500, 'state').maxTokens, 3524);
  assert.equal(h.sb.llmRequestProfile('openrouter', 'google/gemini-3.5-flash', 300, 'choices').maxTokens, 1324);
  assert.equal(h.sb.llmRequestProfile('openrouter', 'openrouter/free', 128, 'probe').maxTokens, 128);
});
test('thinking controls match model family capabilities', () => {
  const h = harness(), p = model => h.sb.llmRequestProfile('gemini', model, 900, 'state').thinkingConfig;
  assert.equal(p('gemini-3.5-flash').thinkingLevel, 'minimal');
  assert.equal(p('gemini-3.6-flash').thinkingLevel, 'minimal');
  assert.equal(p('gemini-3.8-flash').thinkingLevel, 'low');
  assert.equal(p('gemini-3.1-pro-preview').thinkingLevel, 'low');
  assert.equal(p('gemini-2.5-flash').thinkingBudget, 0);
  assert.equal(p('gemini-2.5-pro').thinkingBudget, 128);
});
test('free mode blocks paid selection and explicit paid fallback before fetch', async () => {
  const h = harness({ FREE_TEST_MODE: true });
  assert.equal((await h.sb.fetchNim('', [])).error.code, 'FREE_TEST_BLOCKED');
  assert.equal((await h.sb.fetchNim('', [], 0.4, 900, null, 'x', 'google/gemini-2.5-pro')).error.code, 'FREE_TEST_BLOCKED');
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
});
test('free mode blocks Gemini and NIM before fetch', async () => {
  const h = harness({ FREE_TEST_MODE: true, PROVIDER: 'gemini' });
  assert.equal((await h.sb.fetchGemini('', [])).error.code, 'FREE_TEST_BLOCKED');
  h.sb.PROVIDER = 'nim';
  assert.equal((await h.sb.fetchNim('', [])).error.code, 'FREE_TEST_BLOCKED');
  assert.equal(h.calls.length, 0);
});
test('free model accepts only exact router or provider/model:free ids', () => {
  const h = harness();
  for (const m of ['openrouter/free', 'qwen/qwen3-32b:free']) assert.equal(h.sb.isFreeOpenRouterModel(m), true);
  for (const m of ['openrouter/auto', 'google/gemini-3.5-flash', 'qwen/x:free:paid', 'qwen/x:free ', '../x:free'])
    assert.equal(h.sb.isFreeOpenRouterModel(m), false, m);
});
test('free request carries zero price ceiling and no Google-only routing fields', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'openrouter/free' });
  const r = await h.sb.callLlmTask('JSON', [{ role: 'user', content: 'test' }], { task: 'probe', maxTok: 128, json: true });
  assert.equal(r.text, '{"state_update":{}}'); assert.equal(h.calls.length, 1);
  const b = h.calls[0].body;
  assert.deepEqual(Object.values(b.provider.max_price), [0, 0, 0, 0]);
  assert.equal(b.provider.allow_fallbacks, false); assert.equal(b.provider.only, undefined);
  assert.equal(b.safety_settings, undefined); assert.equal(b.reasoning, undefined);
  assert.equal(b.max_tokens, 128); assert.equal(b.response_format.type, 'json_object');
  assert.equal(h.timers.size, 0);
});
test('free quota error performs one request and forbids retry', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'qwen/example:free',
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }) }) });
  const r = await h.sb.fetchNim('', []);
  assert.equal(r.error.code, 429); assert.equal(r.error.retryable, false); assert.equal(r.error.freeTest, true);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('midstream errors remain errors even after partial text', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'openrouter/free', fetch: async () => stream(sse([
    { choices: [{ delta: { content: '{"narration":"부분' } }] }, { error: { code: 503, message: 'upstream failed' } }
  ])) });
  const chunks = [], r = await h.sb.fetchNim('', [], 0.4, 4000, t => chunks.push(t));
  assert.equal(r.error.code, 503); assert.equal(r.text, '{"narration":"부분');
  assert.equal(chunks.length, 1); assert.equal(h.calls.length, 1);
});
test('SSE parser preserves split UTF-8, CRLF and unterminated final event', async () => {
  const h = harness({ fetch: async () => stream(sse([{ choices: [{ delta: { content: '한글🙂' } }] }], false), 1) });
  const r = await h.sb.fetchNim('', []);
  assert.equal(r.text, '한글🙂'); assert.equal(r.error, undefined);
});
test('SSE multiline data and comments parse through stored transcript path', () => {
  const h = harness();
  const r = h.sb.parseSseTranscript(': ping\r\nevent: message\r\ndata: {"choices":[{\r\ndata: "delta":{"content":"기록"}}]}');
  assert.equal(r.text, '기록'); assert.equal(r.error, undefined);
});
test('stored stream containing an error cannot become a completed recovery', () => {
  const h = harness(), r = h.sb.parseSseTranscript(sse([
    { choices: [{ delta: { content: '{"narration":"부분"}' } }] }, { error: { message: 'failed' } }
  ]));
  assert.equal(r.text, ''); assert.equal(r.error.message, 'failed'); assert(r.partialText);
});
test('Gemini emits every text part but excludes thought content and normalizes usage', async () => {
  const h = harness({ PROVIDER: 'gemini', fetch: async () => stream(sse([
    { candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: '{"narration":' }, { text: '"한글"}' }] } }] },
    { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, thoughtsTokenCount: 5, cachedContentTokenCount: 20 } }
  ], false), 2) });
  const r = await h.sb.fetchGemini('JSON', [{ role: 'user', content: 'continue' }], 0.9, 4000, true, () => {});
  assert.equal(r.text, '{"narration":"한글"}'); assert.equal(r.usage.completion_tokens, 17);
  assert.equal(r.usage.completion_tokens_details.reasoning_tokens, 5); assert.equal(r.usage.prompt_tokens_details.cached_tokens, 20);
  assert.equal(r.modelUsed, 'gemini-3.5-flash'); assert(r.timing.total >= 0);
  const c = h.calls[0]; assert(!c.url.includes('key=')); assert.equal(c.headers['x-goog-api-key'], 'fixture-only');
  assert.equal(c.body.contents.length, 1); assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(c.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
});
test('Gemini thinking compatibility is retried once and cached per model', async () => {
  let count = 0;
  const h = harness({ PROVIDER: 'gemini', fetch: async () => ++count === 1
    ? { ok: false, status: 400, json: async () => ({ error: { message: 'thinkingLevel not supported' } }) }
    : stream(sse([{ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }])) });
  const r = await h.sb.fetchGemini('', [], 0.4, 900, true);
  assert.equal(r.text, '{}'); assert.equal(h.calls.length, 2);
  assert(h.calls[0].body.generationConfig.thinkingConfig); assert.equal(h.calls[1].body.generationConfig.thinkingConfig, undefined);
  h.sb.GEMINI_MODEL = 'gemini-3.8-flash';
  await h.sb.fetchGemini('', [], 0.4, 900, true);
  assert.equal(h.calls[2].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
});
test('small state extraction refuses a token-truncated response', async () => {
  const h = harness({ fetch: async () => answer('{"state_update":{}}', 'length') });
  assert.equal(await h.sb.llmSmall('', 'test', 2500, 0.3), null);
  assert.equal(h.calls[0].body.max_tokens, 3524);
});
test('NIM utility retains requested limit and receives no OpenRouter-only fields', async () => {
  const h = harness({ PROVIDER: 'nim' }); await h.sb.llmSmall('', 'test', 900, 0.3);
  assert.equal(h.calls[0].url, 'https://fixture.invalid/nim');
  assert.equal(h.calls[0].body.max_tokens, 900); assert.equal(h.calls[0].body.provider, undefined);
});
test('paid Google route preserves Vertex preference and Flash 2.5 reasoning off', async () => {
  const h = harness({ curORModel: () => 'google/gemini-2.5-flash' });
  await h.sb.fetchNim('', [], 0.3, 2500);
  assert.deepEqual(Array.from(h.calls[0].body.provider.only), ['google-vertex']);
  assert.equal(h.calls[0].body.reasoning.enabled, false); assert.equal(h.calls[0].body.max_tokens, 2500);
});
test('stale task is rejected without any provider request', async () => {
  const h = harness(); const opts = { isCurrent: () => false };
  assert.equal((await h.sb.callLlmTask('', [], opts)).error.code, 'CANCELLED');
  h.sb.PROVIDER = 'gemini';
  assert.equal((await h.sb.callLlmTask('', [], opts)).error.code, 'CANCELLED');
  assert.equal(h.calls.length, 0);
});
test('empty or malformed streams cannot masquerade as success', async () => {
  const h = harness({ fetch: async () => stream('data: [DONE]\n\n') });
  assert.equal((await h.sb.fetchNim('', [])).error.code, 'EMPTY_RESPONSE');
  const h2 = harness({ fetch: async () => stream('data: {broken}\n\n') });
  assert.equal((await h2.sb.fetchNim('', [])).error.code, 'INVALID_STREAM');
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`${cases.length - failed}/${cases.length} provider regressions passed`);
  if (failed) process.exitCode = 1;
})();
