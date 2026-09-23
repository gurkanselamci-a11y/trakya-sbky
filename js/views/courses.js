// views/courses.js — yarıyıla göre ders listesi.

import { store } from '../store.js';
import { getCurriculum, getSemesterCourses } from '../data.js';
import { escHtml, progressBar, $$ } from '../ui.js';
import { ico } from '../icons.js';

export default async function coursesView() {
  const cur = await getCurriculum();
  const active = store.settings.activeSemester || cur.activeSemester;

  const semButtons = cur.semesters.map((s) =>
    `<button data-sem="${s.n}" class="${s.n === active ? 'on' : ''}">${s.n}</button>`).join('');

  return {
    title: 'Dersler',
    sub: `${cur.department} · ${cur.academicYear}`,
    html: `
      <div class="stack">
        <div>
          <label class="tiny muted" style="display:block;margin-bottom:6px">Yarıyıl seç</label>
          <div class="seg" id="semSeg" style="overflow-x:auto">${semButtons}</div>
        </div>
        <div id="semInfo"></div>
        <div id="semList"></div>
      </div>`,
    onMount(root) {
      const list = root.querySelector('#semList');
      const info = root.querySelector('#semInfo');

      async function paint(n) {
        const sem = cur.semesters.find((x) => x.n === n);
        const courses = await getSemesterCourses(n);
        info.innerHTML = `<div class="row spread">
          <div><b>${sem.label} · ${sem.term}</b>
          <div class="tiny muted">${courses.length} ders${sem.verified ? '' : ' · ders listesi tahminî'}</div></div>
          ${sem.verified ? '<span class="chip ok">Program doğrulandı</span>' : '<span class="chip">Doğrulanmadı</span>'}
        </div>`;

        list.innerHTML = `<div class="course-grid">${courses.map((c) => {
          const pr = store.courseProgress(c.code, c.topicCount);
          const soon = !c.hasContent;
          return `<a class="course-card${soon ? ' soon' : ''}" href="${soon ? '#/dersler' : `#/ders/${c.code}`}" style="--c:${c.color}">
            <div class="cc-top"><span class="cc-ico">${ico(c.icon)}</span>
              <span class="grow"><h3>${escHtml(c.name)}</h3>
              <span class="cc-meta">${escHtml(c.code)}${c.instructor ? ' · ' + escHtml(c.instructor) : ''}${c.elective ? ' · seçmeli' : ''}</span></span></div>
            ${soon ? `<div class="tiny muted" style="margin-top:10px">İçerik henüz eklenmedi</div>`
              : `${progressBar(pr.pct, c.color)}
                 <div class="cc-foot"><span>${pr.read}/${c.topicCount} konu okundu</span><span>%${pr.pct}</span></div>`}
          </a>`;
        }).join('')}</div>`;
      }

      paint(active);

      root.querySelector('#semSeg').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sem]');
        if (!btn) return;
        const n = Number(btn.dataset.sem);
        $$('#semSeg button', root).forEach((b) => b.classList.toggle('on', b === btn));
        store.update((s) => { s.settings.activeSemester = n; });
        paint(n);
      });
    },
  };
}
