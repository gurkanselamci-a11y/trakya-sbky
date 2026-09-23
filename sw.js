/* sw.js — çevrimdışı çalışma. Kabuk önbelleğe alınır, ders içerikleri ilk erişimde saklanır. */

const VERSION = 'v1.7.0';
const CACHE = `tusbky-${VERSION}`;

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/data.js',
  'js/icons.js',
  // hesap ve eşitleme
  'js/syncmerge.js',
  'js/sync.js',
  'js/cloud.js',
  'js/firebase-config.js',
  'js/akts.js',
  'js/views/account.js',
  'js/views/aktsedit.js',
  'vendor/firebase/firebase-app.js',
  'vendor/firebase/firebase-auth.js',
  'vendor/firebase/firebase-firestore-lite.js',
  'js/md.js',
  'js/srs.js',
  'js/plan.js',
  'js/grades.js',
  'js/ui.js',
  'js/wakelock.js',
  'js/views/home.js',
  'js/views/courses.js',
  'js/views/course.js',
  'js/views/topic.js',
  'js/views/quiz.js',
  'js/views/cards.js',
  'js/views/exam.js',
  'js/views/schedule.js',
  'js/views/mycourses.js',
  'js/views/grades.js',
  'js/views/stats.js',
  'js/views/settings.js',
  'js/views/search.js',
  'js/views/mistakes.js',
  'js/views/notes.js',
  'js/quizrunner.js',
  'vendor/katex/katex.min.css',
  'vendor/katex/katex.min.js',
  // tema yazı tipleri (tools/fetch-fonts.mjs) — latin + latin-ext
  'vendor/fonts/fonts.css',
  'vendor/fonts/ibm-plex-mono-latin-2.woff2',
  'vendor/fonts/ibm-plex-mono-latin-4.woff2',
  'vendor/fonts/ibm-plex-mono-latin-ext-1.woff2',
  'vendor/fonts/ibm-plex-mono-latin-ext-3.woff2',
  'vendor/fonts/ibm-plex-sans-latin-4.woff2',
  'vendor/fonts/ibm-plex-sans-latin-ext-3.woff2',
  'vendor/fonts/ibm-plex-sans-latin-ext-italic-1.woff2',
  'vendor/fonts/ibm-plex-sans-latin-italic-2.woff2',
  'data/curriculum.json',
  'data/official.json',
  'data/index.json',
  'data/search.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/**
 * Ders içeriklerini parça parça indirir. ESKİDEN kurulum adımında 144 dosyanın tamamı tek
 * `Promise.all` ile çekiliyordu: bu, telefonda mobil veriyle ~35 MB'ın tamamı inene kadar
 * kurulumun (dolayısıyla çevrimdışı desteğin) bitmemesi ve aynı anda yüzlerce isteğin
 * bağlantıyı boğması demekti. Artık kurulum yalnızca kabuğu alır; içerik arka planda,
 * sınırlı eşzamanlılıkla ve önce ilgili yarıyıldan başlanarak dolar.
 * Önbellekte olan dosya yeniden indirilmez, yani işlem kesilse de kaldığı yerden sürer.
 */
let filling = null;

async function fillContent(firstSemester = null, firstCodes = []) {
  if (filling) return filling;
  filling = (async () => {
    try {
      const cache = await caches.open(CACHE);
      const cur = await (await fetch('data/curriculum.json', { cache: 'no-cache' })).json();
      const bySem = cur.semesters.map((s) => ({ n: s.n, codes: s.courses }));
      // Önce istenen yarıyıl, sonra diğerleri sırayla.
      const order = [
        ...(firstSemester ? bySem.filter((s) => s.n === firstSemester) : []),
        ...bySem.filter((s) => s.n !== firstSemester),
      ];
      // Kullanıcının seçtiği dersler (varsa) en başa: çevrimdışı kalındığında önce
      // gerçekten aldığı dersler hazır olsun, sonra yarıyılın geri kalanı.
      const codes = [...new Set([...firstCodes, ...order.flatMap((s) => s.codes)])];

      const CONCURRENCY = 4;
      let i = 0;
      const worker = async () => {
        while (i < codes.length) {
          const code = codes[i++];
          const url = `data/courses/${code}.json`;
          if (await cache.match(url)) continue;          // zaten var, atla
          await cache.add(url).catch(() => {});          // yoksa/404 ise sessizce geç
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } catch (_) { /* içerik yoksa ya da ağ yoksa sorun değil, sonra yeniden denenir */ }
    filling = null;
  })();
  return filling;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Çekirdek dosyalar — biri düşerse kurulum çökmesin
    // `cache: 'reload'` şart: düz cache.add tarayıcının HTTP önbelleğini kullanabiliyor ve
    // yeni sürüm ESKİ dosyalarla kurulabiliyor (güncelleme yapıldı sanılır, hiçbir şey değişmez).
    await Promise.all(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))
      .catch((err) => console.warn('SW atlandı:', u, err.message))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tusbky-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Kabuk hazır; içerik arka planda dolsun. Sayfa hangi yarıyılda olduğunu bildirirse
    // (aşağıdaki `message`) o yarıyıl öne alınır.
    fillContent();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Gezinme istekleri: ağ önce, düşerse önbellekteki kabuk
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        (await caches.open(CACHE)).put('index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Diğer her şey: önbellek önce, arka planda tazele
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || new Response('Çevrimdışı', { status: 503, statusText: 'Offline' });
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') { self.skipWaiting(); return; }
  // Sayfa "hangi sürümdeyim" diye sorabilsin (Hesap ekranındaki sürüm kartı).
  if (e.data && e.data.type === 'version') { e.ports?.[0]?.postMessage({ version: VERSION }); return; }
  // Sayfa açılışta kullanıcının bulunduğu yarıyılı bildirir; o yarıyılın dersleri
  // önbelleğe önce alınır, böylece çevrimdışı kalındığında en olası dersler hazır olur.
  if (e.data && e.data.type === 'prefetch') {
    const n = Number(e.data.semester) || null;
    const codes = Array.isArray(e.data.codes) ? e.data.codes.filter((c) => /^[A-Z0-9]+$/.test(c)) : [];
    e.waitUntil ? e.waitUntil(fillContent(n, codes)) : fillContent(n, codes);
  }
});
