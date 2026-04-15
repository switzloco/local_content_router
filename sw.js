// sw.js — Service worker for Local Content Router
// Primary job: make the model cache persistent so the browser doesn't evict
// the ~500MB model files when storage pressure is high (common on phones).

const APP_CACHE = 'lcr-app-v1';
const APP_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/model.js',
  './js/pipeline.js',
  './js/router.js',
  './plugins/clipboard.js',
  './plugins/copilot365.js',
  './plugins/gemini.js',
  './plugins/keep.js',
  './plugins/local.js',
  './manifest.json',
  './demo/sample-transcripts.json',
];

// Cache app shell on install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES))
  );
  self.skipWaiting();
});

// Clean old app caches on activate (don't touch transformers model caches)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('lcr-app-') && k !== APP_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Network-first for app files (so code updates land immediately),
// but don't intercept HuggingFace model downloads — let transformers.js
// manage its own cache for those.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Let transformers.js handle its own model/CDN requests
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cdn-lfs')
  ) {
    return; // don't intercept
  }

  // App files: network-first, fall back to cache (offline support)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(APP_CACHE).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
