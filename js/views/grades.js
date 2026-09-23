// views/grades.js — "Notlar": bu dönemin sınav notları, geçmiş dersler ve ortalama (GANO).
//
// Üç parça var:
//   1) Özet — GANO, dönem ortalaması, kazanılan AKTS.
//   2) Bu dönem — Derslerim'de seçilen her ders için vize/final/büt ve ek kalemler.
//   3) Geçmiş dersler — daha önce alınan dersler (AKTS + harf) ya da tek satırlık devir.

import { getCurriculum } from '../data.js';
import { escHtml, toast, empty, confirmAction } from '../ui.js';
import { store } from '../store.js';
import {
  myCourses, gradeOf, setItemScore, setItemWeight, addItem, renameItem, removeItem,
  setLetter, resetGrade, transcript, addPast, patchPast, removePast, courseInfo,
} from '../plan.js';
import {
  SCALE, SPECIAL, computeCourse, neededFor, coefOf, statusOf, weightedGpa,
  fmtGpa, fmtScore,
} from '../grades.js';
import { ico } from '../icons.js';

const LETTER_OPTS = [...SCALE.map((x) => ({ k: x.k, label: `${x.k} (${x.c.toFixed(2)})` })),
  ...SPECIAL.map((x) => ({ k: x.k, label: `${x.k} — ${x.label}` }))];

const letterSelect = (sel, auto = false) => `
  ${auto ? `<option value=""${!sel ? ' selected' : ''}>Otomatik</option>` : ''}
  ${LETTER_OPTS.map((o) => `<option value="${o.k}"${o.k === sel ? ' selected' : ''}>${o.label}</option>`).join('')}`;

// Trakya'da koşullu/şartlı geçme yok (bkz. js/grades.js): harf ya geçer ya kalır.
const statusChip = (letter) => {
  const st = statusOf(letter);
  if (st.k === 'pass') return `<span class="chip ok">${st.label}</span>`;
  if (st.k === 'fail') return `<span class="chip bad">${st.label}</span>`;
  return '';
};

/** Bir dersin o anki harfi: elle sabitlendiyse o, değilse puandan hesaplanan. */
function letterOf(g, calc) {
  return g.manual && g.letter ? g.letter : calc.letter;
}

function itemRow(it) {
  const isBut = !!it.replaces;
  return `<div class="grade-item" data-id="${it.id}">
    <input type="text" data-f="name" value="${escHtml(it.name)}" ${isBut ? 'readonly' : ''} title="Kalem adı">
    <span class="gi-w"><input type="number" data-f="weight" min="0" max="100" step="5" value="${it.weight}" ${isBut ? 'readonly' : ''} title="Ağırlık">%</span>
    <input type="number" data-f="score" min="0" max="100" step="1" inputmode="decimal"
      value="${Number.isFinite(it.score) ? it.score : ''}" placeholder="—" title="Aldığın not">
    ${isBut ? '<span class="icon-btn" style="visibility:hidden">×</span>'
      : '<button class="icon-btn" data-act="del-item" title="Kalemi sil">×</button>'}
  </div>`;
}

function courseSummaryHtml(code) {
  const g = gradeOf(code);
  const calc = computeCourse(g.items);
  const letter = letterOf(g, calc);
  const coef = coefOf(letter);
  const bits = [];

  if (calc.score === null) {
    bits.push('<span class="muted">Not girilmedi</span>');
  } else {
    bits.push(`<b>Ortalama ${fmtScore(calc.score)}</b>`);
    bits.push(calc.done
      ? '<span class="muted">tüm ağırlık girildi</span>'
      : `<span class="muted">girilen ağırlık %${calc.filledWeight}</span>`);
  }
  if (letter) {
    bits.push(`<span class="g-letter">${letter}${Number.isFinite(coef) ? ` · ${coef.toFixed(2)}` : ''}</span>`);
    if (!calc.done && !g.manual) bits.push('<span class="muted">tahmini</span>');
    if (g.manual) bits.push('<span class="muted">elle</span>');
  }

  // Baraj (Madde 25/13-c): finalden 50'nin altı, ortalama ne olursa olsun FF.
  if (calc.floorFail) {
    bits.push(`<span class="muted">${escHtml(calc.floorFail.name)} ${fmtScore(calc.floorFail.score)}`
      + ` → ${calc.floorFail.floor} barajının altı, harf FF</span>`);
  }

  // "Finalden kaç almalıyım" — bir kalem girilmiş ama ders bitmemişken en çok işe yarayan bilgi.
  let hint = '';
  if (calc.score !== null && !calc.done) {
    const targets = [['CC', 60], ['BB', 70], ['AA', 90]]
      .map(([k, t]) => [k, neededFor(g.items, t)])
      .filter(([, v]) => Number.isFinite(v) && v > 0 && v <= 100)
      .map(([k, v]) => `${k} için ${fmtScore(v)}`);
    if (targets.length) hint = `<p class="tiny muted" style="margin:6px 0 0">Kalan sınavlardan: ${targets.join(' · ')}</p>`;
    else if (Number.isFinite(neededFor(g.items, 60)) && neededFor(g.items, 60) <= 0) {
      hint = '<p class="tiny muted" style="margin:6px 0 0">Kalan sınavlar boş kalsa bile CC garanti.</p>';
    }
  }

  return `<div class="row wrap small" style="gap:8px">${bits.join('<span class="muted">·</span>')}
    ${statusChip(letter)}</div>${hint}`;
}

function courseCard(c) {
  const g = gradeOf(c.code);
  return `<div class="card grade-card" data-code="${c.code}" style="--c:${c.color}">
    <div class="row spread" style="gap:8px">
      <div class="row grow" style="gap:9px">
        <span class="cc-ico">${ico(c.icon)}</span>
        <span class="grow"><b>${escHtml(c.name)}</b>
        <span class="cc-meta" style="display:block">${escHtml(c.code)} · ${c.akts} AKTS</span></span>
      </div>
      <select data-f="letter" class="g-letter-sel" title="Harf notu">${letterSelect(g.manual ? g.letter : '', true)}</select>
    </div>

    <div class="grade-items">${g.items.map(itemRow).join('')}</div>

    <div class="btn-row" style="margin-top:8px">
      <button class="btn ghost small" data-act="add-item">+ Kalem (ödev, quiz…)</button>
      <button class="btn ghost small" data-act="reset-grade">Sıfırla</button>
    </div>

    <div class="g-sum" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:9px">
      ${courseSummaryHtml(c.code)}
    </div>
  </div>`;
}

function pastRow(r) {
  const coef = coefOf(r.letter);
  return `<div class="past-row" data-id="${r.id}">
    <input type="text" data-f="name" value="${escHtml(r.name)}" title="Ders adı">
    <input type="number" data-f="akts" min="0" max="60" step="1" value="${r.akts}" title="AKTS">
    <select data-f="letter" title="Harf notu">${letterSelect(r.letter)}</select>
    <span class="past-coef">${Number.isFinite(coef) ? coef.toFixed(2) : '—'}</span>
    <button class="icon-btn" data-act="del-past" title="Sil">×</button>
  </div>`;
}

export default async function gradesView() {
  const cur = await getCurriculum();

  const pastPicker = cur.semesters.map((s) => `<optgroup label="${s.label} · ${s.term}">
      ${s.courses.map((code) => {
        const c = courseInfo(cur, code);
        return `<option value="${code}">${escHtml(c.name)} (${c.akts} AKTS)</option>`;
      }).join('')}
    </optgroup>`).join('');

  return {
    title: 'Notlar',
    sub: 'Sınav notların ve ortalaman',
    html: `<div class="stack">
      <div id="gSummary"></div>

      <div>
        <div class="sec-title"><h2>Bu dönem</h2><a href="#/derslerim">Dersleri düzenle</a></div>
        <div id="gTerm"></div>
      </div>

      <div>
        <div class="sec-title"><h2>Geçmiş dersler</h2></div>
        <div class="card">
          <p class="small muted" style="margin-top:0">Daha önce aldığın dersleri AKTS ve harf notuyla gir —
          genel ortalaman (GANO) bunlardan hesaplanır.</p>
          <div class="past-add">
            <select id="pastPick"><option value="">Müfredattan seç…</option>${pastPicker}</select>
            <input type="text" id="pastName" placeholder="Ders adı">
            <input type="number" id="pastAkts" placeholder="AKTS" min="0" max="60" step="1">
            <select id="pastLetter">${letterSelect('AA')}</select>
            <button class="btn primary small" id="pastAdd">Ekle</button>
          </div>
          <div id="pastList" style="margin-top:12px"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0">Tek tek girmek istemiyorsan</h3>
          <p class="small muted" style="margin-top:0">Transkriptindeki GANO'yu ve o ortalamanın kapsadığı toplam AKTS'yi
          yaz — üstteki dersler yerine (ya da onlara ek olarak) hesaba katılır.</p>
          <div class="past-add">
            <input type="number" id="priorGpa" placeholder="Önceki GANO" min="0" max="4" step="0.01"
              value="${Number.isFinite(store.settings.priorGpa) ? store.settings.priorGpa : ''}">
            <input type="number" id="priorAkts" placeholder="Toplam AKTS" min="0" max="400" step="1"
              value="${store.settings.priorAkts || ''}">
          </div>
        </div>
      </div>

      <div class="card">
        <b class="small">Harf tablosu</b>
        <p class="tiny muted" style="margin:6px 0 0">
          ${SCALE.map((x) => `${x.k} ${x.min}+ (${x.c.toFixed(2)})`).join(' · ')}<br>
          Trakya yönetmeliği mutlak değerlendirme kullanır; CC (60) ve üstü geçer, DD dahil altı kalır —
          koşullu geçme yoktur. Final ya da bütünlemeden <b>50'nin altı doğrudan FF</b>'tir.
          Ortalama AKTS ile ağırlıklandırılır. Harfin başka çıkarsa sağ üstteki kutudan elle seç;
          kesin bilgi OBS'dedir.
        </p>
      </div>
    </div>`,

    onMount(root) {
      const sumEl = root.querySelector('#gSummary');
      const termEl = root.querySelector('#gTerm');
      const pastEl = root.querySelector('#pastList');

      // ---- hesap ----

      function termRows() {
        return myCourses(cur).map((c) => {
          const g = gradeOf(c.code);
          return { akts: c.akts, letter: letterOf(g, computeCourse(g.items)) };
        });
      }

      function prior() {
        const g = Number(store.settings.priorGpa);
        const a = Number(store.settings.priorAkts);
        return Number.isFinite(g) && g > 0 && Number.isFinite(a) && a > 0 ? [{ akts: a, coef: g }] : [];
      }

      function paintSummary() {
        const past = transcript().map((r) => ({ akts: r.akts, coef: coefOf(r.letter) }));
        const term = termRows().map((r) => ({ akts: r.akts, coef: coefOf(r.letter) }));
        const done = weightedGpa([...prior(), ...past]);
        const all = weightedGpa([...prior(), ...past, ...term]);
        const dno = weightedGpa(term);
        const termAkts = myCourses(cur).reduce((a, c) => a + c.akts, 0);

        sumEl.innerHTML = `<div class="card" style="--c:var(--acc)">
          <div class="stat-grid">
            <div class="stat"><b>${fmtGpa(done.gpa)}</b><small>GANO · geçmiş</small></div>
            <div class="stat"><b>${fmtGpa(all.gpa)}</b><small>bu dönem dahil</small></div>
            <div class="stat"><b>${fmtGpa(dno.gpa)}</b><small>dönem ortalaması</small></div>
            <div class="stat"><b>${done.akts}</b><small>tamamlanan AKTS</small></div>
          </div>
          <p class="tiny muted" style="margin:10px 0 0">
            ${done.counted ? `${done.akts} AKTS'lik geçmişin üzerine` : 'Geçmiş ders girilmedi —'}
            bu dönem ${termAkts} AKTS alıyorsun.
            ${dno.counted ? ` ${dno.counted} dersin harfi belli.` : ' Henüz not girilmedi.'}
            Bu dönemin notları girildikçe "bu dönem dahil" sütunu tahmini GANO'nu gösterir.</p>
        </div>`;
      }

      function paintTerm() {
        const mine = myCourses(cur);
        termEl.innerHTML = mine.length
          ? mine.map(courseCard).join('')
          : empty('cap', 'Ders seçmedin',
              'Notlarını girebilmek için önce bu dönem aldığın dersleri seç.',
              '<a class="btn primary" href="#/derslerim">Derslerimi seç</a>');
        paintSummary();
      }

      function paintPast() {
        const rows = transcript();
        pastEl.innerHTML = rows.length
          ? `<div class="past-head"><span>Ders</span><span>AKTS</span><span>Harf</span><span>Kat.</span><span></span></div>
             ${rows.map(pastRow).join('')}`
          : '<p class="small muted center" style="margin:0">Henüz geçmiş ders eklenmedi.</p>';
        paintSummary();
      }

      paintTerm();
      paintPast();

      // ---- bu dönem: kalem düzenleme ----

      termEl.addEventListener('click', (e) => {
        const card = e.target.closest('.grade-card');
        if (!card) return;
        const code = card.dataset.code;
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'add-item') { addItem(code, 'Ödev', 10); paintTerm(); }
        else if (act === 'del-item') {
          removeItem(code, e.target.closest('.grade-item').dataset.id);
          paintTerm();
        } else if (act === 'reset-grade') {
          if (!confirmAction('Bu dersin girdiğin notları silinsin mi?')) return;
          resetGrade(code);
          paintTerm();
          toast('Sıfırlandı');
        }
      });

      // Not yazarken kart yeniden çizilmez; yalnızca alt özet tazelenir (odak kaçmasın).
      const refreshCard = (card) => {
        card.querySelector('.g-sum').innerHTML = courseSummaryHtml(card.dataset.code);
        paintSummary();
      };

      termEl.addEventListener('input', (e) => {
        const field = e.target.closest('[data-f]');
        const card = e.target.closest('.grade-card');
        if (!field || !card) return;
        const item = e.target.closest('.grade-item');
        if (!item) return;
        const code = card.dataset.code;
        if (field.dataset.f === 'score') setItemScore(code, item.dataset.id, field.value);
        else if (field.dataset.f === 'weight') setItemWeight(code, item.dataset.id, field.value);
        else return;
        refreshCard(card);
      });

      termEl.addEventListener('change', (e) => {
        const field = e.target.closest('[data-f]');
        const card = e.target.closest('.grade-card');
        if (!field || !card) return;
        if (field.dataset.f === 'letter' && !e.target.closest('.grade-item')) {
          setLetter(card.dataset.code, field.value);
          refreshCard(card);
        } else if (field.dataset.f === 'name') {
          renameItem(card.dataset.code, e.target.closest('.grade-item').dataset.id, field.value);
        }
      });

      // ---- geçmiş dersler ----

      const pickEl = root.querySelector('#pastPick');
      const nameEl = root.querySelector('#pastName');
      const aktsEl = root.querySelector('#pastAkts');
      const letterEl = root.querySelector('#pastLetter');

      pickEl.addEventListener('change', () => {
        const code = pickEl.value;
        if (!code) return;
        const c = courseInfo(cur, code);
        nameEl.value = c.name;
        aktsEl.value = c.akts;
        nameEl.dataset.code = code;
      });

      root.querySelector('#pastAdd').addEventListener('click', () => {
        const name = nameEl.value.trim();
        const akts = Number(aktsEl.value);
        if (!name) { toast('Ders adı gerekli'); nameEl.focus(); return; }
        if (!Number.isFinite(akts) || akts <= 0) { toast('AKTS gir'); aktsEl.focus(); return; }
        addPast({ code: nameEl.dataset.code || '', name, akts, letter: letterEl.value });
        nameEl.value = '';
        aktsEl.value = '';
        delete nameEl.dataset.code;
        pickEl.value = '';
        paintPast();
        toast('Eklendi');
      });

      pastEl.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="del-past"]')) return;
        removePast(e.target.closest('.past-row').dataset.id);
        paintPast();
      });

      pastEl.addEventListener('change', (e) => {
        const field = e.target.closest('[data-f]');
        const row = e.target.closest('.past-row');
        if (!field || !row) return;
        patchPast(row.dataset.id, { [field.dataset.f]: field.value });
        paintPast();
      });

      // ---- devir (önceki GANO + AKTS) ----

      const bindPrior = (id, key, cast) => {
        const el = root.querySelector(id);
        el.addEventListener('input', () => {
          store.update((s) => { s.settings[key] = cast(el.value); });
          paintSummary();
        });
      };
      bindPrior('#priorGpa', 'priorGpa', (v) => {
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) && n > 0 ? Math.min(4, n) : null;
      });
      bindPrior('#priorAkts', 'priorAkts', (v) => Math.max(0, Number(v) || 0));
    },
  };
}
