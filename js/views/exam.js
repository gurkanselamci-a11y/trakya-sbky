// views/exam.js — süreli deneme sınavı (vize / final / karma).

import { store } from '../store.js';
import { getReadyCoursesLite, getReadyCourses, getCourse, getCourseMeta, collectQuestions, shuffle, checkAnswer } from '../data.js';
import { md, mdInline, mdPhrase } from '../md.js';
import { escHtml, empty, toast, bindCopy, fitMath } from '../ui.js';
import { ico } from '../icons.js';

const SCOPES = {
  vize: { label: 'Vize', weeks: [1, 7], count: 20, minutes: 40, desc: '1–7. haftalar' },
  final: { label: 'Final', weeks: [1, 14], count: 30, minutes: 60, desc: 'Tüm dönem' },
  hizli: { label: 'Hızlı Test', weeks: [1, 14], count: 10, minutes: 15, desc: '10 soru' },
  karma: { label: 'Karma Deneme', weeks: [1, 14], count: 30, minutes: 60, desc: 'Tüm derslerden' },
};

/** Karma denemede sanal ders kodu — tek bir dersin değil, hepsinin havuzu kullanılır. */
const ALL = 'TUMU';

export default async function examView([code, scope]) {
  if (!code || !scope) return examPicker();

  const conf = SCOPES[scope] || SCOPES.hizli;
  const mixed = code === ALL;

  let meta;
  let course;
  let eligible;

  if (mixed) {
    const all = await getReadyCourses();
    if (!all.length) return { title: 'Sınav', sub: 'Karma', html: empty('soon', 'İçerik yok', '') };
    meta = { shortName: 'Tüm dersler', color: 'var(--acc)', icon: 'cap' };
    course = { name: 'Tüm dersler', topics: [] };
    eligible = all.flatMap((c) => collectQuestions(c.course)
      .filter((q) => q.type !== 'open')
      .map((q) => ({ ...q, courseName: c.shortName })));
  } else {
    meta = await getCourseMeta(code);
    course = await getCourse(code);
    if (!course) return { title: 'Sınav', sub: code, html: empty('soon', 'İçerik yok', '') };
    eligible = collectQuestions(course)
      .filter((q) => q.week >= conf.weeks[0] && q.week <= conf.weeks[1] && q.type !== 'open');
  }

  if (eligible.length < 5) {
    return { title: 'Sınav', sub: meta.shortName, html: empty('help', 'Yeterli soru yok', 'Bu kapsam için yeterli soru bulunamadı.', `<a class="btn" href="#/ders/${code}">Derse dön</a>`) };
  }

  const questions = shuffle(eligible).slice(0, Math.min(conf.count, eligible.length));
  const answers = new Array(questions.length).fill(null);
  const durationSec = conf.minutes * 60;
  let started = 0;
  let timerId = null;
  let submitted = false;

  return {
    title: `${conf.label} Denemesi`,
    sub: `${meta.shortName} · ${questions.length} soru · ${conf.minutes} dk`,
    html: `<div id="examHost" style="--c:${meta.color}"></div>`,

    onMount(root) {
      const host = root.querySelector('#examHost');

      function intro() {
        host.innerHTML = `<div class="qbox center">
          ${ico('exam', 'ico-lg')}
          <h1 style="margin:6px 0 0">${conf.label} Denemesi</h1>
          <p class="muted small">${escHtml(course.name)} · ${conf.desc}</p>
          <div class="row wrap" style="justify-content:center;gap:6px;margin:16px 0">
            <span class="chip">${questions.length} soru</span>
            <span class="chip">${conf.minutes} dakika</span>
            <span class="chip">süre bitince otomatik teslim</span>
          </div>
          <p class="small muted">Tüm soruları cevapla, sonunda tek seferde değerlendirilecek — gerçek sınav gibi.</p>
          <button class="btn primary block" id="startBtn" style="margin-top:16px">Sınavı başlat</button>
          <a class="btn ghost block" href="${mixed ? '#/sinav' : `#/ders/${code}`}" style="margin-top:8px">Vazgeç</a>
        </div>`;
        host.querySelector('#startBtn').addEventListener('click', begin);
      }

      function begin() {
        started = Date.now();
        timerId = setInterval(tick, 1000);
        renderSheet();
      }

      function remaining() {
        return Math.max(0, durationSec - Math.floor((Date.now() - started) / 1000));
      }

      function tick() {
        const el = host.querySelector('#timer');
        const r = remaining();
        if (el) {
          const m = String(Math.floor(r / 60)).padStart(2, '0');
          const s = String(r % 60).padStart(2, '0');
          el.textContent = `${m}:${s}`;
          el.classList.toggle('warn', r <= 60);
        }
        if (r <= 0) { clearInterval(timerId); toast('Süre doldu — sınav teslim edildi'); grade(); }
      }

      function renderSheet() {
        host.innerHTML = `
          <div class="quiz-head" style="position:sticky;top:56px;z-index:20;background:var(--bg);padding:8px 0">
            <span class="timer" id="timer">${String(conf.minutes).padStart(2, '0')}:00</span>
            <div class="bar" style="--c:${meta.color}"><i id="ansBar" style="width:0%"></i></div>
            <span class="chip" id="ansCount">0/${questions.length}</span>
          </div>
          <div class="stack" id="sheet">${questions.map((q, i) => sheetItem(q, i)).join('')}</div>
          <div class="quiz-actions"><button class="btn primary block" id="submitBtn">Sınavı bitir ve değerlendir</button></div>`;

        bindCopy(host);
        fitMath(host);
        host.querySelectorAll('[data-qi]').forEach((el) => {
          el.addEventListener('click', (e) => {
            const btn = e.target.closest('.choice');
            if (!btn) return;
            const qi = Number(el.dataset.qi);
            el.querySelectorAll('.choice').forEach((b) => b.classList.remove('sel'));
            btn.classList.add('sel');
            answers[qi] = btn.dataset.tf !== undefined ? btn.dataset.tf === 'true' : Number(btn.dataset.i);
            updateCount();
          });
          el.addEventListener('input', (e) => {
            if (!e.target.matches('input, textarea')) return;
            answers[Number(el.dataset.qi)] = e.target.value;
            updateCount();
          });
        });
        host.querySelector('#submitBtn').addEventListener('click', () => {
          const blanks = answers.filter((a) => a === null || a === '').length;
          if (blanks && !confirm(`${blanks} soru boş. Yine de bitirmek istiyor musun?`)) return;
          clearInterval(timerId);
          grade();
        });
      }

      function updateCount() {
        const n = answers.filter((a) => a !== null && a !== '').length;
        host.querySelector('#ansCount').textContent = `${n}/${questions.length}`;
        host.querySelector('#ansBar').style.width = `${(n / questions.length) * 100}%`;
      }

      function sheetItem(q, i) {
        let ui = '';
        if (q.type === 'mcq') {
          ui = `<div class="choices">${q.choices.map((c, n) =>
            `<button class="choice" type="button" data-i="${n}"><span class="ck">${'ABCDE'[n]}</span><span class="grow">${mdPhrase(c)}</span></button>`).join('')}</div>`;
        } else if (q.type === 'tf') {
          ui = `<div class="choices">
            <button class="choice" type="button" data-tf="true"><span class="ck">D</span><span>Doğru</span></button>
            <button class="choice" type="button" data-tf="false"><span class="ck">Y</span><span>Yanlış</span></button></div>`;
        } else if (q.type === 'code') {
          ui = `<textarea class="ans-input code" placeholder="Çıktı" spellcheck="false"></textarea>`;
        } else {
          ui = `<input class="ans-input" type="text" placeholder="${q.type === 'numeric' ? 'Sayısal cevap' + (q.unit ? ' (' + escHtml(q.unit) + ')' : '') : 'Kısa cevap'}" autocomplete="off">`;
        }
        return `<div class="qbox" data-qi="${i}">
          <div class="row spread tiny muted" style="margin-bottom:8px">
            <span>Soru ${i + 1}</span><span>${q.courseName ? escHtml(q.courseName) + ' · ' : ''}${q.week}. hafta</span>
          </div>
          <div class="qtext" style="font-size:15.5px">${mdInline(q.q)}</div>
          ${q.code ? md('```' + (q.lang || '') + '\n' + q.code + '\n```') : ''}
          ${ui}</div>`;
      }

      function grade() {
        if (submitted) return;
        submitted = true;
        const results = questions.map((q, i) => {
          const given = answers[i];
          const r = (given === null || given === '') ? { correct: false, expected: null } : checkAnswer(q, given);
          store.logAnswer({ code: q.courseCode || code, topicId: q.topicId, qid: q.uid, correct: !!r.correct, type: q.type, exam: true });
          return { q, given, ...r };
        });

        const right = results.filter((r) => r.correct).length;
        const score = Math.round((right / questions.length) * 100);
        const secs = Math.round((Date.now() - started) / 1000);

        store.update((s) => {
          s.examHistory.push({ at: Date.now(), code, scope, score, total: questions.length, right, durationSec: secs });
          if (s.examHistory.length > 100) s.examHistory = s.examHistory.slice(-100);
        });

        // Konu bazlı zayıf nokta analizi
        // Anahtar ders koduyla birlikte kurulur (karma denemede iki dersin "w3" konusu
        // çakışmasın). Sayaçlar da AYNI anahtarla artırılmalı — eskiden yalnızca topicId
        // ile okunuyordu ve tanımsız nesneye yazıldığı için sınav teslimi hata veriyordu.
        const byTopic = {};
        results.forEach((r) => {
          const key = r.q.courseCode + '/' + r.q.topicId;
          byTopic[key] ||= { title: r.q.topicTitle, week: r.q.week, n: 0, ok: 0, code: r.q.courseCode, tid: r.q.topicId, courseName: r.q.courseName };
          byTopic[key].n += 1;
          if (r.correct) byTopic[key].ok += 1;
        });
        const weak = Object.entries(byTopic)
          .map(([, v]) => ({ ...v, pct: Math.round((v.ok / v.n) * 100) }))
          .filter((x) => x.pct < 70)
          .sort((a, b) => a.pct - b.pct);

        const pass = score >= 50;
        host.innerHTML = `
          <div class="qbox center">
            ${ico(score >= 85 ? 'trophy' : pass ? 'check' : 'book', 'ico-lg')}
            <h1 style="margin:6px 0 0">${score} / 100</h1>
            <p class="muted small">${right}/${questions.length} doğru · ${Math.floor(secs / 60)} dk ${secs % 60} sn</p>
            <p style="margin-top:12px">${score >= 85 ? 'Sınava hazırsın.' : pass ? 'Geçer durumdasın, ama eksikler var.' : 'Bu haliyle riskli. Zayıf konulara dön.'}</p>
          </div>

          ${weak.length ? `<div class="sec-title"><h2>Zayıf konuların</h2></div>
            <div class="week-list">${weak.map((w) => `<a class="week-item" href="#/konu/${w.code}/${w.tid}" style="--c:${meta.color}">
              <span class="week-num">${w.week}</span>
              <span class="wi-body"><b>${escHtml(w.title)}</b><small>${w.courseName ? escHtml(w.courseName) + ' · ' : ''}${w.ok}/${w.n} doğru</small></span>
              <span class="wi-score" style="color:var(--bad)">%${w.pct}</span></a>`).join('')}</div>` : ''}

          <div class="sec-title"><h2>Cevap anahtarı</h2></div>
          <div class="stack">${results.map((r, i) => `<div class="card" style="border-color:${r.correct ? 'color-mix(in srgb,var(--ok) 40%,transparent)' : 'color-mix(in srgb,var(--bad) 40%,transparent)'}">
            <div class="row spread tiny muted"><span>Soru ${i + 1} · ${r.q.week}. hafta</span><span>${ico(r.correct ? 'check' : 'x')}</span></div>
            <div class="small" style="margin:6px 0">${mdInline(r.q.q)}</div>
            ${!r.correct ? `<p class="small" style="margin:0 0 6px">Doğru: <b>${escHtml(String(r.expected ?? ''))}</b>${r.given !== null && r.given !== '' ? ` · senin cevabın: <span class="muted">${escHtml(String(r.q.type === 'mcq' ? (r.q.choices[r.given] ?? r.given) : r.given))}</span>` : ' · <span class="muted">boş bıraktın</span>'}</p>` : ''}
            <div class="prose small" style="border-top:1px solid var(--line-soft);padding-top:8px">${md(r.q.explain || '')}</div>
          </div>`).join('')}</div>

          <div class="btn-row" style="margin-top:18px">
            <a class="btn primary grow" href="#/sinav">Yeni deneme</a>
            <a class="btn grow" href="${mixed ? '#/istatistik' : `#/ders/${code}`}">${mixed ? 'İstatistik' : 'Ders sayfası'}</a>
          </div>`;
        bindCopy(host);
        fitMath(host);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Sekme arka plana düştüğünde ya da ekran kapandığında tarayıcı 1 sn'lik zamanlayıcıyı
      // önce yavaşlatır, sonra tamamen dondurur. Kalan süre gerçek saatten hesaplandığı için
      // değer bozulmaz; buradaki dinleyici geri dönüldüğü anda ekranı tazeler ve donmuş
      // süre içinde dolan sınavı teslim eder — yoksa sayaç 00:00'da takılı kalırdı.
      const resync = () => { if (started && !submitted) tick(); };
      document.addEventListener('visibilitychange', resync);
      window.addEventListener('pageshow', resync);
      window.addEventListener('focus', resync);

      intro();
      return () => {
        clearInterval(timerId);
        document.removeEventListener('visibilitychange', resync);
        window.removeEventListener('pageshow', resync);
        window.removeEventListener('focus', resync);
      };
    },
  };
}

async function examPicker() {
  const ready = await getReadyCoursesLite();
  const history = store.state.examHistory.slice(-5).reverse();

  if (!ready.length) {
    return { title: 'Sınav', sub: 'Deneme', html: empty('exam', 'Henüz ders içeriği yok', 'Deneme sınavı için önce ders içeriği gerekiyor.') };
  }

  return {
    title: 'Deneme Sınavı',
    sub: 'Gerçek sınav koşullarında dene',
    html: `<div class="stack">
      <div class="card"><p class="small muted" style="margin:0">Süre tutulur, sorular karışık gelir ve değerlendirme sonda yapılır.
      Bitince zayıf konuların listelenir.</p></div>

      ${history.length ? `<div><div class="sec-title"><h2>Son denemelerin</h2></div>
        <div class="week-list">${history.map((h) => {
          const m = h.code === ALL ? { shortName: 'Tüm dersler', color: 'var(--acc-2)' } : ready.find((c) => c.code === h.code);
          return `<div class="week-item" style="--c:${m?.color || 'var(--acc)'}">
            <span class="week-num">${h.score}</span>
            <span class="wi-body"><b>${escHtml(m?.shortName || h.code)} · ${SCOPES[h.scope]?.label || h.scope}</b>
            <small>${new Date(h.at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</small></span>
            <span class="wi-score" style="color:${h.score >= 70 ? 'var(--ok)' : h.score >= 50 ? 'var(--warn)' : 'var(--bad)'}">${h.right}/${h.total}</span>
          </div>`;
        }).join('')}</div></div>` : ''}

      ${ready.length > 1 ? `<a class="card" href="#/sinav/${ALL}/karma" style="--c:var(--acc-2);display:block">
        <div class="row">${ico('cap', 'ico-md')}
        <span class="grow"><b>Karma deneme</b>
        <small class="muted" style="display:block">Tüm derslerden 30 soru · 60 dakika</small></span>
        <span class="btn primary">Başla</span></div></a>` : ''}

      ${ready.map((c) => `<div class="card" style="--c:${c.color}">
        <div class="row" style="margin-bottom:10px">
          <span class="cc-ico" style="width:36px;height:36px;border-radius:10px;display:grid;place-content:center;background:color-mix(in srgb, ${c.color} 18%, transparent)">${ico(c.icon)}</span>
          <span class="grow"><b>${escHtml(c.name)}</b><br><span class="tiny muted">${c.topicCount} konu</span></span>
        </div>
        <div class="btn-row">
          <a class="btn grow" href="#/sinav/${c.code}/hizli">${ico('clock')} Hızlı (10s · 15dk)</a>
          <a class="btn grow" href="#/sinav/${c.code}/vize">Vize (20s · 40dk)</a>
          <a class="btn grow" href="#/sinav/${c.code}/final">Final (30s · 60dk)</a>
        </div>
      </div>`).join('')}
    </div>`,
  };
}
