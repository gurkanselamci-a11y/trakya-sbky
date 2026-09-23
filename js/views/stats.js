// views/stats.js — ilerleme, çalışma ısı haritası, zayıf konular.

import { store, dayKey } from '../store.js';
import { getReadyCoursesLite, getAllCardIds } from '../data.js';
import { escHtml, progressBar, fmtMin, empty } from '../ui.js';
import { dueCount } from '../srs.js';
import { pendingMistakeIds } from './mistakes.js';
import { ico } from '../icons.js';

export default async function statsView() {
  const s = store.state;
  const ready = await getReadyCoursesLite();
  const cards = await getAllCardIds();
  const due = dueCount(cards, s.srs);
  const mistakeCount = pendingMistakeIds(s.answers).length;

  // Son 20 hafta ısı haritası (7 satır x ~20 sütun)
  const cells = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (139 + today.getDay()));
  for (let i = 0; i < 140 + today.getDay() + 1; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const rec = s.sessions[dayKey(d)];
    const m = rec?.minutes || 0;
    const goal = s.settings.dailyGoal || 30;
    const level = m === 0 ? 0 : m < goal * 0.34 ? 1 : m < goal * 0.67 ? 2 : m < goal ? 3 : 4;
    cells.push(`<i data-l="${level}" title="${d.toLocaleDateString('tr-TR')}: ${m} dk"></i>`);
  }

  // Son 14 gün sütun grafiği
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    last14.push({ d, m: s.sessions[dayKey(d)]?.minutes || 0 });
  }
  const maxM = Math.max(30, ...last14.map((x) => x.m));

  const totals = Object.values(s.sessions).reduce((a, v) => ({
    minutes: a.minutes + (v.minutes || 0),
    questions: a.questions + (v.questions || 0),
    correct: a.correct + (v.correct || 0),
  }), { minutes: 0, questions: 0, correct: 0 });
  const acc = totals.questions ? Math.round((totals.correct / totals.questions) * 100) : 0;

  // Zayıf konular (tüm dersler)
  const weak = [];
  for (const c of ready) {
    for (const t of c.topics) {
      const p = store.topicProgress(c.code, t.id);
      if (p.attempts > 0 && p.bestScore < 70) {
        weak.push({ code: c.code, color: c.color, name: c.shortName, tid: t.id, title: t.title, week: t.week, score: p.bestScore });
      }
    }
  }
  weak.sort((a, b) => a.score - b.score);

  // Hiç dokunulmamış konular
  const untouched = [];
  for (const c of ready) {
    for (const t of c.topics) {
      const p = store.topicProgress(c.code, t.id);
      if (!p.read && !p.attempts) untouched.push({ code: c.code, color: c.color, name: c.shortName, tid: t.id, title: t.title, week: t.week });
    }
  }

  const courseRows = ready.map((c) => {
    const pr = store.courseProgress(c.code, c.topicCount);
    return `<a class="week-item" href="#/ders/${c.code}" style="--c:${c.color}">
      <span class="week-num">${ico(c.icon)}</span>
      <span class="wi-body"><b>${escHtml(c.shortName)}</b>
        <div style="margin-top:5px">${progressBar(pr.pct, c.color)}</div></span>
      <span class="wi-score">%${pr.pct}</span></a>`;
  }).join('');

  return {
    title: 'İstatistik',
    sub: 'İlerlemen ve alışkanlıkların',
    html: `<div class="stack">
      <div class="stat-grid">
        <div class="stat"><b>${s.streak.current}</b><small>gün üst üste</small></div>
        <div class="stat"><b>${fmtMin(totals.minutes).replace(' dk', '′').replace(' sa ', 'sa ')}</b><small>toplam çalışma</small></div>
        <div class="stat"><b>${totals.questions}</b><small>çözülen soru</small></div>
        <div class="stat"><b>%${acc}</b><small>doğruluk</small></div>
      </div>

      <div class="card">
        <div class="row spread"><b class="small">Son 14 gün</b><span class="tiny muted">hedef ${s.settings.dailyGoal} dk</span></div>
        <div class="spark" style="margin-top:12px">
          ${last14.map((x) => `<i style="height:${Math.max(3, (x.m / maxM) * 100)}%;opacity:${x.m ? 0.9 : 0.25}" title="${x.d.toLocaleDateString('tr-TR')}: ${x.m} dk"></i>`).join('')}
        </div>
        <div class="row spread tiny muted" style="margin-top:6px">
          <span>${last14[0].d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span>
          <span>bugün</span>
        </div>
      </div>

      <div class="card">
        <b class="small">Çalışma haritası</b>
        <div class="heat" style="margin-top:12px">${cells.join('')}</div>
        <div class="row tiny muted" style="margin-top:8px;gap:4px;justify-content:flex-end">
          az <i style="width:11px;height:11px;border-radius:3px;background:var(--surface-2);display:inline-block"></i>
          <i style="width:11px;height:11px;border-radius:3px;background:color-mix(in srgb,var(--acc) 55%,var(--surface-2));display:inline-block"></i>
          <i style="width:11px;height:11px;border-radius:3px;background:var(--acc);display:inline-block"></i> çok
        </div>
      </div>

      <div class="btn-row">
        <a class="btn grow" href="#/yanlislarim">${ico('target')} Yanlışlarım${mistakeCount ? ` (${mistakeCount})` : ''}</a>
        <a class="btn grow" href="#/notlarim">${ico('note')} Notlarım${s.bookmarks.length || Object.keys(s.notes).length ? ` (${Object.keys(s.notes).length + s.bookmarks.length})` : ''}</a>
      </div>

      <div class="card">
        <div class="row spread"><b class="small">Kart deposu</b><a class="tiny" href="#/kartlar" style="color:var(--acc)">Çalış →</a></div>
        <div class="row wrap" style="gap:6px;margin-top:10px">
          <span class="chip">${cards.length} kart</span>
          <span class="chip ${due.due ? 'bad' : 'ok'}">${due.due} tekrar zamanı</span>
          <span class="chip">${due.fresh} hiç çalışılmadı</span>
          <span class="chip">${cards.length - due.fresh} öğrenildi</span>
        </div>
      </div>

      ${ready.length ? `<div><div class="sec-title"><h2>Ders bazında</h2></div>
        <div class="week-list">${courseRows}</div></div>` : ''}

      ${weak.length ? `<div><div class="sec-title"><h2>Tekrar etmen gerekenler</h2>
        <span class="tiny muted">%70 altı</span></div>
        <div class="week-list">${weak.slice(0, 12).map((w) => `<a class="week-item" href="#/quiz/${w.code}/${w.tid}" style="--c:${w.color}">
          <span class="week-num">${w.week}</span>
          <span class="wi-body"><b>${escHtml(w.title)}</b><small>${escHtml(w.name)}</small></span>
          <span class="wi-score" style="color:var(--bad)">%${w.score}</span></a>`).join('')}</div></div>` : ''}

      ${untouched.length ? `<div><div class="sec-title"><h2>Hiç bakmadıkların</h2>
        <span class="tiny muted">${untouched.length} konu</span></div>
        <div class="week-list">${untouched.slice(0, 8).map((w) => `<a class="week-item" href="#/konu/${w.code}/${w.tid}" style="--c:${w.color}">
          <span class="week-num">${w.week}</span>
          <span class="wi-body"><b>${escHtml(w.title)}</b><small>${escHtml(w.name)}</small></span>
          <span class="tiny muted">başla →</span></a>`).join('')}</div></div>` : ''}

      ${!totals.questions && !totals.minutes ? empty('chart', 'Henüz veri yok', 'Bir konu okuyup soru çözünce burası dolmaya başlayacak.', '<a class="btn primary" href="#/dersler">Derslere git</a>') : ''}
    </div>`,
  };
}
