// views/settings.js — tercihler, veri yedekleme, sıfırlama.

import { store } from '../store.js';
import { getCurriculum } from '../data.js';
import { escHtml, toast, confirmAction } from '../ui.js';
import { applyTheme, applyReading, refreshChrome, invalidateCards, applyKeepAwake } from '../app.js';
import { wakeLockSupported } from '../wakelock.js';
import { ico } from '../icons.js';

export default async function settingsView() {
  const cur = await getCurriculum();
  const s = store.settings;
  // Okuma ayarı null ise temanın kendi değeri geçerlidir; kaydırıcı onu göstermeli.
  const css = getComputedStyle(document.documentElement);
  const themeSize = parseFloat(css.getPropertyValue('--prose-size')) || 16.5;
  const themeLine = parseFloat(css.getPropertyValue('--prose-lh')) || 1.68;
  const curSize = s.readingSize ?? themeSize;
  const curLine = s.readingLine ?? themeLine;

  return {
    title: 'Ayarlar',
    sub: 'Tercihler ve veri',
    html: `<div class="stack">
      <div class="card">
        <h2 style="margin-top:0">Kişisel</h2>
        <div class="field">
          <label for="setName">Adın</label>
          <input type="text" id="setName" value="${escHtml(s.name)}" placeholder="Ana sayfada seni böyle selamlayacak">
        </div>
        <div class="field">
          <label for="setSem">Aktif yarıyıl</label>
          <select id="setSem">${cur.semesters.map((x) =>
            `<option value="${x.n}"${x.n === s.activeSemester ? ' selected' : ''}>${x.label} · ${x.term}</option>`).join('')}</select>
          <span class="hint">Ders listesi bu yarıyıldan açılır. Farklı yarıyıllardan ders alıyorsan
          <a href="#/derslerim" style="color:var(--acc);font-weight:600">Derslerim</a>'den seç —
          program ve notlar oradan hesaplanır.</span>
        </div>
        <div class="field">
          <label for="setStart">Dönemin ilk ders haftası</label>
          <input type="date" id="setStart" value="${escHtml(s.semesterStart)}" class="ans-input" style="padding:10px 12px">
          <span class="hint">"Bu hafta hangi konudayım" hesabı buna göre yapılır.</span>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Çalışma</h2>
        <div class="field">
          <label for="setGoal">Günlük hedef (dakika)</label>
          <input type="number" id="setGoal" min="5" max="480" step="5" value="${s.dailyGoal}">
        </div>
        <div class="field">
          <label for="setNew">Günlük yeni kart sayısı</label>
          <input type="number" id="setNew" min="0" max="200" step="5" value="${s.newCardsPerDay}">
          <span class="hint">Aralıklı tekrarda her gün kaç yeni kart açılsın.</span>
        </div>
        <div class="field">
          <label for="setQuiz">Karışık quizde soru sayısı</label>
          <input type="number" id="setQuiz" min="5" max="50" step="5" value="${s.quizLength}">
        </div>
        <div class="field">
          <label>Çalışırken ekran kapanmasın</label>
          <div class="seg" id="awakeSeg">
            <button data-awake="1" class="${s.keepAwake !== false ? 'on' : ''}">Açık</button>
            <button data-awake="0" class="${s.keepAwake === false ? 'on' : ''}">Kapalı</button>
          </div>
          <span class="hint">${wakeLockSupported()
            ? 'Konu, quiz, kart ve sınav ekranlarında ekran koruyucu ve ekran kararması devre dışı kalır; sınav sayacı kesintisiz işler. Diğer sayfalarda kilit bırakılır.'
            : 'Bu tarayıcı ekranı açık tutmayı desteklemiyor — sınav sayacı yine de geri dönüldüğünde doğru süreyi gösterir.'}</span>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Görünüm</h2>
        <div class="seg" id="themeSeg">
          <button data-theme="auto" class="${s.theme === 'auto' ? 'on' : ''}">Sistem</button>
          <button data-theme="dark" class="${s.theme === 'dark' ? 'on' : ''}">Koyu</button>
          <button data-theme="light" class="${s.theme === 'light' ? 'on' : ''}">Açık</button>
        </div>

        <h3>Okuma</h3>
        <div class="field">
          <label for="setSize">Konu anlatımı puntosu — <b id="setSizeOut">${curSize}</b> px</label>
          <input type="range" id="setSize" min="14" max="24" step="0.5" value="${curSize}">
        </div>
        <div class="field">
          <label for="setLine">Satır aralığı — <b id="setLineOut">${curLine}</b></label>
          <input type="range" id="setLine" min="1.4" max="2.1" step="0.02" value="${curLine}">
        </div>
        <div class="read-demo prose" id="readDemo">
          <p style="margin:0">Bir algoritmanın "iyiliği" adım sayısıyla ölçülür: sırayla arama
          en kötü durumda n karşılaştırma yapar, ikili arama ise log₂n adımdır.</p>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ghost small" id="readReset">Temanın varsayılanına dön</button>
        </div>
      </div>

      <a class="card" href="#/akts" style="display:block">
        <div class="row">${ico('sigma', 'ico-md')}<span class="grow"><b>AKTS düzeltme</b>
        <small class="muted" style="display:block">Müfredattaki AKTS yanlışsa kendi hesabın için düzelt — ortalama buna göre hesaplanır</small></span>${ico('right')}</div>
      </a>

      <a class="card" href="#/hesap" style="display:block">
        <div class="row">${ico('user', 'ico-md')}<span class="grow"><b>Hesap ve eşitleme</b>
        <small class="muted" style="display:block">Giriş yap, tüm cihazlarında aynı ilerlemeyle devam et</small></span>${ico('right')}</div>
      </a>

      <div class="card">
        <h2 style="margin-top:0">Veri</h2>
        <p class="small muted" style="margin-top:0">Tüm ilerlemen bu cihazın tarayıcısında saklanır. Telefonuna taşımak
        veya yedek almak için dışa aktar.</p>
        <div class="btn-row">
          <button class="btn" id="exportBtn">${ico('download')} Yedek al (JSON)</button>
          <button class="btn" id="importBtn">${ico('upload')} Yedeği geri yükle</button>
        </div>
        <input type="file" id="fileIn" accept="application/json" hidden>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Tehlikeli bölge</h2>
        <div class="btn-row">
          <button class="btn danger" id="resetSrsBtn">Kart tekrarlarını sıfırla</button>
          <button class="btn danger" id="resetAllBtn">Her şeyi sıfırla</button>
        </div>
      </div>

      <div class="card center">
        <p class="tiny muted" style="margin:0">TÜ SBKY Çalışma · sürüm 1.0<br>
        Doğukan Büyüklü için hazırlandı<br>
        ${escHtml(cur.university)} — ${escHtml(cur.department)}<br>
        Ders içerikleri çalışma amaçlıdır; resmî kaynak yerine geçmez.</p>
      </div>
    </div>`,

    onMount(root) {
      const bind = (id, key, cast = (v) => v) => {
        const el = root.querySelector(id);
        el.addEventListener('change', () => {
          store.update((st) => { st.settings[key] = cast(el.value); });
          toast('Kaydedildi');
          refreshChrome();
        });
      };
      bind('#setName', 'name');
      bind('#setSem', 'activeSemester', Number);
      bind('#setStart', 'semesterStart');
      bind('#setGoal', 'dailyGoal', (v) => Math.max(5, Number(v) || 30));
      bind('#setNew', 'newCardsPerDay', (v) => Math.max(0, Number(v) || 0));
      bind('#setQuiz', 'quizLength', (v) => Math.max(5, Number(v) || 10));

      root.querySelector('#awakeSeg').addEventListener('click', (e) => {
        const b = e.target.closest('[data-awake]');
        if (!b) return;
        root.querySelectorAll('#awakeSeg button').forEach((x) => x.classList.toggle('on', x === b));
        store.update((st) => { st.settings.keepAwake = b.dataset.awake === '1'; });
        applyKeepAwake();
        toast('Kaydedildi');
      });

      root.querySelector('#themeSeg').addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        root.querySelectorAll('#themeSeg button').forEach((x) => x.classList.toggle('on', x === b));
        store.update((st) => { st.settings.theme = b.dataset.theme; });
        applyTheme();
      });

      // Okuma ayarları: sürüklerken canlı uygulanır (önizleme .prose olduğu için aynı
      // jetonları kullanır), bırakıldığında kaydedilir.
      const sizeEl = root.querySelector('#setSize');
      const lineEl = root.querySelector('#setLine');
      const sizeOut = root.querySelector('#setSizeOut');
      const lineOut = root.querySelector('#setLineOut');

      const live = () => {
        sizeOut.textContent = sizeEl.value;
        lineOut.textContent = lineEl.value;
        document.documentElement.style.setProperty('--prose-size', `${sizeEl.value}px`);
        document.documentElement.style.setProperty('--prose-lh', lineEl.value);
      };
      const save = () => {
        store.update((st) => {
          st.settings.readingSize = Number(sizeEl.value);
          st.settings.readingLine = Number(lineEl.value);
        });
        applyReading();   // kalıcı değerleri tek yerden uygula
        toast('Kaydedildi');
      };
      sizeEl.addEventListener('input', live);
      lineEl.addEventListener('input', live);
      sizeEl.addEventListener('change', save);
      lineEl.addEventListener('change', save);

      // "Temanın varsayılanına dön": tercihi silip (null) temanın değerine bırakır,
      // sonra kaydırıcıları temanın gerçekten uyguladığı değerlerle tazeler.
      root.querySelector('#readReset').addEventListener('click', () => {
        store.update((st) => { st.settings.readingSize = null; st.settings.readingLine = null; });
        applyReading();
        const c = getComputedStyle(document.documentElement);
        sizeEl.value = parseFloat(c.getPropertyValue('--prose-size'));
        lineEl.value = parseFloat(c.getPropertyValue('--prose-lh'));
        sizeOut.textContent = sizeEl.value;
        lineOut.textContent = lineEl.value;
        toast('Temanın değerine dönüldü');
      });

      root.querySelector('#exportBtn').addEventListener('click', () => {
        const blob = new Blob([store.export()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tusbky-yedek-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Yedek indirildi');
      });

      const fileIn = root.querySelector('#fileIn');
      root.querySelector('#importBtn').addEventListener('click', () => fileIn.click());
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files?.[0];
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || typeof data !== 'object' || !('progress' in data)) throw new Error('Geçersiz yedek dosyası');
          if (!confirmAction('Mevcut ilerlemenin üzerine yazılacak. Devam edilsin mi?')) return;
          store.replaceAll(data);
          invalidateCards();
          toast('Yedek geri yüklendi');
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          toast('Okunamadı: ' + err.message, 3200);
        }
      });

      root.querySelector('#resetSrsBtn').addEventListener('click', () => {
        if (!confirmAction('Tüm kart tekrar geçmişin silinecek. Emin misin?')) return;
        store.update((st) => { st.srs = {}; });
        refreshChrome();
        toast('Kart tekrarları sıfırlandı');
      });

      root.querySelector('#resetAllBtn').addEventListener('click', () => {
        if (!confirmAction('TÜM ilerlemen, notların ve istatistiklerin silinecek. Giriş yaptıysan hesabındaki kopya da, '
          + 'diğer cihazların da sıfırlanır. Bu geri alınamaz. Emin misin?')) return;
        if (!confirmAction('Son kez soruyorum: her şey silinsin mi?')) return;
        store.reset();
        toast('Sıfırlandı');
        setTimeout(() => location.reload(), 600);
      });
    },
  };
}
