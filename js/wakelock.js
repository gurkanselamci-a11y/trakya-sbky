// wakelock.js — çalışma ekranlarında ekranın kararmasını / ekran koruyucuya geçmesini engeller.
//
// Screen Wake Lock API'sinde kilit, sayfa gizlendiği anda (sekme değişimi, ekran kilidi,
// pencerenin küçültülmesi) tarayıcı tarafından SESSİZCE bırakılır ve geri dönüldüğünde
// kendiliğinden geri gelmez. Bu yüzden "istenen durum" burada bir bayrakta tutulur;
// sayfa yeniden görünür olduğunda kilit tekrar alınır. Yoksa sekmeden bir kez çıkmak
// özelliği o oturum boyunca kapatırdı.
//
// Kilit alınamaması normaldir (tarayıcı desteklemiyor, pil tasarrufu açık, sayfa arka planda);
// bu durumda uygulama eskisi gibi çalışır, yalnızca ekran kendi süresinde kapanır.

const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

let wanted = false;
let sentinel = null;
let pending = false;
let lastError = null;

export function wakeLockSupported() { return supported; }
export function wakeLockActive() { return !!sentinel; }
export function wakeLockError() { return lastError; }

async function acquire() {
  if (!supported || !wanted || sentinel || pending) return;
  // Gizliyken istek kesin reddedilir — görünür olunca visibilitychange tekrar dener.
  if (document.visibilityState !== 'visible') return;
  pending = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    if (!wanted) { s.release().catch(() => {}); return; }  // beklerken vazgeçildi
    sentinel = s;
    lastError = null;
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
  } catch (err) {
    lastError = (err && err.message) || String(err);
    console.debug('Ekran kilidi alınamadı:', lastError);
  } finally {
    pending = false;
  }
}

function releaseNow() {
  const s = sentinel;
  sentinel = null;
  if (s) s.release().catch(() => {});
}

/** Çalışma ekranlarında `true`, diğerlerinde `false` — kilit buna göre alınır/bırakılır. */
export function setWakeLockWanted(next) {
  wanted = !!next && supported;
  if (wanted) acquire(); else releaseNow();
}

if (supported) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
}
