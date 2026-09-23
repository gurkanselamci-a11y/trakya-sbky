// views/aktsedit.js — AKTS düzeltme.
//
// Müfredat dosyasındaki bazı AKTS değerleri yanlış. Herkes kendi hesabı için düzeltir
// (store.state.akts — cihazlar arası eşitlenir). Yönetici ayrıca aynı düzeltmeleri
// "herkes için" yayınlayabilir (Firestore config/akts).
//
// Geçerli değer sırası: kendi düzeltmen → yöneticinin düzeltmesi → müfredat (js/akts.js).

import { getCurriculum } from '../data.js';
import { escHtml, toast } from '../ui.js';
import { ico } from '../icons.js';
import { cloudConfigured } from '../cloud.js';
import { getUser, isAuthKnown, onSync } from '../sync.js';
import { aktsOverrides, myAktsOverrides, setMyAkts, aktsInfo, dataAkts, refreshAkts, saveAkts } from '../akts.js';

export default async function aktsEditView() {
  // Yönetici düğmesini doğru göstermek için oturumun belli olmasını bekle (kısa).
  if (cloudConfigured() && !isAuthKnown()) {
    await Promise.race([
      new Promise((resolve) => { const off = onSync(({ authKnown }) => { if (authKnown) { setTimeout(() => off(), 0); resolve(); } }); }),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
  await refreshAkts();

  const cur = await getCurriculum();
  const idx = cur.courseIndex || {};
  const user = getUser();
  let admin = false;
  if (user) { const c = await import('../cloud.js'); admin = c.isAdmin(user); }

  // Dersleri yarıyıllara göre grupla; hiçbir yarıyılda geçmeyenler (seçmeli havuzu) sonda.
  const seen = new Set();
  const groups = (cur.semesters || []).map((sem) => {
    const codes = sem.courses.filter((code) => idx[code] && !seen.has(code));
    codes.forEach((code) => seen.add(code));
    return { label: `${sem.label} · ${sem.term}`, codes };
  }).filter((g) => g.codes.length);
  const rest = Object.keys(idx).filter((code) => !seen.has(code)).sort();
  if (rest.length) groups.push({ label: 'Diğer dersler', codes: rest });

  const mine = myAktsOverrides();
  const shared = aktsOverrides();
  const info = aktsInfo();

  const row = (code) => {
    const m = idx[code];
    const base = dataAkts(m);
    const sh = typeof shared[code] === 'number' ? shared[code] : null;
    const my = typeof mine[code] === 'number' ? mine[code] : null;
    // Kutu boşken görünen soluk değer: yönetici düzeltmesi varsa o, yoksa müfredat.
    const fallback = sh ?? base;
    const note = sh !== null && my === null ? ` · <span class="akts-shared">ortak düzeltme ${sh}</span>` : '';
    return `<div class="akts-row${my !== null ? ' fixed' : ''}" data-code="${escHtml(code)}" data-fallback="${fallback}" data-search="${escHtml(`${code} ${m.name}`.toLocaleLowerCase('tr'))}">
      <div class="grow">
        <b>${escHtml(m.name)}</b>
        <span class="cc-meta">${escHtml(code)} · müfredatta ${base} AKTS${note}</span>
      </div>
      <input type="number" inputmode="decimal" min="0" max="60" step="0.5" value="${my !== null ? my : ''}" placeholder="${fallback}" aria-label="${escHtml(m.name)} AKTS">
      <button type="button" class="icon-btn" data-clear title="Düzeltmeyi kaldır"${my !== null ? '' : ' hidden'}>${ico('x')}</button>
    </div>`;
  };

  const who = user
    ? 'Düzeltmeler hesabına kaydedilir; telefonda da bilgisayarda da geçerli olur.'
    : cloudConfigured()
      ? '<b>Giriş yapmadın</b> — düzeltmeler yalnızca bu cihazda kalır. Giriş yaparsan hesabına taşınır.'
      : 'Düzeltmeler bu cihazda saklanır.';

  return {
    title: 'AKTS düzeltme',
    sub: user && admin ? 'Kendi hesabın · yönetici' : 'Kendi hesabın',
    html: `<div class="stack">
      <div class="card">
        <p class="small" style="margin:0">Müfredattaki AKTS yanlışsa doğrusunu kutuya yaz. Boş bırakılan ders için
        soluk görünen değer geçerli olur. Düzeltme ders sayfanda ve not ortalaması hesabında kullanılır.</p>
        <p class="tiny muted" style="margin:8px 0 0">${who}</p>
        ${admin ? `<p class="tiny muted" style="margin:6px 0 0">Yönetici olarak "Herkes için yayınla" ile aynı düzeltmeleri tüm kullanıcılara uygulayabilirsin.
        ${info.updatedAt ? `Son ortak düzeltme: ${new Date(info.updatedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${escHtml(info.updatedBy)}` : 'Şu an ortak düzeltme yok.'}</p>` : ''}
      </div>
      <input type="search" class="ans-input" id="aktsSearch" placeholder="Ders adı ya da kodu ara…" autocomplete="off">
      ${groups.map((g) => `<section class="akts-group"><h3>${escHtml(g.label)}</h3>${g.codes.map(row).join('')}</section>`).join('')}
      <div class="quiz-actions">
        <button class="btn primary block" id="aktsSave" type="button" disabled>Değişiklik yok</button>
        ${admin ? '<button class="btn block" id="aktsShare" type="button" style="margin-top:8px">Herkes için yayınla</button>' : ''}
      </div>
    </div>`,

    onMount(root) {
      const saveBtn = root.querySelector('#aktsSave');
      const shareBtn = root.querySelector('#aktsShare');

      /** Kutulardaki değerler → { KOD: sayı }. Boş ya da soluk değerle aynı olanlar düzeltme sayılmaz. */
      const collect = () => {
        const next = {};
        root.querySelectorAll('.akts-row').forEach((r) => {
          const raw = r.querySelector('input').value.trim().replace(',', '.');
          if (raw === '') return;
          const n = Number(raw);
          if (Number.isFinite(n) && n !== Number(r.dataset.fallback)) next[r.dataset.code] = n;
        });
        return next;
      };

      const refresh = () => {
        const next = collect();
        const diff = new Set([...Object.keys(next), ...Object.keys(mine)].filter((k) => next[k] !== mine[k])).size;
        saveBtn.disabled = diff === 0;
        saveBtn.textContent = diff ? `Kaydet · ${diff} değişiklik` : 'Değişiklik yok';
        root.querySelectorAll('.akts-row').forEach((r) => {
          const v = r.querySelector('input').value.trim();
          r.classList.toggle('fixed', v !== '' && Number(v.replace(',', '.')) !== Number(r.dataset.fallback));
          r.querySelector('[data-clear]').hidden = v === '';
        });
      };

      root.addEventListener('input', (e) => {
        if (e.target.matches('.akts-row input')) refresh();
        if (e.target.id === 'aktsSearch') {
          const q = e.target.value.trim().toLocaleLowerCase('tr');
          root.querySelectorAll('.akts-row').forEach((r) => { r.hidden = !!q && !r.dataset.search.includes(q); });
          root.querySelectorAll('.akts-group').forEach((g) => { g.hidden = ![...g.querySelectorAll('.akts-row')].some((r) => !r.hidden); });
        }
      });

      root.addEventListener('click', (e) => {
        const clear = e.target.closest('[data-clear]');
        if (!clear) return;
        clear.closest('.akts-row').querySelector('input').value = '';
        refresh();
      });

      const outOfRange = (o) => Object.entries(o).find(([, n]) => n < 0 || n > 60);

      saveBtn.addEventListener('click', () => {
        const next = collect();
        const badRow = outOfRange(next);
        if (badRow) { toast(`${badRow[0]}: AKTS 0–60 arasında olmalı`, 3200); return; }
        const saved = setMyAkts(next);
        Object.keys(mine).forEach((k) => delete mine[k]);
        Object.assign(mine, saved);
        const n = Object.keys(saved).length;
        toast(n ? `Kaydedildi · ${n} düzeltme senin hesabında geçerli` : 'Düzeltmeler kaldırıldı', 3000);
        refresh();
      });

      shareBtn?.addEventListener('click', async () => {
        const next = collect();
        const badRow = outOfRange(next);
        if (badRow) { toast(`${badRow[0]}: AKTS 0–60 arasında olmalı`, 3200); return; }
        shareBtn.disabled = true;
        const label = shareBtn.textContent;
        shareBtn.textContent = 'Yayınlanıyor…';
        try {
          await saveAkts(next, getUser()?.email);
          toast(`Herkes için yayınlandı · ${Object.keys(next).length} düzeltme`, 3200);
        } catch (err) {
          toast(err?.code === 'permission-denied'
            ? 'Yetki yok: bu hesap firestore.rules\'da yönetici değil.'
            : `Yayınlanamadı (${err?.code || err?.message})`, 4000);
        } finally {
          shareBtn.disabled = false;
          shareBtn.textContent = label;
        }
      });
    },
  };
}
