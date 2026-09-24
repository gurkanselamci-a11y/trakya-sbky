// views/account.js — giriş, hesap açma ve eşitleme durumu.

import { store } from '../store.js';
import { escHtml, toast, confirmAction } from '../ui.js';
import { ico } from '../icons.js';
import { cloudConfigured } from '../cloud.js';
import { onSync, syncNow, signOut, getUser, getSyncStatus } from '../sync.js';
import { updateInfo, checkUpdate, applyUpdate, resetAppCache } from '../app.js';

// Google'ın marka yönergesindeki çok renkli "G" — giriş düğmesinde tek renkli simge kullanılamaz.
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function ago(ms) {
  if (!ms) return 'henüz eşitlenmedi';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  return new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLine(st) {
  switch (st.state) {
    case 'syncing': return { cls: 'busy', text: 'Eşitleniyor…' };
    case 'ok': return { cls: 'ok', text: `Eşitlendi · ${ago(st.at)}` };
    case 'offline': return { cls: 'warn', text: `Çevrimdışı — internet gelince eşitlenecek · son: ${ago(st.at)}` };
    case 'error': return { cls: 'bad', text: `Eşitlenemedi (${st.error || 'bilinmeyen hata'}) · son: ${ago(st.at)}` };
    default: return { cls: '', text: ago(st.at) };
  }
}

const initials = (name, email) => (String(name || email || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toLocaleUpperCase('tr');

/**
 * Uygulama sürümü kartı. Hesap sistemi kapalıyken de görünmeli: "Yeni içerik hazır"
 * çubuğu her zaman çıkmıyor ve kullanıcının elle güncelleme denetleyecek, gerekirse
 * önbelleği temizleyecek başka bir yolu yok. Kart eskiden yalnızca bulut açıkken
 * çiziliyordu; Firebase kapalı kurulumda bu düğmelere hiç erişilemiyordu.
 */
const versionCardHtml = () => `
  <div class="card" id="verCard">
    <h2 style="margin-top:0">Uygulama sürümü</h2>
    <p class="small" id="verLine" style="margin:0 0 12px">Sürüm okunuyor…</p>
    <div class="btn-row">
      <button class="btn" id="verCheck" type="button">${ico('refresh')} Güncelleme var mı?</button>
      <button class="btn primary" id="verApply" type="button" hidden>${ico('download')} Yeni sürüme geç</button>
    </div>
    <p class="tiny muted" style="margin:12px 0 0">Güncelleme bir türlü gelmiyorsa
    <button type="button" class="linkish" id="verReset">önbelleği temizle ve baştan kur</button> —
    ders içeriği yeniden indirilir.</p>

    <div id="verLog" class="changelog"></div>
  </div>`;

/** Sürüm kartının düğmelerini bağlar; hem bulutlu hem bulutsuz kurulumda çağrılır. */
function wireVersionCard(root) {
  const verLine = root.querySelector('#verLine');
  const verCheck = root.querySelector('#verCheck');
  const verApply = root.querySelector('#verApply');
  if (!verLine || !verCheck || !verApply) return;

  const showVersion = (info) => {
    if (!info.supported) { verLine.textContent = 'Bu tarayıcı çevrimdışı çalışmayı desteklemiyor.'; verCheck.hidden = true; return; }
    const now = info.loaded || info.installed || 'bilinmiyor';
    if (info.needsReload) {
      verLine.innerHTML = `Bu sayfa <b>${escHtml(now)}</b> sürümüyle açık · yeni sürüm <b>${escHtml(info.server || info.installed || '?')}</b> hazır.`;
      verApply.hidden = false;
    } else {
      verLine.innerHTML = `Sürüm <b>${escHtml(now)}</b> · güncel.`;
      verApply.hidden = true;
    }
  };

  updateInfo().then(showVersion).catch(() => { verLine.textContent = 'Sürüm okunamadı.'; });

  // ---------- sürüm geçmişi ----------
  // Liste data/changelog.json'dan gelir (service worker önbelleğinde; çevrimdışı da
  // açılır). Son sürüm açık gösterilir, eskiler katlanır: kart uzayıp sayfayı
  // boğmasın ama "ne değişti" sorusunun cevabı hep burada dursun.
  const verLog = root.querySelector('#verLog');
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const tarihYaz = (s) => {
    const [y, a, g] = String(s || '').split('-').map(Number);
    return y && a && g ? `${g} ${AY[a - 1]} ${y}` : '';
  };
  const surumBlok = (x) => `
    <div class="cl-item">
      <div class="cl-head"><b>${escHtml(x.v)}</b><span class="tiny muted">${escHtml(tarihYaz(x.tarih))}</span></div>
      <div class="cl-title">${escHtml(x.baslik || '')}</div>
      ${x.maddeler?.length ? `<ul class="cl-list">${x.maddeler.map((m) => `<li>${escHtml(m)}</li>`).join('')}</ul>` : ''}
    </div>`;

  if (verLog) {
    fetch('data/changelog.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((liste) => {
        if (!Array.isArray(liste) || !liste.length) return;
        const [son, ...eski] = liste;
        verLog.innerHTML = `
          <h3 class="cl-h">Son güncellemelerde neler yapıldı</h3>
          ${surumBlok(son)}
          ${eski.length ? `<details class="cl-more">
            <summary>Önceki ${eski.length} sürüm</summary>
            ${eski.map(surumBlok).join('')}
          </details>` : ''}`;
      })
      .catch(() => { /* liste yoksa kart eskisi gibi çalışır */ });
  }

  verCheck.addEventListener('click', async () => {
    verCheck.disabled = true;
    const label = verCheck.innerHTML;
    verCheck.textContent = 'Bakılıyor…';
    try {
      const info = await checkUpdate();
      showVersion(info);
      if (!info.needsReload) toast('Zaten en güncel sürümdesin');
      else toast('Yeni sürüm hazır — "Yeni sürüme geç"e dokun', 3200);
    } catch {
      toast('Güncelleme denetlenemedi (internet yok olabilir)', 3200);
    } finally { verCheck.disabled = false; verCheck.innerHTML = label; }
  });

  verApply.addEventListener('click', () => { verApply.disabled = true; verApply.textContent = 'Geçiliyor…'; applyUpdate(); });

  root.querySelector('#verReset')?.addEventListener('click', () => {
    if (!confirmAction('Önbellek temizlenip uygulama baştan kurulacak. İlerlemen silinmez ama ders içeriği yeniden indirilir. Devam edilsin mi?')) return;
    resetAppCache();
  });
}

export default async function accountView() {
  if (!cloudConfigured()) {
    return {
      title: 'Hesap', sub: 'Giriş ve eşitleme',
      html: `<div class="stack">
        <div class="empty"><div class="e-ico">${ico('user')}</div><b>Hesap sistemi henüz açık değil</b>
          <p class="small">İlerlemen şimdilik yalnızca bu cihazda saklanıyor. Hesap sistemi açılınca buradan giriş yapıp
          tüm cihazlarında aynı verilere ulaşabileceksin.</p></div>
        ${versionCardHtml()}
      </div>`,
      onMount(root) { wireVersionCard(root); },
    };
  }

  return {
    title: 'Hesap',
    sub: 'Giriş ve eşitleme',
    html: `<div class="stack">
      <div id="acct"><div class="empty"><div class="e-ico">${ico('clock')}</div><b>Oturum kontrol ediliyor…</b></div></div>

      ${versionCardHtml()}
    </div>`,

    onMount(root) {
      const host = root.querySelector('#acct');
      let mode = 'in';          // in | up | reset
      let lastUid;

      const cloud = () => import('../cloud.js');

      function renderSignedOut() {
        host.innerHTML = `
          <div class="card auth-card">
            <h2 style="margin-top:0">Giriş yap</h2>
            <p class="small muted" style="margin-top:0">Giriş yapınca ilerlemen, kartların, notların ve not ortalaman hesabına kaydedilir;
            telefon, bilgisayar — nereden girersen gir aynı yerden devam edersin.</p>

            <button class="btn block g-btn" id="gBtn" type="button">${GOOGLE_G} Google ile devam et</button>
            <div class="or"><span>ya da e-postayla</span></div>

            <div class="seg" id="modeSeg" role="tablist">
              <button type="button" data-mode="in" class="${mode === 'in' ? 'on' : ''}">Giriş yap</button>
              <button type="button" data-mode="up" class="${mode === 'up' ? 'on' : ''}">Hesap aç</button>
            </div>

            <form id="authForm" novalidate style="margin-top:14px">
              ${mode === 'up' ? `<div class="field"><label for="fName">Adın</label>
                <input type="text" id="fName" autocomplete="given-name" placeholder="Ana sayfada seni böyle selamlayacak"></div>` : ''}
              <div class="field"><label for="fEmail">E-posta</label>
                <input type="email" id="fEmail" autocomplete="email" inputmode="email" required></div>
              ${mode !== 'reset' ? `<div class="field"><label for="fPass">Şifre</label>
                <input type="password" id="fPass" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="6" required>
                ${mode === 'up' ? '<span class="hint">En az 6 karakter.</span>' : ''}</div>` : ''}
              <p class="auth-err" id="authErr" role="alert" hidden></p>
              <button class="btn primary block" type="submit" id="submitBtn">${mode === 'up' ? 'Hesap aç' : mode === 'reset' ? 'Sıfırlama bağlantısı gönder' : 'Giriş yap'}</button>
            </form>

            <div class="row spread" style="margin-top:12px">
              ${mode === 'reset'
                ? '<button type="button" class="linkish" data-mode="in">← Girişe dön</button>'
                : '<button type="button" class="linkish" data-mode="reset">Şifremi unuttum</button>'}
            </div>
          </div>
          <p class="tiny muted center">Bu cihazda giriş yapmadan biriktirdiğin ilerleme, ilk girişte hesabına eklenir; kaybolmaz.</p>`;

        const err = host.querySelector('#authErr');
        const showErr = (m) => { err.textContent = m; err.hidden = !m; };
        const busy = (on) => host.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });

        host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
          const email = host.querySelector('#fEmail')?.value || '';
          mode = b.dataset.mode;
          renderSignedOut();
          const e = host.querySelector('#fEmail');
          if (e) { e.value = email; (email ? host.querySelector('#fPass, #fName') || e : e).focus(); }
        }));

        host.querySelector('#gBtn').addEventListener('click', async () => {
          showErr('');
          busy(true);
          try {
            const c = await cloud();
            await c.signInGoogle();          // başarıda oturum dinleyicisi ekranı yeniler
          } catch (e) {
            const c = await cloud();
            if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e?.code)) showErr(c.authMessage(e));
          } finally { busy(false); }
        });

        host.querySelector('#authForm').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          showErr('');
          const email = host.querySelector('#fEmail').value.trim();
          const pass = host.querySelector('#fPass')?.value || '';
          const name = host.querySelector('#fName')?.value.trim() || '';
          if (!email) { showErr('E-posta adresini yaz.'); return; }
          busy(true);
          const c = await cloud();
          try {
            if (mode === 'reset') {
              await c.resetPassword(email);
              toast('Şifre sıfırlama bağlantısı gönderildi', 3200);
              mode = 'in';
              renderSignedOut();
              host.querySelector('#fEmail').value = email;
              return;
            }
            if (mode === 'up') {
              await c.signUpEmail(name, email, pass);
              // Ad yalnızca hesap gerçekten açıldıysa kaydedilir.
              if (name) store.update((s) => { s.settings.name = name; });
            } else {
              await c.signInEmail(email, pass);
            }
          } catch (e) {
            showErr(c.authMessage(e));
          } finally { busy(false); }
        });
      }

      function renderSignedIn(u, st) {
        const sl = statusLine(st);
        host.innerHTML = `
          <div class="card">
            <div class="row" style="gap:14px">
              <span class="avatar" aria-hidden="true">${escHtml(initials(u.displayName || store.state.settings.name, u.email))}</span>
              <div class="grow">
                <b style="display:block;font-size:16px">${escHtml(u.displayName || store.state.settings.name || 'Hesabın')}</b>
                <span class="small muted">${escHtml(u.email || '')}</span>
              </div>
            </div>
            <div class="sync-line ${sl.cls}" id="syncLine">${ico('refresh')} <span>${escHtml(sl.text)}</span></div>
            <div class="btn-row" style="margin-top:12px">
              <button class="btn" id="syncBtn" type="button">${ico('refresh')} Şimdi eşitle</button>
            </div>
          </div>

          <div id="verifyBox"></div>
          <div id="adminBox"></div>

          <div class="card">
            <h2 style="margin-top:0">Çıkış</h2>
            <p class="small muted" style="margin-top:0">Çıkış yapınca son değişiklikler hesabına yazılır ve bu cihazdaki kopya silinir.
            Verilerin hesabında durur; tekrar giriş yapınca geri gelir.</p>
            <button class="btn danger" id="outBtn" type="button">${ico('logout')} Çıkış yap</button>
          </div>`;

        cloud().then((c) => {
          const provider = c.providerOf(u);
          if (!u.emailVerified && provider === 'E-posta') {
            host.querySelector('#verifyBox').innerHTML = `<div class="callout c-warn" style="margin:0">
              <div class="callout-h">${ico('alert')} E-posta doğrulanmadı</div>
              <p>Şifreni unutursan sıfırlama bağlantısı bu adrese gelir. Gelen kutuna gönderilen bağlantıya tıkla.</p>
              <button class="btn" id="verifyBtn" type="button">Doğrulama e-postasını tekrar gönder</button></div>`;
            host.querySelector('#verifyBtn').addEventListener('click', async () => {
              try { await c.resendVerification(); toast('Doğrulama e-postası gönderildi'); } catch (e) { toast(c.authMessage(e), 3200); }
            });
          }
          if (c.isAdmin(u)) {
            host.querySelector('#adminBox').innerHTML = `<a class="card" href="#/akts" style="display:block">
              <div class="row"><span class="grow"><b>Yönetici · AKTS düzeltmeleri</b>
              <small class="muted" style="display:block">Düzeltmeleri kendi hesabın için ya da tüm kullanıcılar için yayınla</small></span>
              ${ico('right')}</div></a>`;
          }
        });

        host.querySelector('#syncBtn').addEventListener('click', () => syncNow());
        host.querySelector('#outBtn').addEventListener('click', async () => {
          if (!confirmAction('Çıkış yapılsın mı? Bu cihazdaki kopya silinir, verilerin hesabında kalır.')) return;
          host.querySelector('#outBtn').disabled = true;
          toast('Son değişiklikler kaydediliyor…', 4000);
          await signOut();
        });
      }

      function updateStatusOnly(st) {
        const line = host.querySelector('#syncLine');
        if (!line) return false;
        const sl = statusLine(st);
        line.className = `sync-line ${sl.cls}`;
        line.querySelector('span').textContent = sl.text;
        return true;
      }

      const off = onSync(({ user, authKnown, status }) => {
        if (!authKnown) return;
        const uid = user ? user.uid : null;
        // Aynı oturumda yalnızca durum değiştiyse formu yeniden çizme (yazılan metin kaybolmasın).
        if (uid === lastUid && (uid ? updateStatusOnly(status) : true)) return;
        lastUid = uid;
        if (user) renderSignedIn(user, status); else renderSignedOut();
      });

      // Göreli zaman ("2 dk önce") sayfa açık kaldıkça tazelensin.
      const tick = setInterval(() => { if (getUser()) updateStatusOnly(getSyncStatus()); }, 30000);

      // ---------- sürüm kartı ----------
      wireVersionCard(root);

      return () => { off(); clearInterval(tick); };
    },
  };
}
