'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const scope = 'https://example.test/pandora/';
const gamePage = scope + 'novel.html';

function fixture(tabs) {
  const events = {}, shown = [], messages = [], focused = [], opened = [];
  const self = {
    addEventListener: (name, fn) => { events[name] = fn; },
    registration: { scope, showNotification: async (name, data) => shown.push([name, data.tag]) },
    clients: {
      matchAll: async () => tabs.map(([url, visibilityState]) => ({ url, visibilityState,
        postMessage: message => messages.push(message), focus: async () => focused.push(url) })),
      openWindow: async url => opened.push(url)
    }
  };
  vm.runInNewContext(source, { self, URL });
  const dispatch = name => {
    let work;
    events[name]({ waitUntil: promise => { work = promise; }, notification: { close() {} } });
    assert.ok(work);
    return work;
  };
  return { dispatch, shown, messages, focused, opened };
}

test('push delivered after returning to the game causes no page message or app notification', async () => {
  const f = fixture([[scope + 'admin.html', 'visible'], [gamePage + '?story=hogwarts#play', 'visible']]);
  await f.dispatch('push');
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.shown, []);
});

test('background and closed games keep their notification while an unrelated tab is visible', async () => {
  for (const tabs of [[], [[gamePage, 'hidden']], [[gamePage, 'hidden'], [scope + 'admin.html', 'visible']],
    [['https://example.test/another/novel.html', 'visible']]]) {
    const f = fixture(tabs);
    await f.dispatch('push');
    assert.deepEqual(f.shown, [['PANDORA', 'gen-done']]);
    assert.deepEqual(f.messages, []);
  }
});

test('notification activation focuses the game or opens it if only unrelated windows remain', async () => {
  const current = gamePage + '?story=hogwarts';
  const existing = fixture([[scope + 'admin.html', 'visible'], [current, 'hidden']]);
  await existing.dispatch('notificationclick');
  assert.deepEqual(existing.focused, [current]);
  assert.deepEqual(existing.opened, []);
  const closed = fixture([[scope + 'admin.html', 'visible']]);
  await closed.dispatch('notificationclick');
  assert.deepEqual(closed.focused, []);
  assert.deepEqual(closed.opened, [gamePage]);
});
