const CACHE = 'pulse-v13';
const PRECACHE = [
  '/',
  '/css/style.css?v=13',
  '/js/utils.js?v=13',
  '/js/ui.js?v=13',
  '/js/api.js?v=13',
  '/js/app.js?v=13',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/logo-mark.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {}
  const title = data.title || 'Pulse';
  const isCall = !!data.isCall;
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: isCall ? 'pulse-call-' + (data.conversationId || '') : 'pulse-conv-' + (data.conversationId || ''),
    data: {
      url: '/?conv=' + (data.conversationId || ''),
      conversationId: data.conversationId || null,
      isCall,
      fromUserId: data.fromUserId || null,
    },
    renotify: true,
    // "requireInteraction" mantém a notificação de ligação na tela até a
    // pessoa tocar em algo, em vez de sumir sozinha em poucos segundos.
    requireInteraction: isCall,
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [120, 60, 120],
  };
  if (isCall) {
    options.actions = [
      { action: 'accept', title: '✅ Atender' },
      { action: 'decline', title: '❌ Recusar' },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (data.isCall) {
    const action = event.action === 'decline' ? 'decline' : 'accept';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
        for (const client of clientsArr) {
          if ('focus' in client) {
            client.postMessage({ type: 'call-action', action, conversationId: data.conversationId, fromUserId: data.fromUserId });
            return client.focus();
          }
        }
        return self.clients.openWindow(`/?callAction=${action}&from=${data.fromUserId || ''}`);
      })
    );
    return;
  }

  const target = (data && data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'open-conversation', conversationId: data.conversationId });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/api') || path.startsWith('/socket.io') || path.startsWith('/uploads')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((match) => match || caches.match('/')))
  );
});
