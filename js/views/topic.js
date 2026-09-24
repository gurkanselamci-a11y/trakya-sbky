// views/topic.js — konu anlatımı: notlar, kritik noktalar, tuzaklar, kişisel not.

import { store } from '../store.js';
import { getCourse, getCourseMeta, getOfficial } from '../data.js';
import { md } from '../md.js';
import { escHtml, toast, empty } from '../ui.js';
import { ico } from '../icons.js';
import { ACCEPT, MAX_FILE_BYTES, addFiles, listFiles, getFile, removeFile, fmtSize } from '../attachments.js';

/** Dosyayı açar: resim ve PDF tarayıcıda görünür, Word/Excel cihazın uygulamasına indirilir. */
async function openFile(id) {
  const f = await getFile(id);
  if (!f) { toast('Dosya bulunamadı'); return; }
  const url = URL.createObjectURL(f.blob);
  const inline = f.kind === 'Resim' || f.kind === 'PDF';
  const a = document.createElement('a');
  a.href = url;
  if (inline) { a.target = '_blank'; a.rel = 'noopener'; } else { a.download = f.name; }
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Yeni sekme URL'yi yükleyene kadar bekle, sonra belleği serbest bırak.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const KIND_TAG = { PDF: 'PDF', Word: 'DOC', Excel: 'XLS', Resim: 'IMG' };

export default async function topicView([code, topicId]) {
  const meta = await getCourseMeta(code);
  const course = await getCourse(code);
  if (!course) return { title: meta.name, sub: code, html: empty('soon', 'İçerik yok', '') };

  const idx = course.topics.findIndex((t) => t.id === topicId);
  const t = course.topics[idx];
  if (!t) return { title: meta.name, sub: code, html: empty('search', 'Konu bulunamadı', '', `<a class="btn" href="#/ders/${code}">Derse dön</a>`) };

  const prev = course.topics[idx - 1];
  const next = course.topics[idx + 1];
  const key = `${code}/${t.id}`;
  const p = store.topicProgress(code, t.id);
  const qCount = (t.questions || []).length;

  return {
    title: `${t.week}. Hafta`,
    sub: `${meta.shortName} · ${t.title}`,
    html: `
      <div class="stack" style="--c:${meta.color}">
        <div>
          <div class="row wrap" style="gap:6px;margin-bottom:8px">
            <a class="chip" href="#/ders/${code}">← ${escHtml(meta.shortName)}</a>
            <span class="chip on">${t.week}. hafta</span>
            ${qCount ? `<span class="chip">${qCount} soru</span>` : ''}
            ${(t.flashcards || []).length ? `<span class="chip">${t.flashcards.length} kart</span>` : ''}
          </div>
          <h1>${escHtml(t.title)}</h1>
          ${t.summary ? `<p class="muted" style="margin-top:2px">${escHtml(t.summary)}</p>` : ''}
        </div>

        ${t.keyPoints?.length ? `<div class="callout c-def">
          <div class="callout-h">${ico('pin')} Bilmen gerekenler</div>
          <ul style="margin:6px 0 0;padding-left:20px">${t.keyPoints.map((k) => `<li>${md(k).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>
        </div>` : ''}

        <article class="prose" id="notes">${md(t.notes || '_Bu hafta için not eklenmemiş._')}</article>

        ${t.pitfalls?.length ? `<div class="callout c-warn">
          <div class="callout-h">${ico('alert')} Sık yapılan hatalar</div>
          <ul style="margin:6px 0 0;padding-left:20px">${t.pitfalls.map((k) => `<li>${md(k).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>
        </div>` : ''}

        <div class="card">
          <label class="tiny muted" style="display:block;margin-bottom:6px">Kendi notun</label>
          <textarea id="myNote" class="ans-input" placeholder="Hocanın vurguladığı bir şey, aklına takılan bir soru…">${escHtml(store.getNote(key))}</textarea>
          <div class="row spread" style="margin-top:8px">
            <span class="tiny muted" id="noteState">Otomatik kaydedilir</span>
            <button class="btn ghost" id="bookmarkBtn">${store.isBookmarked(key) ? ico('star-on') + ' Kaydedildi' : ico('star') + ' Kaydet'}</button>
          </div>

          <div class="attach" id="attach">
            <div class="row spread" style="margin-top:14px">
              <b class="tiny muted">Dosyalar</b>
              <label class="btn ghost small" for="fileIn">${ico('clip')} Dosya ekle</label>
              <input type="file" id="fileIn" accept="${ACCEPT}" multiple hidden>
            </div>
            <div id="fileList" class="file-list"></div>
            <p class="tiny muted" style="margin:6px 0 0">PDF, Word, Excel veya fotoğraf (tek dosya en çok ${fmtSize(MAX_FILE_BYTES)}).
              Dosyalar yalnızca bu cihazda saklanır; bulut eşitlemesine ve yedeğe girmez.</p>
          </div>
        </div>

        <div class="card">
          <div class="row spread">
            <b class="tiny muted">Bu haftayı anlattır</b>
            <a class="tiny" href="https://notebooklm.google.com" target="_blank" rel="noopener">notebooklm.google.com ↗</a>
          </div>
          <p class="tiny muted" style="margin:6px 0 10px">
            Bu haftanın notunu, terimlerini ve sorularını NotebookLM'in anlayacağı tek parça
            kaynağa çevirir. <b>Kaynağı kopyala</b> → NotebookLM'de yeni not defteri → kaynak olarak
            <i>yapıştırılan metin</i> → <b>Video Overview</b>. Anlatımın ayrıntılı olması için önce
            <b>yönergeyi kopyala</b>yıp "özelleştir" kutusuna yapıştır.
          </p>
          <div class="btn-row">
            <button class="btn ghost grow" id="nlmCopy">${ico('file')} Kaynağı kopyala</button>
            <button class="btn ghost" id="nlmFile" title="Markdown dosyası olarak indir">${ico('download')} İndir</button>
            <button class="btn ghost" id="nlmPrompt" title="NotebookLM özelleştirme yönergesi">${ico('quote')} Yönerge</button>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn ${p.read ? '' : 'primary'} grow" id="readBtn">${p.read ? ico('check') + ' Okundu olarak işaretlendi' : 'Okudum, işaretle'}</button>
          ${qCount ? `<a class="btn primary grow" href="#/quiz/${code}/${t.id}">${ico('target')} ${qCount} soru çöz</a>` : ''}
        </div>

        <div class="row spread" style="margin-top:6px">
          ${prev ? `<a class="btn ghost" href="#/konu/${code}/${prev.id}">‹ ${prev.week}. hafta</a>` : '<span></span>'}
          ${next ? `<a class="btn ghost" href="#/konu/${code}/${next.id}">${next.week}. hafta ›</a>` : '<span></span>'}
        </div>
      </div>`,

    onMount(root) {
      const readBtn = root.querySelector('#readBtn');
      readBtn.addEventListener('click', () => {
        const nowRead = !store.topicProgress(code, t.id).read;
        store.setTopicProgress(code, t.id, { read: nowRead, readAt: nowRead ? Date.now() : null });
        readBtn.innerHTML = nowRead ? ico('check') + ' Okundu olarak işaretlendi' : 'Okudum, işaretle';
        readBtn.classList.toggle('primary', !nowRead);
        toast(nowRead ? 'Konu okundu olarak işaretlendi' : 'İşaret kaldırıldı');
      });

      const bm = root.querySelector('#bookmarkBtn');
      bm.addEventListener('click', () => {
        const on = store.toggleBookmark(key);
        bm.innerHTML = on ? ico('star-on') + ' Kaydedildi' : ico('star') + ' Kaydet';
      });

      const ta = root.querySelector('#myNote');
      const state = root.querySelector('#noteState');
      let timer = null;
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        state.textContent = 'Yazılıyor…';
        timer = setTimeout(() => {
          store.setNote(key, ta.value);
          state.textContent = 'Kaydedildi';
        }, 500);
      });

      // ---- dosya ekleri ----
      const fileIn = root.querySelector('#fileIn');
      const listEl = root.querySelector('#fileList');
      const thumbs = [];   // resim önizlemelerinin nesne URL'leri — sayfadan çıkınca serbest bırakılır

      async function renderFiles() {
        let files = [];
        try { files = await listFiles(key); } catch (err) {
          listEl.innerHTML = `<p class="tiny muted">${escHtml(err.message)}</p>`;
          return;
        }
        thumbs.splice(0).forEach((u) => URL.revokeObjectURL(u));
        if (!files.length) { listEl.innerHTML = ''; return; }
        listEl.innerHTML = files.map((f) => `
          <div class="file-row" data-id="${f.id}">
            <button class="file-open" data-act="open" title="Aç">
              <span class="file-thumb" data-kind="${escHtml(f.kind)}">${f.kind === 'Resim' ? '' : KIND_TAG[f.kind] || ico('file')}</span>
              <span class="file-meta"><b>${escHtml(f.name)}</b><small>${escHtml(f.kind)} · ${fmtSize(f.size)}</small></span>
            </button>
            <button class="btn ghost small" data-act="del" title="Sil" aria-label="${escHtml(f.name)} dosyasını sil">${ico('trash')}</button>
          </div>`).join('');
        // Resimlere küçük önizleme: Blob yalnızca resimler için okunur.
        for (const f of files.filter((x) => x.kind === 'Resim')) {
          const full = await getFile(f.id);
          const el = listEl.querySelector(`.file-row[data-id="${f.id}"] .file-thumb`);
          if (!full || !el) continue;
          const u = URL.createObjectURL(full.blob);
          thumbs.push(u);
          el.style.backgroundImage = `url("${u}")`;
        }
      }

      fileIn.addEventListener('change', async () => {
        if (!fileIn.files.length) return;
        try {
          const { added, rejected } = await addFiles(key, fileIn.files);
          if (added.length) toast(`${added.length} dosya eklendi`);
          if (rejected.length) toast(rejected.map((r) => `${r.name}: ${r.why}`).join(' · '));
        } catch (err) {
          // En olası neden: cihazda yer kalmadı (QuotaExceededError).
          toast(err && err.name === 'QuotaExceededError' ? 'Cihazda yer kalmadı' : 'Dosya eklenemedi: ' + (err.message || err));
        }
        fileIn.value = '';   // aynı dosya tekrar seçilebilsin
        renderFiles();
      });

      listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('.file-row').dataset.id;
        if (btn.dataset.act === 'open') { openFile(id); return; }
        if (btn.dataset.act === 'del') {
          const name = btn.closest('.file-row').querySelector('b').textContent;
          if (!confirm(`"${name}" silinsin mi?`)) return;
          await removeFile(id);
          toast('Dosya silindi');
          renderFiles();
        }
      });

      renderFiles();

      // ---- NotebookLM kaynağı ----
      // Metni üreten modül yalnızca düğmeye basılınca yüklenir; konu sayfasının açılışını
      // yavaşlatmasın diye. Çevrimdışı da çalışsın diye service worker'da önbelleğe alınmıştır.
      let kaynak = null;
      async function kaynakUret() {
        if (kaynak) return kaynak;
        const [{ konuKaynagi, dosyaAdi }, resmi] = await Promise.all([
          import('../nlmexport.js'),
          getOfficial(code).catch(() => null),
        ]);
        kaynak = { metin: konuKaynagi(course, t, resmi), ad: dosyaAdi(course, t) };
        return kaynak;
      }

      /** Panoya kopyalar. Clipboard API yoksa (ya da izin verilmezse) seçim yöntemine düşer. */
      async function panoyaYaz(metin) {
        try {
          await navigator.clipboard.writeText(metin);
          return true;
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = metin;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
          ta.remove();
          return ok;
        }
      }

      root.querySelector('#nlmCopy').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { metin } = await kaynakUret();
          const ok = await panoyaYaz(metin);
          toast(ok
            ? `Kaynak kopyalandı (${Math.round(metin.length / 1000)} bin karakter) — NotebookLM'de yapıştır`
            : 'Kopyalanamadı; "İndir" ile dosya olarak alabilirsin');
        } catch (err) {
          toast('Kaynak üretilemedi: ' + (err.message || err));
        }
        btn.disabled = false;
      });

      root.querySelector('#nlmFile').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { metin, ad } = await kaynakUret();
          const url = URL.createObjectURL(new Blob([metin], { type: 'text/markdown;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = ad;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          toast('Dosya indiriliyor: ' + ad);
        } catch (err) {
          toast('Dosya üretilemedi: ' + (err.message || err));
        }
        btn.disabled = false;
      });

      root.querySelector('#nlmPrompt').addEventListener('click', async () => {
        const { YONERGE } = await import('../nlmexport.js');
        const ok = await panoyaYaz(YONERGE);
        toast(ok ? 'Yönerge kopyalandı — NotebookLM\'de "özelleştir" kutusuna yapıştır' : 'Kopyalanamadı');
      });

      // Okuma süresince kaydırma ilerlemesi -> %90'ı geçince otomatik "okundu"
      const article = root.querySelector('#notes');
      const onScroll = () => {
        if (store.topicProgress(code, t.id).read) return;
        const r = article.getBoundingClientRect();
        const seen = window.innerHeight - r.top;
        if (r.height > 0 && seen / r.height > 0.9) {
          store.setTopicProgress(code, t.id, { read: true, readAt: Date.now() });
          readBtn.innerHTML = ico('check') + ' Okundu olarak işaretlendi';
          readBtn.classList.remove('primary');
          toast('Konu tamamlandı');
          window.removeEventListener('scroll', onScroll);
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });

      return () => {
        window.removeEventListener('scroll', onScroll);
        clearTimeout(timer);
        thumbs.forEach((u) => URL.revokeObjectURL(u));
      };
    },
  };
}
