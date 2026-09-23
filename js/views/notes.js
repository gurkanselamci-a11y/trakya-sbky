// views/notes.js — kendi notların ve kaydettiğin konular tek sayfada.

import { store } from '../store.js';
import { getReadyCoursesLite } from '../data.js';
import { md } from '../md.js';
import { escHtml, empty, toast, confirmAction } from '../ui.js';
import { ico } from '../icons.js';

function resolve(courses, key) {
  const [code, tid] = String(key).split('/');
  const c = courses.find((x) => x.code === code);
  const t = c?.topics.find((x) => x.id === tid);
  return c && t ? { c, t, code, tid } : null;
}

export default async function notesView() {
  const courses = await getReadyCoursesLite();
  const s = store.state;

  const notes = Object.entries(s.notes)
    .map(([key, text]) => ({ ...(resolve(courses, key) || {}), key, text }))
    .filter((x) => x.t)
    .sort((a, b) => (a.c.code === b.c.code ? a.t.week - b.t.week : a.c.code.localeCompare(b.c.code)));

  const marks = s.bookmarks
    .map((key) => ({ ...(resolve(courses, key) || {}), key }))
    .filter((x) => x.t);

  if (!notes.length && !marks.length) {
    return {
      title: 'Notlarım',
      sub: 'Kendi notların',
      html: empty('note', 'Henüz not almadın',
        'Konu sayfasının altındaki "Kendi notun" alanına yazdıkların ve yıldızladığın konular burada toplanır.',
        '<a class="btn primary" href="#/dersler" style="margin-top:12px">Derslere git</a>'),
    };
  }

  return {
    title: 'Notlarım',
    sub: `${notes.length} not · ${marks.length} kayıtlı konu`,
    html: `<div class="stack">
      ${marks.length ? `<div>
        <div class="sec-title"><h2>Kaydettiğin konular</h2><span class="tiny muted">${marks.length}</span></div>
        <div class="week-list">${marks.map((m) => `<a class="week-item" href="#/konu/${m.code}/${m.tid}" style="--c:${m.c.color}">
          <span class="week-num">${ico('star-on')}</span>
          <span class="wi-body"><b>${escHtml(m.t.title)}</b><small>${escHtml(m.c.shortName)} · ${m.t.week}. hafta</small></span>
        </a>`).join('')}</div></div>` : ''}

      ${notes.length ? `<div>
        <div class="sec-title"><h2>Notların</h2><span class="tiny muted">${notes.length}</span></div>
        <div class="stack">${notes.map((n) => `<div class="card" style="--c:${n.c.color}" data-key="${escHtml(n.key)}">
          <div class="row spread">
            <a class="tiny" href="#/konu/${n.code}/${n.tid}" style="color:var(--acc)">
              ${ico(n.c.icon)} ${escHtml(n.c.shortName)} · ${n.t.week}. hafta</a>
            <button class="btn ghost tiny" data-del="${escHtml(n.key)}" style="padding:2px 8px">Sil</button>
          </div>
          <b style="display:block;margin:6px 0 8px;font-size:14px">${escHtml(n.t.title)}</b>
          <div class="prose small" style="border-top:1px solid var(--line-soft);padding-top:8px">${md(n.text)}</div>
        </div>`).join('')}</div></div>` : ''}
    </div>`,

    onMount(root) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        const key = btn.dataset.del;
        if (!confirmAction('Bu not silinsin mi?')) return;
        store.setNote(key, '');
        root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.remove();
        toast('Not silindi');
      });
    },
  };
}
