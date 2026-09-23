// views/mycourses.js — "Derslerim": bu dönem aldığım dersleri seçme ve ders saatlerini girme.
//
// Farklı yarıyıllardan ders alınabildiği için seçim tek bir yarıyıla bağlı değil:
// listeden istediğin yarıyıldan istediğin kadar ders işaretleyebilirsin. Ders programı
// (views/schedule.js) ve not ekranı (views/grades.js) bu seçimi kullanır.

import { getCurriculum, normalize } from '../data.js';
import { escHtml, toast, DAYS, empty, confirmAction } from '../ui.js';
import {
  myCourses, totalAkts, isEnrolled, toggleEnroll, unenroll, courseInfo,
  addSlot, patchSlot, removeSlot, resetSlots, officialSlots, weekSlots, weeklyHours, KINDS,
} from '../plan.js';
import { store } from '../store.js';
import { ico } from '../icons.js';

const dayOptions = (sel) => [1, 2, 3, 4, 5, 6, 0]
  .map((d) => `<option value="${d}"${d === Number(sel) ? ' selected' : ''}>${DAYS[d]}</option>`).join('');

const kindOptions = (sel) => KINDS
  .map((k) => `<option${k === sel ? ' selected' : ''}>${k}</option>`).join('');

function slotRow(s, i) {
  return `<div class="slot-edit" data-i="${i}">
    <select data-f="day" title="Gün">${dayOptions(s.day)}</select>
    <input type="time" data-f="start" value="${escHtml(s.start || '')}" title="Başlangıç">
    <input type="time" data-f="end" value="${escHtml(s.end || '')}" title="Bitiş">
    <input type="text" data-f="room" value="${escHtml(s.room || '')}" placeholder="Derslik" title="Derslik">
    <select data-f="kind" title="Tür">${kindOptions(s.kind || 'Teori')}</select>
    <button class="icon-btn" data-act="del-slot" title="Saati sil">×</button>
  </div>`;
}

function courseCard(cur, c) {
  const official = officialSlots(cur, c.code);
  return `<div class="card mine-card" data-code="${c.code}" style="--c:${c.color}">
    <div class="row spread">
      <div class="row" style="gap:9px">
        <span class="cc-ico">${ico(c.icon)}</span>
        <span>
          <b>${escHtml(c.name)}</b>
          <span class="cc-meta" style="display:block">${escHtml(c.code)} · ${c.akts} AKTS${c.semesterLabel ? ' · ' + escHtml(c.semesterLabel) : ''}</span>
        </span>
      </div>
      <button class="icon-btn" data-act="unenroll" title="Dersi bırak">${ico('trash')}</button>
    </div>

    <div class="slot-list">
      ${c.slots.length ? c.slots.map(slotRow).join('')
        : '<p class="tiny muted" style="margin:8px 0 0">Bu dersin saati girilmedi — programda görünmez.</p>'}
    </div>

    <div class="btn-row" style="margin-top:10px">
      <button class="btn ghost small" data-act="add-slot">+ Ders saati</button>
      ${official.length ? '<button class="btn ghost small" data-act="reset-slots">Resmî saatleri getir</button>' : ''}
      <a class="btn ghost small" href="#/ders/${c.code}">Derse git</a>
    </div>
  </div>`;
}

export default async function myCoursesView() {
  const cur = await getCurriculum();

  return {
    title: 'Derslerim',
    sub: 'Bu dönem aldığın dersler',
    html: `<div class="stack">
      <div id="myHead"></div>

      <div>
        <div class="sec-title"><h2>Seçtiğin dersler</h2><a href="#/program">Programa bak</a></div>
        <div id="mine"></div>
      </div>

      <div>
        <div class="sec-title"><h2>Ders ekle</h2></div>
        <div class="field" style="margin-bottom:10px">
          <input type="text" id="pickSearch" placeholder="Ders adı veya kodu ara — tüm yarıyıllarda">
        </div>
        <div class="seg" id="semSeg" style="overflow-x:auto">
          ${cur.semesters.map((s) => `<button data-sem="${s.n}">${s.n}</button>`).join('')}
        </div>
        <div id="pick" style="margin-top:10px"></div>
      </div>
    </div>`,

    onMount(root) {
      const headEl = root.querySelector('#myHead');
      const mineEl = root.querySelector('#mine');
      const pickEl = root.querySelector('#pick');
      const searchEl = root.querySelector('#pickSearch');
      const segEl = root.querySelector('#semSeg');
      let sem = store.settings.activeSemester || cur.activeSemester || 1;
      let q = '';

      function paintHead() {
        const mine = myCourses(cur);
        const wk = weekSlots(cur);
        const hours = wk.official ? 0 : weeklyHours(wk.slots);
        headEl.innerHTML = `<div class="card" style="--c:var(--acc)">
          <div class="stat-grid">
            <div class="stat"><b>${mine.length}</b><small>ders</small></div>
            <div class="stat"><b>${totalAkts(cur)}</b><small>AKTS</small></div>
            <div class="stat"><b>${hours ? hours.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '0'}</b><small>saat / hafta</small></div>
            <div class="stat"><b>${mine.filter((c) => !c.slots.length).length}</b><small>saati girilmedi</small></div>
          </div>
          <p class="tiny muted" style="margin:10px 0 0">Seçtiğin dersler ders programını ve not ekranını doldurur.
          Resmî programda saati olan ders otomatik gelir; diğerlerinin saatini sen girersin.</p>
          <div class="btn-row" style="margin-top:10px">
            <a class="btn" href="#/program">${ico('calendar')} Ders programı</a>
            <a class="btn" href="#/notlar">${ico('cap')} Notlar ve ortalama</a>
          </div>
        </div>`;
      }

      function paintMine() {
        const mine = myCourses(cur);
        mineEl.innerHTML = mine.length
          ? mine.map((c) => courseCard(cur, c)).join('')
          : empty('list', 'Henüz ders seçmedin',
              'Aşağıdaki listeden bu dönem aldığın dersleri işaretle — program ve not ekranı onlardan oluşur.');
        paintHead();
      }

      function paintPick() {
        const term = normalize(q);
        let list;
        let caption;
        if (term.length >= 2) {
          const codes = [...new Set(cur.semesters.flatMap((s) => s.courses))];
          list = codes.map((code) => courseInfo(cur, code))
            .filter((c) => normalize(c.name).includes(term) || normalize(c.code).includes(term));
          caption = `${list.length} sonuç`;
        } else {
          const s = cur.semesters.find((x) => x.n === sem);
          list = (s ? s.courses : []).map((code) => courseInfo(cur, code));
          caption = `${s ? s.label + ' · ' + s.term : ''} · ${list.length} ders`;
        }

        pickEl.innerHTML = `<p class="tiny muted" style="margin:0 0 8px">${escHtml(caption)}</p>
          ${list.length ? list.map((c) => {
            const on = isEnrolled(c.code);
            return `<button class="pick-row${on ? ' on' : ''}" data-code="${c.code}" aria-pressed="${on}" style="--c:${c.color}">
              <span class="pk-box">${on ? ico('check') : ''}</span>
              <span class="grow">
                <b>${ico(c.icon)} ${escHtml(c.name)}</b>
                <small>${escHtml(c.code)} · ${c.akts} AKTS${c.elective ? ' · seçmeli' : ''}${term.length >= 2 && c.semester ? ' · ' + c.semester + '. yarıyıl' : ''}</small>
              </span>
            </button>`;
          }).join('') : '<p class="small muted center">Eşleşen ders yok.</p>'}`;
      }

      function markSeg() {
        segEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.sem) === sem));
        segEl.classList.toggle('dim', normalize(q).length >= 2);
      }

      paintMine();
      markSeg();
      paintPick();

      segEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sem]');
        if (!b) return;
        sem = Number(b.dataset.sem);
        q = '';
        searchEl.value = '';
        markSeg();
        paintPick();
      });

      searchEl.addEventListener('input', () => { q = searchEl.value; markSeg(); paintPick(); });

      pickEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-code]');
        if (!btn) return;
        const code = btn.dataset.code;
        const on = toggleEnroll(code, cur);
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.querySelector('.pk-box').innerHTML = on ? ico('check') : '';
        toast(on ? `${code} eklendi` : `${code} çıkarıldı`);
        paintMine();
      });

      // ---- seçili ders kartları: saat ekleme / silme / dersi bırakma ----

      mineEl.addEventListener('click', (e) => {
        const card = e.target.closest('.mine-card');
        if (!card) return;
        const code = card.dataset.code;
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'add-slot') { addSlot(code); paintMine(); }
        else if (act === 'reset-slots') { resetSlots(code, cur); paintMine(); toast('Resmî saatler yüklendi'); }
        else if (act === 'del-slot') {
          removeSlot(code, Number(e.target.closest('.slot-edit').dataset.i));
          paintMine();
        } else if (act === 'unenroll') {
          if (!confirmAction('Bu ders listenden çıkarılsın mı? (Girdiğin notlar silinmez)')) return;
          unenroll(code);
          paintMine();
          paintPick();
        }
      });

      // Saat alanları anında kaydedilir; kart yeniden çizilmez ki yazarken odak kaçmasın.
      mineEl.addEventListener('change', (e) => {
        const field = e.target.closest('[data-f]');
        if (!field) return;
        const card = e.target.closest('.mine-card');
        const i = Number(e.target.closest('.slot-edit').dataset.i);
        const f = field.dataset.f;
        patchSlot(card.dataset.code, i, { [f]: f === 'day' ? Number(field.value) : field.value });
        if (f === 'start' || f === 'end') paintHead();
      });
    },
  };
}
