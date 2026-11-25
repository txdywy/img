// Keeps the page and its files on the phone, so the next visit opens without
// downloading them again. From mainland China every download crosses the border
// and costs about a quarter of a second, so this matters most there.
//
// - The page itself is always fetched fresh when there is a connection, so a new
//   version shows up on the next visit. Without a connection the saved copy opens.
// - Files with ?v= never change under the same version, so they come straight
//   from the saved copy. After each fresh page, only the files that page names are
//   kept, so old versions do not pile up.
// - Files without ?v= (the example photo, the icon) show the saved copy and are
//   refreshed in the background.
//
// WeChat on iPhone has no service workers; there the page works as before.
// To switch this off for everyone, replace this file with one that calls
// self.registration.unregister() and deletes the cache.

var CACHE = 'shiguang';
var PAGE = new URL('./', self.registration.scope).href;

function assetsIn(html) {
  var found = {}, pattern = /(?:href|src)="(\.\/assets\/[^"]+)"/g, match;
  while ((match = pattern.exec(html))) found[new URL(match[1], PAGE).href] = true;
  return found;
}

// Saves the page and every file it names, then drops saved files it no longer names.
function keep(response) {
  return response.clone().text().then(function (html) {
    var wanted = assetsIn(html);
    return caches.open(CACHE).then(function (cache) {
      return cache.put(PAGE, response).then(function () { return cache.keys(); }).then(function (keys) {
        var have = {};
        var drops = keys.filter(function (request) {
          have[request.url] = true;
          return request.url !== PAGE && !wanted[request.url];
        }).map(function (request) { return cache.delete(request); });
        var adds = Object.keys(wanted).filter(function (url) { return !have[url]; }).map(function (url) {
          return fetch(url).then(function (file) { if (file.ok) return cache.put(url, file); }).catch(function () {});
        });
        return Promise.all(drops.concat(adds));
      });
    });
  });
}

self.addEventListener('install', function (event) {
  // The first visit has just downloaded these files; the browser's own cache
  // usually hands them over without another trip.
  event.waitUntil(fetch(PAGE).then(function (response) {
    if (response.ok) return keep(response);
  }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(Promise.all([
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null,
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) { return name !== CACHE; }).map(function (name) { return caches.delete(name); }));
    }),
  ]).then(function () { return self.clients.claim(); }));
});

function isPage(url) {
  return url.href.split(/[?#]/)[0] === PAGE || url.href.split(/[?#]/)[0] === PAGE + 'index.html';
}

function fromNetworkFirst(event) {
  var network = Promise.resolve(event.preloadResponse).then(function (preloaded) {
    return preloaded || fetch(event.request);
  });
  return network.then(function (response) {
    if (response.ok && /text\/html/.test(response.headers.get('content-type') || '')) {
      event.waitUntil(keep(response.clone()).catch(function () {}));
    }
    return response;
  }).catch(function () {
    return caches.match(PAGE).then(function (saved) { return saved || Response.error(); });
  });
}

function fromSavedFirst(event, versioned) {
  return caches.open(CACHE).then(function (cache) {
    function fresh() {
      return fetch(event.request).then(function (response) {
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      });
    }
    return cache.match(event.request).then(function (saved) {
      if (!saved) return fresh();
      if (!versioned) event.waitUntil(fresh().catch(function () {}));
      return saved;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (isPage(url)) event.respondWith(fromNetworkFirst(event));
    return;
  }
  if (url.href.indexOf(PAGE + 'assets/') === 0) {
    event.respondWith(fromSavedFirst(event, /[?&]v=/.test(url.search)));
  }
});
