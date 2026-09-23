// sync.js — oturum ve eşitleme yönetimi.
//
// Uygulamanın geri kalanı bu dosyayı bilmek zorunda değil: tüm ekranlar eskisi gibi
// store'u okuyup yazar. Burası store'daki değişiklikleri izler, giriş yapılmışsa buluta
// taşır ve diğer cihazlardan gelenleri geri birleştirir (kurallar: syncmerge.js).
//
// Akış:
//   değişiklik → 0,8 sn sonra hangi anahtarların değiştiği bulunur (zaman damgası)
//              → 4 sn sonra eşitleme: buluttan oku → birleştir → yerele uygula → farkı yaz
//   uygulama arka plana geçince hemen eşitlenir (telefonda kapatılmadan önce veri kaçmasın)
//   uygulamaya dönülünce / internet gelince / girişte buluttan çekilir

import { store } from './store.js';
import { mergeState, splitDocs, joinDocs, hash, isEmpty, ACCUMULATIVE, LOCAL_ONLY } from './syncmerge.js';
import { cloudConfigured } from './cloud.js';

const META_KEY = 'tusbky.sync';
const PUSH_DELAY = 4000;
const PULL_MIN_GAP = 60e3;

// ---------------------------------------------------------------- yerel iz

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    if (m && typeof m === 'object') return { uid: m.uid || null, at: m.at || {}, base: m.base || {}, snap: m.snap || {}, lastSync: m.lastSync || 0 };
  } catch { /* bozuksa sıfırdan */ }
  return { uid: null, at: {}, base: {}, snap: {}, lastSync: 0 };
}
let meta = loadMeta();
const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* kota */ } };

const keyHash = (v) => hash(JSON.stringify(v ?? null));

/**
 * Hangi anahtarların değiştiğini bulup zaman damgası vurur. Anahtarın ilk kez görülmesi
 * değişiklik sayılmaz: eski sürümden gelen veriler at=0 kalır ve buluttaki daha yeni
 * tercihlere yol verir.
 */
function trackChanges() {
  clearTimeout(diffTimer);
  const now = Date.now();
  let changed = false;
  for (const [key, v] of Object.entries(store.state)) {
    if (LOCAL_ONLY.includes(key)) continue;
    const h = keyHash(v);
    if (meta.snap[key] === h) continue;
    if (meta.snap[key] !== undefined) {
      meta.at[key] = now;
      // Birikimli veri doludan boşa geçtiyse bu bir sıfırlamadır; diğer cihazlara da yayılsın.
      if (ACCUMULATIVE.includes(key) && isEmpty(v)) meta.base[key] = now;
      changed = true;
    }
    meta.snap[key] = h;
  }
  saveMeta();
  return changed;
}

let diffTimer = null;
let applying = false;
store.subscribe(() => {
  if (applying) return;
  clearTimeout(diffTimer);
  diffTimer = setTimeout(() => { if (trackChanges()) schedulePush(); }, 800);
});
// Açılışta anlık görüntü: sonraki ilk değişiklik doğru tespit edilsin.
trackChanges();

// ---------------------------------------------------------------- durum yayını

let user = null;
let authKnown = !cloudConfigured();     // yapılandırma yoksa "oturum yok" kesin
let status = { state: 'idle', at: meta.lastSync, error: null };
const listeners = new Set();

function emit() {
  for (const fn of listeners) { try { fn({ user, authKnown, status }); } catch { /* dinleyici hatası eşitlemeyi bozmasın */ } }
}
function setStatus(state, extra = {}) {
  status = { state, at: meta.lastSync, error: null, ...extra };
  emit();
}

/** { user, authKnown, status } değişikliklerini dinler. Dönüş: dinlemeyi bırakan fonksiyon. */
export function onSync(fn) {
  listeners.add(fn);
  fn({ user, authKnown, status });
  return () => listeners.delete(fn);
}
export const getUser = () => user;
export const isAuthKnown = () => authKnown;
export const getSyncStatus = () => status;

// ---------------------------------------------------------------- eşitleme

let syncing = null;
let followUp = null;
let pushTimer = null;

function schedulePush(delay = PUSH_DELAY) {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), delay);
}

/**
 * Buluttan oku → birleştir → yerele uygula → farkı yaz. Aynı anda tek eşitleme çalışır.
 *
 * Eşitleme sürerken tekrar çağrılırsa, süreni DEĞİL onun ardından başlayan yeni bir turu
 * bekler: süren tur çağrıdan önceki durumu okumuş olabilir. (Aksi hâlde "Çıkış yap" son
 * değişikliği yazılmadan oturumu kapatabiliyordu — uçtan uca testte yakalandı.)
 */
export function syncNow() {
  if (!user) return Promise.resolve();
  if (syncing) {
    if (!followUp) followUp = syncing.then(() => { followUp = null; return syncNow(); });
    return followUp;
  }
  const uid = user.uid;
  syncing = (async () => {
    setStatus('syncing');
    try {
      trackChanges();
      const c = await import('./cloud.js');
      const remoteDocs = await c.readState(uid);
      if (!user || user.uid !== uid) return;          // beklerken çıkış yapıldıysa bırak

      // --- eşzamanlı bölüm: araya await girmez, bu sırada yapılan değişiklik kaybolmaz ---
      const before = Object.fromEntries(Object.entries(store.state).map(([k, v]) => [k, keyHash(v)]));
      const merged = mergeState(store.state, meta, joinDocs(remoteDocs));
      const localChanged = Object.keys(merged.state).some((k) => !LOCAL_ONLY.includes(k) && keyHash(merged.state[k]) !== before[k]);
      if (localChanged) {
        applying = true;
        try { store.replaceAll(merged.state); } finally { applying = false; }
      }
      meta.at = merged.meta.at;
      meta.base = merged.meta.base;
      for (const [k, v] of Object.entries(store.state)) if (!LOCAL_ONLY.includes(k)) meta.snap[k] = keyHash(v);

      // --- yalnızca buluttakinden farklı olan belgeleri yaz ---
      const docs = splitDocs(store.state, meta);
      // Sıfırlamadan sonra artık kartı kalmayan dersin eski parçası boşaltılır.
      for (const id of Object.keys(remoteDocs)) {
        if (id.startsWith('srs~') && !docs[id]) docs[id] = { key: 'srs', v: {}, at: meta.at.srs || 0, base: meta.base.srs || 0 };
      }
      const writes = {};
      for (const [id, d] of Object.entries(docs)) {
        const r = remoteDocs[id];
        if (!r || keyHash([d.v, d.at, d.base]) !== keyHash([r.v, r.at, r.base])) writes[id] = d;
      }
      if (Object.keys(writes).length) await c.writeState(uid, writes);

      meta.uid = uid;
      meta.lastSync = Date.now();
      saveMeta();
      setStatus('ok', { writes: Object.keys(writes).length, pulled: localChanged });
      if (localChanged) window.dispatchEvent(new CustomEvent('tusbky:synced'));
    } catch (err) {
      console.warn('Eşitleme yapılamadı:', err?.code || err?.message || err);
      setStatus(navigator.onLine === false ? 'offline' : 'error', { error: err?.code || err?.message || String(err) });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// ---------------------------------------------------------------- oturum

/** Bu cihazdaki kopyayı temizler (başka hesaba geçiş ya da çıkış). */
function wipeLocal() {
  clearTimeout(diffTimer);
  clearTimeout(pushTimer);
  applying = true;
  try { store.reset(); } finally { applying = false; }
  meta = { uid: null, at: {}, base: {}, snap: {}, lastSync: 0 };
  trackChanges();
}

let started = false;

/** Açılışta bir kez çağrılır. Hesap sistemi yapılandırılmamışsa hiçbir şey yapmaz. */
export async function startSync() {
  if (started || !cloudConfigured()) return;
  started = true;
  const c = await import('./cloud.js');
  const redirectErr = await c.completeRedirect();
  if (redirectErr) setStatus('error', { error: redirectErr.code || String(redirectErr) });

  await c.onUser(async (u) => {
    // Bu cihazda başka bir hesabın verisi varsa önce temizle: hesaplar birbirine karışmasın.
    // (Hiç giriş yapılmamış cihazdaki veri ise yeni hesaba aktarılır — ilk girişte kayıp olmaz.)
    if (u && meta.uid && meta.uid !== u.uid) wipeLocal();
    user = u;
    authKnown = true;
    emit();
    window.dispatchEvent(new CustomEvent('tusbky:user'));
    if (!u) { setStatus('signedout'); return; }
    await syncNow();
    // Ad hesaptan gelsin — eşitlemeden SONRA: önce yapılsa yerel "ayarlar" yeni sayılır ve
    // diğer cihazdaki tema, punto gibi tercihleri ezerdi.
    if (!store.state.settings.name && u.displayName) {
      store.update((s) => { s.settings.name = u.displayName.trim().split(/\s+/)[0]; });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!user) return;
    if (document.visibilityState === 'hidden') syncNow();
    else if (Date.now() - (meta.lastSync || 0) > PULL_MIN_GAP) syncNow();
  });
  window.addEventListener('online', () => { if (user) syncNow(); });
}

/** Çıkış: son değişiklikleri buluta yaz, oturumu kapat, bu cihazdaki kopyayı sil. */
export async function signOut() {
  if (user) {
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 6000))]);
  }
  const c = await import('./cloud.js');
  await c.signOutUser();
  user = null;
  wipeLocal();
  // store'un kayıt zamanlayıcısı (120 ms) boş durumu yazsın, sonra temiz açılış.
  setTimeout(() => location.reload(), 300);
}
