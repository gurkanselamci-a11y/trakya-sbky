// quizrunner.js — soru çözme motoru. Bir soru listesi alır, tek tek sorar,
// anında geri bildirim verir ve sonuç ekranını çizer.
// Hem ders quizi (views/quiz.js) hem de yanlış tekrarı (views/mistakes.js) bunu kullanır.

import { store } from './store.js';
import { checkAnswer } from './data.js';
import { md, mdInline, mdPhrase } from './md.js';
import { escHtml, toast, bindCopy, fitMath } from './ui.js';
import { ico } from './icons.js';

const DIFF = { 1: 'kolay', 2: 'orta', 3: 'zor' };

export function typeLabel(t) {
  return {
    mcq: 'çoktan seçmeli', tf: 'doğru/yanlış', numeric: 'hesap',
    short: 'kısa cevap', code: 'kod çıktısı', open: 'açık uçlu',
  }[t] || t;
}

/** Quiz kabuğu — görünümün html'ine gömülür. */
export function quizShell(color, total) {
  return `<div class="stack" style="--c:${color}">
    <div class="quiz-head">
      <span class="chip" id="qCount">1/${total}</span>
      <div class="bar" style="--c:${color}"><i id="qBar" style="width:0%"></i></div>
      <span class="chip ok" id="qScore">0 ${ico('check')}</span>
    </div>
    <div id="qHost"></div>
  </div>`;
}

/**
 * @param {HTMLElement} root  görünümün kökü (quizShell çıktısını içermeli)
 * @param {Array} questions   collectQuestions çıktısı
 * @param {Object} opts
 *   showSource  — soruda ders adını da göster (karışık listelerde)
 *   onFinish    — (summary) => void, ilerleme kaydı için
 *   finishActions — (summary) => html, sonuç ekranındaki düğmeler
 *   retryLabel  — "Tekrar çöz" düğmesi metni (null ise gösterilmez)
 */
export function mountQuiz(root, questions, opts = {}) {
  const host = root.querySelector('#qHost');
  const bar = root.querySelector('#qBar');
  const counter = root.querySelector('#qCount');
  const scoreEl = root.querySelector('#qScore');

  const session = { i: 0, answered: [], answeredNow: false, startedAt: Date.now() };
  let selected = null;

  function paintHead() {
    counter.textContent = `${Math.min(session.i + 1, questions.length)}/${questions.length}`;
    bar.style.width = `${(session.answered.length / questions.length) * 100}%`;
    scoreEl.innerHTML = `${session.answered.filter((a) => a.correct === true).length} ${ico('check')}`;
  }

  function answerUI(q) {
    switch (q.type) {
      case 'mcq':
        return `<div class="choices">${q.choices.map((c, i) =>
          `<button class="choice" data-i="${i}"><span class="ck">${'ABCDE'[i]}</span><span class="grow">${mdPhrase(c)}</span></button>`).join('')}</div>`;
      case 'tf':
        return `<div class="choices">
          <button class="choice" data-tf="true"><span class="ck">D</span><span>Doğru</span></button>
          <button class="choice" data-tf="false"><span class="ck">Y</span><span>Yanlış</span></button></div>`;
      case 'numeric':
        return `<div class="row"><input class="ans-input" id="numIn" type="text" inputmode="decimal"
          placeholder="Sayısal cevap${q.unit ? ' (' + escHtml(q.unit) + ')' : ''}" autocomplete="off">
          ${q.unit ? `<span class="chip">${escHtml(q.unit)}</span>` : ''}</div>`;
      case 'short':
        return `<input class="ans-input" id="shortIn" type="text" placeholder="Kısa cevabını yaz" autocomplete="off">`;
      case 'code':
        return `<textarea class="ans-input code" id="codeIn" placeholder="Programın ekrana yazdıracağı çıktıyı yaz" spellcheck="false"></textarea>`;
      case 'open':
        return `<textarea class="ans-input" id="openIn" placeholder="Cevabını kendi cümlelerinle yaz…"></textarea>
          ${q.rubric?.length ? `<p class="tiny muted" style="margin:8px 0 0">Cevabını yazdıktan sonra kendini değerlendireceksin.</p>` : ''}`;
      default:
        return '';
    }
  }

  function wireAnswer(q) {
    selected = null;
    const area = host.querySelector('#answerArea');
    if (q.type === 'mcq' || q.type === 'tf') {
      area.querySelectorAll('.choice').forEach((btn) => {
        btn.addEventListener('click', () => {
          area.querySelectorAll('.choice').forEach((b) => b.classList.remove('sel'));
          btn.classList.add('sel');
          selected = q.type === 'mcq' ? Number(btn.dataset.i) : btn.dataset.tf === 'true';
        });
      });
    } else {
      const input = area.querySelector('input, textarea');
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (input.tagName === 'INPUT' || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            host.querySelector('#actionBtn').click();
          }
        });
        setTimeout(() => input.focus(), 60);
      }
    }
  }

  function readAnswer(q) {
    if (q.type === 'mcq' || q.type === 'tf') return selected;
    const el = host.querySelector('#answerArea input, #answerArea textarea');
    return el ? el.value : '';
  }

  function record(q, given, correct) {
    session.answered.push({ q, given, correct });
    store.logAnswer({
      code: q.courseCode, topicId: q.topicId, qid: q.uid,
      correct: !!correct, type: q.type,
    });
  }

  function renderQuestion() {
    const q = questions[session.i];
    session.answeredNow = false;
    paintHead();

    host.innerHTML = `
      <div class="qbox">
        <div class="row wrap" style="gap:6px;margin-bottom:12px">
          ${opts.showSource && q.courseName ? `<span class="chip on">${escHtml(q.courseName)}</span>` : ''}
          <span class="chip">${q.week}. hafta</span>
          <span class="chip">${DIFF[q.difficulty] || 'orta'}</span>
          <span class="chip">${typeLabel(q.type)}</span>
        </div>
        <div class="qtext">${mdInline(q.q)}</div>
        ${q.code ? `<div>${md('```' + (q.lang || '') + '\n' + q.code + '\n```')}</div>` : ''}
        <div id="answerArea">${answerUI(q)}</div>
        <div id="verdict"></div>
        <div class="btn-row quiz-actions">
          <button class="btn primary grow" id="actionBtn">Kontrol et</button>
          <button class="btn ghost" id="skipBtn">Atla</button>
        </div>
      </div>`;

    bindCopy(host);
    fitMath(host);
    wireAnswer(q);

    host.querySelector('#skipBtn').addEventListener('click', () => {
      if (!session.answeredNow) session.answered.push({ q, given: null, correct: false, skipped: true });
      advance();
    });
    host.querySelector('#actionBtn').addEventListener('click', () => {
      if (session.answeredNow) { advance(); return; }
      submit(q);
    });
  }

  function submit(q) {
    const given = readAnswer(q);
    if (given === null || given === undefined || (typeof given === 'string' && !given.trim())) {
      toast('Önce bir cevap ver');
      return;
    }

    const res = checkAnswer(q, given);
    session.answeredNow = true;

    if (q.type === 'mcq') {
      host.querySelectorAll('.choice').forEach((btn) => {
        const i = Number(btn.dataset.i);
        btn.disabled = true;
        if (i === Number(q.answer)) btn.classList.add('right');
        else if (i === Number(given)) btn.classList.add('wrong');
      });
    } else if (q.type === 'tf') {
      host.querySelectorAll('.choice').forEach((btn) => {
        const v = btn.dataset.tf === 'true';
        btn.disabled = true;
        if (v === Boolean(q.answer)) btn.classList.add('right');
        else if (v === Boolean(given)) btn.classList.add('wrong');
      });
    } else {
      const el = host.querySelector('#answerArea input, #answerArea textarea');
      if (el) el.disabled = true;
    }

    const nextLabel = questions[session.i + 1] ? 'Sonraki soru →' : 'Sonucu gör';
    const v = host.querySelector('#verdict');

    if (q.type === 'open') {
      v.innerHTML = `<div class="verdict">
        <div class="verdict-h">${ico('book')} Örnek cevap</div>
        <div class="prose">${md(q.explain || '')}</div>
        ${q.rubric?.length ? `<ul class="rubric">${q.rubric.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>` : ''}
        <p class="small muted" style="margin:12px 0 6px">Kendi cevabın bunu karşılıyor mu?</p>
        <div class="btn-row"><button class="btn" data-self="1">${ico('check')} Büyük ölçüde</button>
        <button class="btn" data-self="0">${ico('x')} Eksik kaldı</button></div>
      </div>`;
      v.querySelectorAll('[data-self]').forEach((b) => b.addEventListener('click', () => {
        const okSelf = b.dataset.self === '1';
        record(q, given, okSelf);
        v.querySelectorAll('[data-self]').forEach((x) => { x.disabled = true; });
        b.classList.add(okSelf ? 'primary' : 'danger');
        paintHead();
      }));
      host.querySelector('#actionBtn').textContent = nextLabel;
      host.querySelector('#skipBtn').hidden = true;
      return;
    }

    record(q, given, res.correct);
    v.innerHTML = `<div class="verdict ${res.correct ? 'ok' : 'bad'}">
      <div class="verdict-h">${res.correct ? ico('check') + ' Doğru' : ico('x') + ' Yanlış'}</div>
      ${!res.correct && res.expected != null
        ? `<p class="small" style="margin:0 0 8px">Doğru cevap: <b>${q.type === 'code' ? '<code>' + escHtml(res.expected) + '</code>' : escHtml(res.expected)}</b></p>` : ''}
      <div class="prose">${md(q.explain || '')}</div>
    </div>`;
    bindCopy(v);
    fitMath(v);

    host.querySelector('#actionBtn').textContent = nextLabel;
    host.querySelector('#skipBtn').hidden = true;
    paintHead();
  }

  function advance() {
    if (session.i + 1 >= questions.length) return finish();
    session.i += 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function finish() {
    const right = session.answered.filter((a) => a.correct === true).length;
    const score = Math.round((right / questions.length) * 100);
    const secs = Math.round((Date.now() - session.startedAt) / 1000);
    const summary = { right, score, secs, total: questions.length, answered: session.answered };

    if (typeof opts.onFinish === 'function') opts.onFinish(summary);

    const wrong = session.answered.filter((a) => a.correct === false);
    const mark = score >= 85 ? 'trophy' : score >= 70 ? 'check' : score >= 50 ? 'flame' : 'book';
    const msg = score >= 85 ? 'Mükemmel! Bu konuyu çözmüşsün.'
      : score >= 70 ? 'İyi iş. Birkaç eksik kaldı.'
      : score >= 50 ? 'Fena değil ama tekrar şart.'
      : 'Konuyu bir daha okumakta fayda var.';

    host.innerHTML = `
      <div class="qbox center">
        ${ico(mark, 'ico-lg')}
        <h1 style="margin:6px 0 0">%${score}</h1>
        <p class="muted small" style="margin:4px 0 0">${right}/${questions.length} doğru · ${Math.floor(secs / 60)} dk ${secs % 60} sn</p>
        <p style="margin:14px 0 0">${msg}</p>
        <div class="btn-row" style="margin-top:20px;justify-content:center">
          ${opts.retryLabel === null ? '' : `<button class="btn primary" id="againBtn">${opts.retryLabel || 'Tekrar çöz'}</button>`}
          ${typeof opts.finishActions === 'function' ? opts.finishActions(summary) : ''}
        </div>
      </div>
      ${wrong.length ? `<div class="sec-title"><h2>Yanlışların (${wrong.length})</h2></div>
        <div class="stack">${wrong.map((a) => `<div class="card">
          <div class="tiny muted">${a.q.courseName ? escHtml(a.q.courseName) + ' · ' : ''}${a.q.week}. hafta · ${escHtml(a.q.topicTitle)}</div>
          <div class="small" style="margin:6px 0">${mdInline(a.q.q)}</div>
          <div class="prose small" style="border-top:1px solid var(--line-soft);padding-top:8px">${md(a.q.explain || '')}</div>
        </div>`).join('')}</div>` : ''}`;

    host.querySelector('#againBtn')?.addEventListener('click', () => {
      session.i = 0; session.answered = []; session.startedAt = Date.now();
      renderQuestion();
    });
    bindCopy(host);
    fitMath(host);
    paintHead();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  renderQuestion();
}
