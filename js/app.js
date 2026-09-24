// app.js — uygulama kabuğu, yönlendirici ve çalışma süresi sayacı.

import { store } from './store.js';
import { $$, toast, bindCopy, fitMath } from './ui.js';
import { getCurriculum, getIndex, getAllCardIds } from './data.js';
import { dueCount } from './srs.js';
import { setWakeLockWanted } from './wakelock.js';

import homeView from './views/home.js';
import coursesView from './views/courses.js';
import courseView from './views/course.js';
import topicView from './views/topic.js';
import quizView from './views/quiz.js';
import cardsView from './views/cards.js';
import examView from './views/exam.js';
import scheduleView from './views/schedule.js';
import myCoursesView from './views/mycourses.js';
import gradesView from './views/grades.js';
import statsView from './views/stats.js';
import settingsView from './views/settings.js';
import searchView, { invalidateSearchIndex } from './views/search.js';
import mistakesView from './views/mistakes.js';
import notesView from './views/notes.js';
import { ico } from './icons.js';
import accountView from './views/account.js';
import aktsEditView from './views/aktsedit.js';
import { startSync } from './sync.js';
import { refreshAkts } from './akts.js';

const routes = [
  { re: /^\/$/, view: homeView, nav: '/' },
  { re: /^\/dersler$/, view: coursesView, nav: '/dersler' },
  { re: /^\/ders\/([A-Z0-9]+)$/, view: courseView, nav: '/dersler', math: true },
  { re: /^\/konu\/([A-Z0-9]+)\/([\w-]+)$/, view: topicView, nav: '/dersler', study: true, math: true },
  { re: /^\/quiz\/([A-Z0-9]+)(?:\/([\w-]+))?$/, view: quizView, nav: '/dersler', study: true, math: true },
  { re: /^\/kartlar(?:\/([A-Z0-9]+))?$/, view: cardsView, nav: '/kartlar', study: true, math: true },
  { re: /^\/sinav(?:\/([A-Z0-9]+)\/(\w+))?$/, view: examView, nav: '/sinav', study: true, math: true },
  { re: /^\/program$/, view: scheduleView, nav: '/program' },
  { re: /^\/derslerim$/, view: myCoursesView, nav: '/derslerim' },
  { re: /^\/notlar$/, view: gradesView, nav: '/notlar' },
  { re: /^\/istatistik$/, view: statsView, nav: '/istatistik' },
  { re: /^\/ara(?:\/(.*))?$/, view: searchView, nav: '/ara', math: true },
  { re: /^\/yanlislarim$/, view: mistakesView, nav: '/istatistik', study: true, math: true },
  { re: /^\/notlarim$/, view: notesView, nav: '/istatistik', math: true },
  { re: /^\/ayarlar$/, view: settingsView, nav: '/' },
  { re: /^\/hesap$/, view: accountView, nav: '/hesap' },
  { re: /^\/akts$/, view: aktsEditView, nav: '/ayarlar' },
];

// KaTeX yalnızca matematik gösteren ekranlarda yüklenir — ana sayfa hafif kalsın.
let katexPromise = null;
function ensureKatex() {
  if (window.katex) return Promise.resolve();
  if (!katexPromise) {
    katexPromise = new Promise((resolve) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/katex/katex.min.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'vendor/katex/katex.min.js';
      js.onload = resolve;
      js.onerror = () => resolve(); // yüklenemezse formüller ham metin olarak görünür
      document.head.appendChild(js);
    });
  }
  return katexPromise;
}

const viewEl = () => document.getElementById('view');
let currentCleanup = null;
let currentRoute = null;

function path() {
  const h = location.hash.replace(/^#/, '');
  return h || '/';
}

export function go(to) {
  if (location.hash === '#' + to) render();
  else location.hash = to;
}

async function render() {
  const p = path();
  const match = routes.map((r) => ({ r, m: p.match(r.re) })).find((x) => x.m);
  const root = viewEl();

  accrueStudy();   // sayfadan ayrılmadan önceki süreyi yaz
  if (currentCleanup) { try { currentCleanup(); } catch (_) {} currentCleanup = null; }

  if (!match) {
    currentRoute = null;
    syncStudy();
    root.innerHTML = `<div class="empty"><div class="e-ico">${ico('compass')}</div><b>Sayfa bulunamadı</b>
      <p class="small">Aradığın sayfa yok.</p><a class="btn primary" href="#/">Ana sayfaya dön</a></div>`;
    setTitle('Bulunamadı', '');
    return;
  }

  currentRoute = match.r;
  syncStudy();     // çalışma ekranıysa ekranı açık tut, sayacı başlat
  const params = match.m.slice(1);
  root.innerHTML = `<div class="empty"><div class="e-ico">${ico('clock')}</div><b>Yükleniyor…</b></div>`;

  let result;
  try {
    if (match.r.math) await ensureKatex();
    result = await match.r.view(params, { go });
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty"><div class="e-ico">${ico('alert')}</div><b>Bir şeyler ters gitti</b>
      <p class="small">${(err && err.message) || 'Bilinmeyen hata'}</p>
      <a class="btn" href="#/">Ana sayfa</a></div>`;
    return;
  }

  root.innerHTML = result.html || '';
  setTitle(result.title || '', result.sub || '');
  bindCopy(root);
  fitMath(root);
  if (typeof result.onMount === 'function') {
    currentCleanup = result.onMount(root) || null;
  }

  markNav(match.r.nav);
  document.getElementById('backBtn').hidden = p === '/';
  root.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  refreshChrome();
}

function setTitle(title, sub) {
  document.getElementById('pageTitle').textContent = title || 'TÜ SBKY';
  document.getElementById('pageSub').textContent = sub || 'Siyaset Bilimi ve Kamu Yönetimi';
  document.title = title ? `${title} · TÜ SBKY` : 'TÜ SBKY · Çalışma';
}

function markNav(nav) {
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  // Açık sayfa alt çubukta yoksa (Program, Notlar…) "Menü" sekmesi yansın ki kullanıcı
  // nerede olduğunu kaybetmesin.
  const inTabbar = $$('#tabbar [data-nav]').some((a) => a.dataset.nav === nav);
  document.getElementById('moreBtn')?.classList.toggle('on', !inTabbar);
}

// ---------- mobil "Menü" paneli ----------

const moreSheet = () => document.getElementById('moreSheet');
const moreBtn = () => document.getElementById('moreBtn');

/** Panel içeriğini kenar menüden üretir: bölüm listesi tek yerde (index.html #sidenav) kalsın. */
function buildMoreGrid() {
  const grid = document.getElementById('moreGrid');
  if (!grid || grid.childElementCount) return;
  for (const a of $$('#sidenav a[data-nav]')) {
    const clone = a.cloneNode(true);
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));   // kopya kimlik olmasın
    clone.querySelectorAll('.badge').forEach((el) => el.remove());              // rozet alt çubukta zaten var
    grid.appendChild(clone);
  }
  const settings = document.createElement('a');
  settings.href = '#/ayarlar';
  settings.dataset.nav = '/ayarlar';
  settings.innerHTML = '<svg class="ni" aria-hidden="true"><use href="#i-settings"/></svg><span>Ayarlar</span>';
  grid.appendChild(settings);
}

function openMore() {
  buildMoreGrid();
  markNav(currentRoute?.nav);
  moreSheet().hidden = false;
  moreBtn().setAttribute('aria-expanded', 'true');
  document.getElementById('moreGrid').querySelector('a.on, a')?.focus({ preventScroll: true });
}

function closeMore() {
  if (moreSheet().hidden) return;
  moreSheet().hidden = true;
  moreBtn().setAttribute('aria-expanded', 'false');
}

// ---------- kabuk bilgileri (streak, kart rozeti, hedef halkası) ----------

let allCardsCache = null;
async function allCards() {
  if (!allCardsCache) allCardsCache = await getAllCardIds();
  return allCardsCache;
}

export async function refreshChrome() {
  const s = store.state;
  document.getElementById('streakNum').textContent = s.streak.current || 0;

  const cards = await allCards();
  const { total } = dueCount(cards, s.srs);
  for (const id of ['dueBadge', 'dueBadgeM']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = total > 99 ? '99+' : total;
    el.hidden = total === 0;
  }

  const today = store.todayStats();
  const goal = s.settings.dailyGoal || 30;
  const pct = Math.min(100, Math.round((today.minutes / goal) * 100));
  const ringEl = document.getElementById('goalRing');
  if (ringEl) {
    ringEl.style.background = `conic-gradient(var(--acc) ${pct * 3.6}deg, var(--surface-2) 0)`;
    ringEl.innerHTML = `<span style="background:var(--bg);width:40px;height:40px;border-radius:50%;display:grid;place-content:center">${today.minutes}′</span>`;
    ringEl.title = `Bugün ${today.minutes} dk / hedef ${goal} dk`;
  }
}

export function invalidateCards() { allCardsCache = null; invalidateSearchIndex(); }

// ---------- tema ----------

// CSS'te her palet tek yerde tanımlı (:root = kâğıt, [data-theme="dark"] = ozalit), bu yüzden
// "Sistem" seçiliyken de burada çözülmüş bir değer damgalanır. Eskiden "auto" damgayı
// kaldırıyordu ve CSS'te sistem sorgusu olmadığı için açık temalı telefonda da koyu açılıyordu.
const systemDark = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const t = store.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && systemDark.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f151b' : '#f2f4f6';
}

// Sistem teması uygulama açıkken değişirse (ör. akşam otomatik koyu mod) hemen uy.
// (Dinleyici aşağıda, başlangıç bölümünde bağlanıyor.)

/**
 * Konu anlatımının punto ve satır aralığını kullanıcı tercihine göre ayarlar.
 * Temanın kendi değerleri css/app.css'te; burada yalnızca fark varsa üzerine yazılır,
 * böylece tema ileride değişirse ayara dokunmayan kullanıcı yeni değerleri alır.
 */
export function applyReading() {
  const { readingSize, readingLine } = store.settings;
  const html = document.documentElement;
  // null ise temanın kendi değeri geçerli olsun diye satır içi tanımı kaldırıyoruz.
  if (readingSize) html.style.setProperty('--prose-size', `${readingSize}px`);
  else html.style.removeProperty('--prose-size');
  if (readingLine) html.style.setProperty('--prose-lh', String(readingLine));
  else html.style.removeProperty('--prose-lh');
}

// ---------- çalışma süresi sayacı + ekranı açık tutma ----------
//
// ESKİDEN sabit 30 sn'lik tikler sayılıyordu. Tarayıcı, arka plandaki (ya da ekranı kapanmış)
// sekmede zamanlayıcıları dakikada bire indirdiği, uzun süre sonra tamamen dondurduğu için
// bu sayım gerçek süreyi tutmuyordu. Artık geçen GERÇEK zaman ölçülür: yalnızca sayfa
// görünürken ve çalışma ekranındayken işler, donma sonrası toplu sıçrama yapmaz.

const TICK_MS = 15000;
const MAX_STEP_MS = 90000;   // donma/uyku sonrası tek adımda en fazla bu kadarı sayılır
let studyMs = 0;
let lastMark = Date.now();
let wasStudying = false;

const studying = () => !document.hidden && !!currentRoute && !!currentRoute.study;

function accrueStudy() {
  const now = Date.now();
  const dt = now - lastMark;
  lastMark = now;
  // Süre, ARALIĞIN BAŞINDAKİ duruma göre sayılır: sekme gizlendiğinde olay zaten
  // document.hidden=true ile gelir, o ana kadarki görünür süre yoksa kaybolurdu.
  if (wasStudying && dt > 0) {
    studyMs += Math.min(dt, MAX_STEP_MS);
    const mins = Math.floor(studyMs / 60000);
    if (mins >= 1) {
      studyMs -= mins * 60000;
      store.addMinutes(mins);
      refreshChrome();
    }
  }
  wasStudying = studying();
}

/** Sayacı ve ekran kilidini o anki ekrana/ayara göre günceller. */
function syncStudy() {
  accrueStudy();
  setWakeLockWanted(store.settings.keepAwake !== false && !!currentRoute && !!currentRoute.study);
}

setInterval(accrueStudy, TICK_MS);
document.addEventListener('visibilitychange', accrueStudy);
window.addEventListener('pagehide', accrueStudy);

/** Ayarlar'daki "ekran kapanmasın" anahtarı değişince hemen uygulanır. */
export function applyKeepAwake() { syncStudy(); }

// ---------- başlangıç ----------

window.addEventListener('hashchange', render);

// Başka cihazdan veri geldiğinde, oturum ya da AKTS düzeltmeleri değiştiğinde ekranı tazele.
// Çalışma ekranlarında (konu, quiz, kart, sınav) yeniden çizilmez: yarım kalan soru kaybolmasın;
// yeni veri bir sonraki açılışta görünür.
for (const ev of ['tusbky:synced', 'tusbky:user', 'tusbky:akts']) {
  window.addEventListener(ev, () => {
    refreshChrome();
    if (currentRoute && !currentRoute.study && currentRoute.nav !== '/hesap') render();
  });
}

document.getElementById('backBtn').addEventListener('click', () => history.back());
document.getElementById('moreBtn').addEventListener('click', () => (moreSheet().hidden ? openMore() : closeMore()));
moreSheet().addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target.closest('a[href]')) closeMore();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
window.addEventListener('hashchange', closeMore);
document.getElementById('settingsBtn').addEventListener('click', () => go('/ayarlar'));
document.getElementById('searchBtn').addEventListener('click', () => go('/ara'));
document.getElementById('streakBox').addEventListener('click', () => go('/istatistik'));

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

(async function boot() {
  applyTheme();
  applyReading();
  try {
    await Promise.all([getCurriculum(), getIndex()]);
  } catch (err) {
    document.getElementById('splash').innerHTML =
      `<div class="empty"><div class="e-ico">${ico('offline')}</div><b>Veri yüklenemedi</b>
       <p class="small">Uygulamayı bir web sunucusu üzerinden aç (README'ye bak).<br>${err.message}</p></div>`;
    return;
  }
  document.getElementById('splash').remove();
  document.getElementById('shell').hidden = false;

  // Oturum ve AKTS düzeltmeleri ekranla PARALEL başlar (beklenmez, açılışı yavaşlatmaz).
  // render()'dan sonraya koymak kilitlenme yaratıyordu: #/akts gibi oturumu bekleyen bir
  // sayfa doğrudan açılınca, sayfa oturumu, oturum da sayfanın bitmesini bekliyordu.
  startSync();
  refreshAkts();
  await render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');

      // DİKKAT: dinleyici register'dan HEMEN sonra, araya `await` koymadan bağlanmalı;
      // arada bekleme olursa olay kaçar.
      swReg = reg;

      // Yeni sürüm ÖNCEKİ ziyarette inip beklemeye geçtiyse 'updatefound' bir daha
      // tetiklenmez; bu yüzden açılışta bekleyeni doğrudan sınıyoruz. (Telefonda
      // "Yeni içerik hazır" çubuğunun hiç çıkmamasının sebebi buydu.)
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();

      // Tarayıcı güncellemeyi kendi takvimine göre sorar; uygulamaya her dönüldüğünde
      // (en fazla 30 dakikada bir) biz de soruyoruz.
      let lastCheck = Date.now();
      const recheck = () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60e3) return;
        lastCheck = Date.now();
        reg.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', recheck);

      reg.addEventListener('updatefound', () => {
        // Bu olay ilk kurulumda da tetiklenir. Ayrımı O AN yönetici olup olmadığı verir:
        // yönetici varsa sayfa zaten eski sürümle çalışıyor, yani bu bir güncellemedir.
        // (Anlık görüntüyü sayfa açılışında almak yanlış: ilk kayıt da aynı oturumda olabiliyor.)
        if (!navigator.serviceWorker.controller) return;
        // Kurulum artık hızlı bittiği için (service worker kurulumda 35 MB indirmiyor)
        // `installing` biz bakmadan boşalabiliyor; `waiting`/`active` de denenir ve
        // o anki durum hemen sınanır.
        const sw = reg.installing || reg.waiting || reg.active;
        if (!sw) return;
        const check = () => {
          if (sw.state === 'installed' || sw.state === 'activated') showUpdateBar();
        };
        check();
        sw.addEventListener('statechange', check);
      });

      // Hangi yarıyıldaysak onun derslerini önce indir: çevrimdışı kalındığında en olası
      // dersler hazır olsun. (Service worker localStorage'a erişemez, bu yüzden sayfa söyler.)
      const sem = store.state.settings.activeSemester || (await getCurriculum()).activeSemester;
      const mine = Object.keys(store.state.enrollment || {});
      const tellSW = () => navigator.serviceWorker.controller?.postMessage({ type: 'prefetch', semester: sem, codes: mine });
      tellSW();
      navigator.serviceWorker.addEventListener('controllerchange', tellSW);
    } catch (err) {
      // Sessiz yutma YOK: bir keresinde buradaki hata (register satırının kazara silinmesi)
      // fark edilmedi ve uygulama çevrimdışı desteğini tamamen kaybetti. Çevrimdışı olmak
      // ya da desteklenmemek normaldir, ama konsola bir iz bırakmalı.
      console.warn('Service worker kaydı yapılamadı:', err && err.message);
    }
  }
})();

function showUpdateBar() {
  if (document.getElementById('updateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBar';
  bar.className = 'update-bar';
  bar.innerHTML = '<span>Yeni içerik hazır</span><button class="btn primary" id="updateBtn">Yenile</button>';
  document.body.appendChild(bar);
  bar.querySelector('#updateBtn').addEventListener('click', () => applyUpdate());
}

// ---------- sürüm ve güncelleme (Hesap ekranındaki kart da bunları kullanır) ----------

let swReg = null;

/**
 * Şu an ÇALIŞAN kodun sürümü. sw.js'teki VERSION ile aynı olmalı; tools/build-dist.mjs
 * paketlerken ikisini karşılaştırır ve farklıysa yayına izin vermez.
 *
 * Neden service worker'a sormuyoruz: yeni sürüm indiğinde service worker kendini hemen
 * devreye alıyor, yani "çalışan service worker" güncel görünürken ekrandaki HTML/JS hâlâ
 * eski olabiliyor. Karşılaştırmanın doğru tarafı, sayfanın kendi kodudur.
 */
export const APP_VERSION = 'v1.8.1';

/** Çalışan service worker'a sorar. Yanıt yoksa null (henüz yönetmiyordur). */
function askSw(message, timeout = 1500) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return resolve(null);
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeout);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    try { sw.postMessage(message, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
  });
}

/** { installed, server, waiting } — yüklü sürüm, sunucudaki sürüm, hazır bekleyen var mı. */
export async function updateInfo() {
  const reg = swReg || (await navigator.serviceWorker?.getRegistration?.().catch(() => null)) || null;
  swReg = reg;
  const [msg, server] = await Promise.all([
    askSw({ type: 'version' }),
    // Sorgu ekliyoruz: düz 'sw.js' isteğini service worker'ın kendi önbelleği karşılıyor ve
    // hep eski sürümü döndürüyordu — uygulama kendi güncellemesini göremiyordu.
    fetch(`sw.js?v=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.text())
      .then((t) => (t.match(/VERSION = '([^']+)'/) || [])[1] || null)
      .catch(() => null),
  ]);
  const installed = msg?.version || null;      // çalışan service worker (bilgi amaçlı)
  const needsReload = !!reg?.waiting || (!!server && server !== APP_VERSION);
  return { installed, server, loaded: APP_VERSION, waiting: !!reg?.waiting, needsReload, supported: !!navigator.serviceWorker };
}

/** Sunucuda yeni sürüm var mı diye sorar; indiyse hazır bekler. */
export async function checkUpdate() {
  const reg = swReg || (await navigator.serviceWorker?.getRegistration?.().catch(() => null));
  swReg = reg;
  if (!reg) return { supported: false };
  try { await reg.update(); } catch { /* çevrimdışı olabilir */ }
  // Kurulum birkaç saniye sürebilir; bitmesini kısa süre bekle.
  for (let i = 0; i < 20 && (reg.installing || (!reg.waiting && !reg.active)); i++) {
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ...(await updateInfo()), supported: true };
}

/**
 * Yeni sürümü devreye alıp sayfayı yeniler.
 * Yeni sürüm hâlâ iniyorsa önce kurulumun bitmesini bekler: aksi hâlde sayfa yenilenir
 * ama yine eski kopya açılır (kullanıcı "güncelledim" sanır, hiçbir şey değişmez).
 */
export async function applyUpdate() {
  const reg = swReg || (await navigator.serviceWorker?.getRegistration?.().catch(() => null));
  const pending = reg?.waiting || reg?.installing;
  if (pending && pending.state === 'installing') {
    await new Promise((res) => {
      const done = () => { if (pending.state === 'installed' || pending.state === 'activated' || pending.state === 'redundant') res(); };
      pending.addEventListener('statechange', done);
      setTimeout(res, 20000);      // inmesi uzarsa yine de devam et
      done();
    });
  }
  reg?.waiting?.postMessage('skipWaiting');

  // Yeni sürüm "etkinleşiyor" durumundayken yenilersek sayfayı hâlâ eski service worker
  // karşılar ve ESKİ kopya açılır — kullanıcı güncellediğini sanır. Devralma bitene kadar
  // (en fazla 10 sn) bekliyoruz.
  const ready = () => !!reg?.active && reg.active.state === 'activated' && !reg.waiting && !reg.installing;
  for (let i = 0; i < 40 && reg && !ready(); i++) await new Promise((r) => setTimeout(r, 250));
  location.reload();
}

/**
 * Son çare: service worker kaydını ve önbellekleri silip baştan kurar. Ders içeriği
 * yeniden inmek zorunda kalır, o yüzden yalnızca güncelleme bir türlü gelmiyorsa.
 */
export async function resetAppCache() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* desteklenmiyorsa sorun değil */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tusbky-')).map((k) => caches.delete(k)));
  } catch { /* yok sayılır */ }
  location.reload();
}

// Klavye kısayolları (masaüstü)
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { d: '/dersler', k: '/kartlar', s: '/sinav', p: '/program', i: '/istatistik', h: '/', a: '/ara', y: '/yanlislarim', n: '/notlarim', g: '/notlar', m: '/derslerim' };
  const to = map[e.key.toLowerCase()];
  if (to) { go(to); e.preventDefault(); }
});

export { toast };
