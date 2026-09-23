// cloud.js — Firebase ile konuşan tek dosya: giriş, bulut durum belgeleri, AKTS düzeltmeleri.
//
// Firebase SDK'sı (vendor/firebase, ~400 KB) yalnızca gerçekten gerektiğinde, dinamik
// import ile yüklenir; açılış hızı etkilenmez. SDK dosyaları service worker önbelleğinde
// olduğu için çevrimdışıyken de yüklenir — sadece ağ isteği atılamaz.
//
// Veriler JSON metni olarak saklanır (`v` alanı). Firestore'un tür kısıtlarına (iç içe dizi
// yasağı, "/" içeren anahtarlar, undefined) takılmamak için bilinçli bir tercih: uygulama
// verisini sorgulamıyoruz, yalnızca kullanıcının kopyasını taşıyoruz.

import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

// Yerel test: http://localhost:5173/?emu açılırsa Firebase emülatörüne bağlanır
// (tools/test-cloud.mjs). Yayındaki sitede hostname localhost olmadığı için devreye girmez.
const EMU = (() => {
  try {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
    if (new URLSearchParams(location.search).has('emu')) sessionStorage.setItem('tusbky.emu', '1');
    return sessionStorage.getItem('tusbky.emu') === '1';
  } catch { return false; }
})();

export const cloudConfigured = () => !!firebaseConfig || EMU;

let fb = null;

/** Firebase'i başlatır (bir kez). Yapılandırma yoksa null. */
export async function cloud() {
  if (fb) return fb;
  if (!cloudConfigured()) return null;
  const [appM, A, F] = await Promise.all([
    import('../vendor/firebase/firebase-app.js'),
    import('../vendor/firebase/firebase-auth.js'),
    import('../vendor/firebase/firebase-firestore-lite.js'),
  ]);
  const config = EMU
    ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-tusbky', appId: 'demo-app' }
    : firebaseConfig;
  const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(config);
  const auth = A.initializeAuth(app, {
    persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
    popupRedirectResolver: A.browserPopupRedirectResolver,
  });
  auth.languageCode = 'tr';
  const db = F.getFirestore(app);
  if (EMU) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  fb = { app, auth, db, A, F };
  return fb;
}

// ---------------------------------------------------------------- giriş

/** Oturum değişikliklerini dinler. Dönüş: dinlemeyi bırakan fonksiyon. */
export async function onUser(cb) {
  const c = await cloud();
  if (!c) { cb(null); return () => {}; }
  return c.A.onAuthStateChanged(c.auth, cb);
}

export async function signInEmail(email, password) {
  const { A, auth } = await cloud();
  return (await A.signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function signUpEmail(name, email, password) {
  const { A, auth } = await cloud();
  const { user } = await A.createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name) await A.updateProfile(user, { displayName: name.trim() });
  // Doğrulama zorunlu değil; ama şifre sıfırlama ve yönetici yetkisi doğrulanmış e-posta ister.
  try { await A.sendEmailVerification(user); } catch { /* sessiz: giriş yine de başarılı */ }
  return user;
}

/**
 * Google ile giriş. Önce açılır pencere denenir; tarayıcı engellerse (bazı telefonlarda,
 * ana ekrana eklenmiş uygulamada) sayfa yönlendirmesine düşer — dönüşte completeRedirect.
 */
export async function signInGoogle() {
  const { A, auth } = await cloud();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return (await A.signInWithPopup(auth, provider)).user;
  } catch (err) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err?.code)) {
      await A.signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

/** Google yönlendirmesinden dönüldüyse sonucu tamamlar. Hata varsa döndürür, fırlatmaz. */
export async function completeRedirect() {
  const c = await cloud();
  if (!c) return null;
  try { await c.A.getRedirectResult(c.auth); return null; } catch (err) { return err; }
}

export async function resetPassword(email) {
  const { A, auth } = await cloud();
  await A.sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification() {
  const { A, auth } = await cloud();
  if (auth.currentUser) await A.sendEmailVerification(auth.currentUser);
}

export async function signOutUser() {
  const { A, auth } = await cloud();
  await A.signOut(auth);
}

/** Arayüzde düzenleme ekranını göstermek için. Asıl yetki kontrolü firestore.rules'da. */
export function isAdmin(user) {
  return !!user && !!user.emailVerified && ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
}

export function providerOf(user) {
  const ids = (user?.providerData || []).map((p) => p.providerId);
  if (ids.includes('google.com') && ids.includes('password')) return 'Google + e-posta';
  if (ids.includes('google.com')) return 'Google';
  return 'E-posta';
}

/** Firebase hata kodunu kullanıcının anlayacağı Türkçe cümleye çevirir. */
export function authMessage(err) {
  const code = err?.code || '';
  const M = {
    'auth/invalid-email': 'E-posta adresi geçersiz.',
    'auth/missing-email': 'E-posta adresini yaz.',
    'auth/missing-password': 'Şifreni yaz.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/email-already-in-use': 'Bu e-postayla zaten bir hesap var. "Giriş yap"ı seç ya da şifreni sıfırla.',
    'auth/invalid-credential': 'E-posta ya da şifre hatalı.',
    'auth/wrong-password': 'E-posta ya da şifre hatalı.',
    'auth/user-not-found': 'Bu e-postayla bir hesap yok. "Hesap aç"ı seç.',
    'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.',
    'auth/network-request-failed': 'İnternet bağlantısı yok. Giriş için bağlantı gerekiyor.',
    'auth/popup-closed-by-user': 'Google penceresi kapatıldı.',
    'auth/cancelled-popup-request': 'Google penceresi kapatıldı.',
    'auth/account-exists-with-different-credential': 'Bu e-posta başka bir yöntemle kayıtlı. O yöntemle giriş yap.',
    'auth/unauthorized-domain': 'Bu alan adı Firebase\'de yetkili değil. Firebase → Authentication → Settings → Authorized domains listesine ekle.',
    'auth/operation-not-allowed': 'Bu giriş yöntemi Firebase\'de açılmamış. Firebase → Authentication → Sign-in method.',
  };
  return M[code] || `İşlem tamamlanamadı (${code || err?.message || 'bilinmeyen hata'}).`;
}

// ---------------------------------------------------------------- kullanıcı verisi

/** users/{uid}/state altındaki tüm belgeleri okur: { docId: { v, at, base } } */
export async function readState(uid) {
  const { db, F } = await cloud();
  const snap = await F.getDocs(F.collection(db, 'users', uid, 'state'));
  const out = {};
  snap.forEach((d) => {
    const x = d.data();
    let v;
    try { v = JSON.parse(x.v); } catch { return; }   // bozuk belge eşitlemeyi durdurmasın
    out[d.id] = { v, at: Number(x.at) || 0, base: Number(x.base) || 0 };
  });
  return out;
}

/** Değişen belgeleri toplu yazar. docs = { docId: { v, at, base } } */
export async function writeState(uid, docs) {
  const { db, F } = await cloud();
  const entries = Object.entries(docs);
  // Firestore toplu yazma sınırı 500 işlem; pay bırakıyoruz.
  for (let i = 0; i < entries.length; i += 400) {
    const batch = F.writeBatch(db);
    for (const [id, d] of entries.slice(i, i + 400)) {
      batch.set(F.doc(db, 'users', uid, 'state', id), {
        v: JSON.stringify(d.v ?? null),
        at: Number(d.at) || 0,
        base: Number(d.base) || 0,
      });
    }
    await batch.commit();
  }
}

// ---------------------------------------------------------------- AKTS düzeltmeleri

/** config/akts — herkes okuyabilir. { overrides: {KOD: sayı}, updatedAt, updatedBy } | null */
export async function readAktsConfig() {
  const { db, F } = await cloud();
  const s = await F.getDoc(F.doc(db, 'config', 'akts'));
  return s.exists() ? s.data() : null;
}

/** Yalnızca yönetici yazabilir (firestore.rules). */
export async function writeAktsConfig(overrides, email) {
  const { db, F } = await cloud();
  const data = { overrides, updatedAt: Date.now(), updatedBy: String(email || '') };
  await F.setDoc(F.doc(db, 'config', 'akts'), data);
  return data;
}
