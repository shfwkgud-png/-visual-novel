// PANDORA service worker — 응답 완료 푸시 알림 전용 (2026-08-14).
// 캐싱 없음: fetch 핸들러를 두지 않아 네트워크에 일절 개입하지 않는다(구버전 고착 방지).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const gamePage = new URL('novel.html', self.registration.scope);
function isGameWindow(client) {
  return client.url.split(/[?#]/, 1)[0] === gamePage.href;
}

// 서버가 응답 완료 시 백그라운드 알림을 발송한다. 전달 중 게임 화면으로
// 돌아온 경우 여기서도 확인해 페이지에 신호나 진동을 보내지 않는다.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    if (wins.some(w => w.visibilityState === 'visible' && isGameWindow(w))) return;
    await self.registration.showNotification('PANDORA', {
      body: '응답이 완성됐습니다 — 이어서 읽어보세요 📖',
      tag: 'gen-done',            // 같은 태그면 갱신(중복 배너 방지)
      badge: 'icon.png?v=2',
      icon: 'icon.png?v=2',
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    const game = wins.find(isGameWindow);
    if (game) { try { await game.focus(); return; } catch {} }
    await self.clients.openWindow(gamePage.href);
  })());
});
