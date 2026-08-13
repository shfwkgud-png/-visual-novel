// PANDORA service worker — 응답 완료 푸시 알림 전용 (2026-08-14).
// 캐싱 없음: fetch 핸들러를 두지 않아 네트워크에 일절 개입하지 않는다(구버전 고착 방지).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 릴레이 워커가 생성 완주 시 payload 없는 푸시를 쏜다 → 앱이 보이면 침묵(페이지에 신호만),
// 백그라운드·종료 상태면 알림(시스템 설정에 따라 진동 동반).
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some(w => w.visibilityState === 'visible');
    if (visible) {
      wins.forEach(w => { try { w.postMessage({ type: 'gen-done' }); } catch {} });
      return;   // 보고 있는 중엔 배너·진동으로 방해하지 않는다
    }
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
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { try { await wins[0].focus(); } catch {} return; }
    try { await self.clients.openWindow('novel.html'); } catch {}
  })());
});
