// views/cards.js — aralıklı tekrar (SRS) ile bilgi kartı çalışması.

import { store } from '../store.js';
import { getReadyCourses, getCourse, getCourseMeta, collectCards, shuffle } from '../data.js';
import { md, mdInline } from '../md.js';
import { escHtml, empty, toast } from '../ui.js';
import { buildQueue, review, previewInterval, GRADES, dueCount, newCard } from '../srs.js';
import { refreshChrome } from '../app.js';
import { ico } from '../icons.js';

export default async function cardsView([code]) {
  let cards = [];
  let title = 'Kart Tekrarı';
  let sub = 'Tüm dersler';
  let color = 'var(--acc)';

  if (code) {
    const course = await getCourse(code);
    const meta = await getCourseMeta(code);
    if (!course) return { title: meta.name, sub: code, html: empty('soon', 'İçerik yok', '') };
    cards = collectCards(course);
    sub = meta.shortName;
    color = meta.color;
  } else {
    const ready = await getReadyCourses();
    cards = ready.flatMap((c) => collectCards(c.course));
  }

  if (!cards.length) {
    return { title, sub, html: empty('layers', 'Kart yok', 'Bu seçim için bilgi kartı bulunamadı.', '<a class="btn" href="#/dersler">Derslere git</a>') };
  }

  const stats = dueCount(cards, store.state.srs);
  const queue = buildQueue(cards, store.state.srs, { newPerDay: store.settings.newCardsPerDay || 20 });

  if (!queue.length) {
    const next = cards
      .map((c) => store.state.srs[c.id])
      .filter((x) => x && x.due)
      .sort((a, b) => a.due - b.due)[0];
    return {
      title, sub,
      html: empty('check', 'Bugünlük bitti!',
        next ? `Bir sonraki tekrar: ${new Date(next.due).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}`
             : 'Şu an tekrar edilecek kart yok.',
        `<div class="btn-row" style="justify-content:center;margin-top:14px">
          <button class="btn" id="extraBtn">Yine de çalış (karışık 20)</button>
          <a class="btn ghost" href="#/">Ana sayfa</a></div>`),
      onMount(root) {
        root.querySelector('#extraBtn')?.addEventListener('click', () => {
          startSession(root, shuffle(cards).slice(0, 20), color, true);
        });
      },
    };
  }

  return {
    title,
    sub: `${sub} · ${stats.due} tekrar, ${stats.fresh} yeni`,
    html: `<div id="cardHost" style="--c:${color}"></div>`,
    onMount(root) { return startSession(root, queue, color, false); },
  };
}

function startSession(root, queue, color, extra) {
  const host = root.querySelector('#cardHost') || root;
  const session = { i: 0, shown: false, done: 0, again: 0, startedAt: Date.now() };

  function render() {
    if (session.i >= queue.length) return finish();
    const card = queue[session.i];
    const state = store.state.srs[card.id] || newCard();

    host.innerHTML = `
      <div class="stack" style="--c:${card.color || color}">
        <div class="quiz-head">
          <span class="chip">${session.i + 1}/${queue.length}</span>
          <div class="bar" style="--c:${card.color || color}"><i style="width:${(session.i / queue.length) * 100}%"></i></div>
          <span class="chip">${state.reps ? 'tekrar' : 'yeni'}</span>
        </div>

        <div class="flash" id="flash">
          <div class="tiny muted">${escHtml(card.courseName)} · ${card.week}. hafta</div>
          <div class="fq">${mdInline(card.q)}</div>
          <div class="fa" id="answer" hidden>${md(card.a)}</div>
          <div class="tiny muted" id="hint">Cevabı görmek için dokun</div>
        </div>

        <div id="grades" hidden>
          <div class="grade-row">
            ${GRADES.map((g) => `<button class="grade ${g.cls}" data-q="${g.q}">
              ${g.label}<small>${previewInterval(state, g.q)}</small></button>`).join('')}
          </div>
          <p class="tiny muted center" style="margin-top:8px">Klavye: 1–4 · Boşluk çevir</p>
        </div>

        <div class="row spread tiny muted">
          <a href="#/konu/${card.code}/${card.topicId}">${escHtml(card.topicTitle)} →</a>
          <span>${session.done} tamam · ${session.again} tekrar</span>
        </div>
      </div>`;

    const flash = host.querySelector('#flash');
    const answer = host.querySelector('#answer');
    const hint = host.querySelector('#hint');
    const grades = host.querySelector('#grades');

    const reveal = () => {
      if (session.shown) return;
      session.shown = true;
      answer.hidden = false;
      hint.hidden = true;
      grades.hidden = false;
    };
    flash.addEventListener('click', reveal);

    grades.querySelectorAll('.grade').forEach((btn) => {
      btn.addEventListener('click', () => grade(card, Number(btn.dataset.q)));
    });
  }

  function grade(card, q) {
    const prev = store.state.srs[card.id] || newCard();
    const next = review(prev, q);
    store.update((s) => { s.srs[card.id] = next; });
    if (q < 3) { session.again += 1; queue.push(card); } else session.done += 1;
    session.i += 1;
    session.shown = false;
    render();
    refreshChrome();
  }

  function finish() {
    const mins = Math.round((Date.now() - session.startedAt) / 60000);
    host.innerHTML = `<div class="qbox center">
      ${ico('trophy', 'ico-lg')}
      <h1 style="margin:6px 0 0">Tekrar bitti</h1>
      <p class="muted small">${session.done} kart tamamlandı${session.again ? ` · ${session.again} kart tekrar sıraya alındı` : ''} · ${mins} dk</p>
      <div class="btn-row" style="margin-top:18px;justify-content:center">
        <a class="btn primary" href="#/">Ana sayfa</a>
        <a class="btn" href="#/dersler">Derslere git</a>
      </div></div>`;
    if (!extra) toast('Tekrar tamamlandı');
    refreshChrome();
  }

  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    const flash = host.querySelector('#flash');
    if (!flash) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flash.click(); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && session.shown) {
      e.preventDefault();
      host.querySelectorAll('.grade')[n - 1]?.click();
    }
  };
  document.addEventListener('keydown', onKey);

  render();
  return () => document.removeEventListener('keydown', onKey);
}
