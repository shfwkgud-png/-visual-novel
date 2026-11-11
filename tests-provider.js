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
const helpers = ['isFreeApiMode', 'isFreeOpenRouterModel', 'safeProviderErrorText', 'providerErrorDetails', 'providerRequestError', 'llmRequestCurrent',
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
test('Flint free main relay reserves output room without disabling mandatory reasoning', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'recursive/flint-v1.0:free',
    SYNC_URL: 'https://fixture.invalid/relay', crypto: { randomUUID: () => 'fixture-flint-main' } });
  const chunks = [];
  const r = await h.sb.fetchNim('JSON', [{ role: 'user', content: 'continue' }], 0.7, 4000,
    text => chunks.push(text), h.sb.NIM_MODEL, null, 0, { task: 'main', json: true });
  assert.equal(r.text, '{"state_update":{}}'); assert.equal(h.calls.length, 1);
  assert.equal(chunks.at(-1), r.text); assert.equal(h.timers.size, 0);
  const c = h.calls[0], b = c.body;
  assert.equal(c.url, 'https://fixture.invalid/relay/gen?id=fixture-flint-main');
  assert.equal(b.model, 'recursive/flint-v1.0:free'); assert.equal(b.max_tokens, 16000);
  assert.equal(b.response_format.type, 'json_object'); assert.equal(b.provider.allow_fallbacks, false);
  assert.deepEqual(Object.values(b.provider.max_price), [0, 0, 0, 0]);
  for (const field of ['reasoning', 'reasoning_effort', 'thinking', 'thinkingConfig', 'safety_settings'])
    assert.equal(b[field], undefined, field + ' must not be sent to Flint');
  assert.equal(b.provider.only, undefined); assert.equal(b.models, undefined);
});
test('Flint state request gets bounded reasoning room while its probe remains 128 tokens', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'recursive/flint-v1.0:free' });
  const state = await h.sb.llmSmall('JSON', 'record this turn', 2500, 0.3);
  assert.equal(state, '{"state_update":{}}');
  const probe = await h.sb.callLlmTask('JSON', [{ role: 'user', content: 'probe' }],
    { task: 'probe', maxTok: 128, json: true });
  assert.equal(probe.text, '{"state_update":{}}'); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(c => c.body.max_tokens), [6596, 128]);
  for (const { body } of h.calls) {
    assert.equal(body.model, 'recursive/flint-v1.0:free'); assert.equal(body.reasoning, undefined);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.deepEqual(Object.values(body.provider.max_price), [0, 0, 0, 0]);
  }
  assert.equal(h.timers.size, 0);
});
test('Flint allowance respects the output ceiling and exact model scope without retrying failures', async () => {
  const fixtures = [
    { model: 'recursive/flint-v1.0:free', task: 'state', requested: 32768, expected: 32768 },
    { model: 'recursive/flint-v1.0:free', task: 'main', requested: 99999, expected: 32768 },
    { model: 'recursive/flint-v1.0', task: 'main', requested: 4000, expected: 4000, free: false },
    { model: 'recursive/flint-v1.0-extra:free', task: 'main', requested: 4000, expected: 4000 },
    { model: 'openrouter/free', task: 'state', requested: 2500, expected: 2500 }
  ];
  for (const fixture of fixtures) {
    const h = harness({ FREE_TEST_MODE: fixture.free !== false, curORModel: () => fixture.model,
      fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'fixture limit' } }) }) });
    const r = await h.sb.callLlmTask('JSON', [], { task: fixture.task, maxTok: fixture.requested, json: true });
    assert.equal(r.error.code, 429); assert.equal(h.calls.length, 1, fixture.model + ' must not retry or fall back');
    assert.equal(h.calls[0].body.model, fixture.model);
    assert.equal(h.calls[0].body.max_tokens, fixture.expected, fixture.model + ' ' + fixture.task);
    assert.equal(h.calls[0].body.reasoning, undefined); assert.equal(h.timers.size, 0);
    if (fixture.free !== false) {
      assert.equal(r.error.retryable, false); assert.equal(r.error.freeTest, true);
      assert.deepEqual(Object.values(h.calls[0].body.provider.max_price), [0, 0, 0, 0]);
    }
  }
});
test('Nemotron free main relay disables reasoning without expanding its 4000-token budget', async () => {
  const model = 'nvidia/nemotron-3.5-super-vl:free';
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => model,
    SYNC_URL: 'https://fixture.invalid/relay', crypto: { randomUUID: () => 'fixture-nemotron-main' } });
  const chunks = [];
  const r = await h.sb.fetchNim('JSON', [{ role: 'user', content: 'continue' }], 0.7, 4000,
    text => chunks.push(text), h.sb.NIM_MODEL, null, 0, { task: 'main', json: true });
  assert.equal(r.text, '{"state_update":{}}'); assert.equal(chunks.at(-1), r.text);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  const c = h.calls[0], b = c.body;
  assert.equal(c.url, 'https://fixture.invalid/relay/gen?id=fixture-nemotron-main');
  assert.equal(b.model, model); assert.equal(b.max_tokens, 4000);
  assert.deepEqual(b.reasoning, { enabled: false }); assert.equal(b.response_format.type, 'json_object');
  assert.equal(b.provider.allow_fallbacks, false);
  assert.deepEqual(Object.values(b.provider.max_price), [0, 0, 0, 0]);
  for (const field of ['reasoning_effort', 'thinkingConfig', 'safety_settings', 'models']) assert.equal(b[field], undefined);
  assert.equal(b.provider.only, undefined);
});
test('Nemotron state and probe stay JSON while a summary retains its plain-text response contract', async () => {
  const responses = ['{"state_update":{"gold":5}}', '이전 장면의 사건과 약속을 기록한다.', '{"ok":true}'];
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'nvidia/nemotron-3.5-super-vl:free',
    fetch: async () => answer(responses.shift()) });
  assert.equal(await h.sb.llmSmall('JSON', 'record this turn', 2500, 0.3), '{"state_update":{"gold":5}}');
  const summary = await h.sb.callLlmTask('Summarize in plain text', [{ role: 'user', content: 'past scenes' }],
    { task: 'summary', maxTok: 2600, json: false });
  assert.equal(summary.text, '이전 장면의 사건과 약속을 기록한다.');
  const probe = await h.sb.callLlmTask('JSON', [{ role: 'user', content: 'probe' }],
    { task: 'probe', maxTok: 128, json: true });
  assert.equal(probe.text, '{"ok":true}'); assert.equal(h.calls.length, 3);
  assert.deepEqual(h.calls.map(c => c.body.max_tokens), [2500, 2600, 128]);
  assert.equal(h.calls[0].body.response_format.type, 'json_object');
  assert.equal(h.calls[1].body.response_format, undefined);
  assert.equal(h.calls[2].body.response_format.type, 'json_object');
  for (const { body } of h.calls) {
    assert.deepEqual(body.reasoning, { enabled: false }); assert.equal(body.provider.allow_fallbacks, false);
    assert.deepEqual(Object.values(body.provider.max_price), [0, 0, 0, 0]);
  }
  assert.equal(h.timers.size, 0);
});
test('Nemotron reasoning override is exact and leaves paid models, other NVIDIA models and NIM unchanged on errors', async () => {
  const target = 'nvidia/nemotron-3.5-super-vl:free';
  const fixtures = [
    { model: target, free: true, off: true },
    { model: target, free: false, off: true },
    { model: 'nvidia/nemotron-3.5-super-vl', free: false },
    { model: 'nvidia/nemotron-3-super:free', free: true },
    { model: target, free: false, provider: 'nim' }
  ];
  for (const fixture of fixtures) {
    const provider = fixture.provider || 'openrouter';
    const h = harness({ PROVIDER: provider, FREE_TEST_MODE: fixture.free,
      curORModel: () => fixture.model, NIM_MODEL: fixture.model,
      fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'fixture limit' } }) }) });
    const r = await h.sb.callLlmTask('JSON', [], { task: 'state', maxTok: 2500, json: true });
    assert.equal(r.error.code, 429); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
    const b = h.calls[0].body;
    assert.equal(b.model, fixture.model); assert.equal(b.max_tokens, 2500);
    assert.deepEqual(b.reasoning, fixture.off ? { enabled: false } : undefined);
    assert.equal(b.safety_settings, undefined); assert.equal(b.thinkingConfig, undefined);
    if (provider === 'openrouter' && fixture.model.endsWith(':free')) {
      assert.equal(r.error.retryable, false); assert.equal(b.provider.allow_fallbacks, false);
      assert.deepEqual(Object.values(b.provider.max_price), [0, 0, 0, 0]);
      assert.equal(b.provider.only, undefined);
    } else assert.equal(b.provider, undefined);
  }
});
test('free quota error performs one request and forbids retry', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'qwen/example:free',
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }) }) });
  const r = await h.sb.fetchNim('', []);
  assert.equal(r.error.code, 429); assert.equal(r.error.retryable, false); assert.equal(r.error.freeTest, true);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('HTTP 429 preserves provider cause and Retry-After while remaining a single free request', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'openrouter/free',
    fetch: async () => ({ ok: false, status: 429,
      headers: { get: name => name.toLowerCase() === 'retry-after' ? '30' : null },
      json: async () => ({ error: { code: 429, message: 'Provider returned error', metadata: {
        provider_name: 'Fixture Provider', raw: 'Free model is temporarily rate-limited upstream.'
      } } }) }) });
  const r = await h.sb.callLlmTask('JSON', [{ role: 'user', content: 'probe' }], { task: 'probe', maxTok: 128, json: true });
  assert.equal(r.error.code, 429); assert.equal(r.error.httpStatus, 429);
  assert.equal(r.error.message, 'Provider returned error');
  assert.equal(r.error.detail, 'Free model is temporarily rate-limited upstream.');
  assert.equal(r.error.provider, 'Fixture Provider'); assert.equal(r.error.retryAfter, '30');
  assert.equal(r.error.retryable, false); assert.equal(r.error.freeTest, true);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  assert.deepEqual(Object.values(h.calls[0].body.provider.max_price), [0, 0, 0, 0]);
});
test('SSE 429 retains nested error detail and retry guidance without becoming success or retrying', async () => {
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'fixture/model:free', fetch: async () => {
    const response = stream(sse([{ error: { code: 429, message: 'Provider returned error', metadata: {
      provider_name: 'Fixture SSE Provider',
      raw: JSON.stringify({ error: { message: 'Upstream free capacity is exhausted.' } })
    } } }]));
    response.headers = { get: name => name.toLowerCase() === 'retry-after' ? '5' : null };
    return response;
  } });
  const r = await h.sb.fetchNim('', []);
  assert.equal(r.error.code, 429); assert.equal(r.error.detail, 'Upstream free capacity is exhausted.');
  assert.equal(r.error.provider, 'Fixture SSE Provider'); assert.equal(r.error.retryAfter, '5');
  assert.equal(r.error.retryable, false); assert.equal(r.text, '');
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('provider diagnostics redact configured fake keys and bearer credentials in both message and detail', async () => {
  const orKey = 'fixture-or-secret-7b5f0c8e', geminiKey = 'fixture-gemini-secret-c4a1d93f';
  const bearer = 'fixture-bearer-private-abcdef0123456789';
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'openrouter/free',
    OPENROUTER_KEY: orKey, API_KEY: geminiKey,
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: {
      message: `Rate limited: ${orKey}; Authorization: Bearer ${bearer}`,
      metadata: { provider_name: 'Fixture', raw: `Upstream limit for ${geminiKey}; ${orKey}` }
    } }) }) });
  const r = await h.sb.fetchNim('', []), rendered = JSON.stringify(r.error);
  for (const secret of [orKey, geminiKey, bearer]) assert(!rendered.includes(secret), 'credential leaked into provider error');
  assert.match(r.error.message, /Rate limited/); assert.match(r.error.detail, /Upstream limit/);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('diagnostic metadata extracts only an error message and never dumps request headers or prompts', async () => {
  const privatePrompt = 'fixture-private-player-history-do-not-export';
  const privateHeader = 'fixture-private-header-value-do-not-export';
  const h = harness({ FREE_TEST_MODE: true, curORModel: () => 'openrouter/free',
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: {
      message: 'Provider returned error', metadata: { provider_name: 'Fixture', raw: {
        error: { message: 'Free request limit reached.' },
        request: { headers: { Authorization: 'Bearer ' + privateHeader }, messages: [{ content: privatePrompt }] }
      } }
    } }) }) });
  const r = await h.sb.fetchNim('', []), serialized = JSON.stringify(r.error);
  assert.equal(r.error.detail, 'Free request limit reached.');
  for (const value of [privatePrompt, privateHeader, 'Authorization', 'messages']) assert(!serialized.includes(value), 'request data leaked in error metadata');
  const noMessage = h.sb.providerErrorDetails({ metadata: { raw: { request: { headers: { secret: privateHeader }, prompt: privatePrompt } } } });
  assert(!JSON.stringify(noMessage).includes(privateHeader)); assert(!JSON.stringify(noMessage).includes(privatePrompt));
  assert(!noMessage.detail, 'unrecognized object should not be serialized as a diagnostic');
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
