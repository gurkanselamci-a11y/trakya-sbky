// views/mistakes.js — daha önce yanlış yaptığın soruları tekrar çözdürür.
// Kaynak: store.answers (her cevabın kaydı). Sonradan doğru yaptığın sorular listeden düşer.

import { store } from '../store.js';
import { getReadyCourses, collectQuestions, shuffle } from '../data.js';
import { empty, escHtml } from '../ui.js';
import { mountQuiz, quizShell } from '../quizrunner.js';
import { ico } from '../icons.js';

/** Hâlâ "yanlış" durumda olan soru kimlikleri — son cevap belirleyicidir. */
export function pendingMistakeIds(answers) {
  const last = new Map();
  for (const a of answers) {
    if (!a.qid) continue;
    last.set(a.qid, a);
  }
  const out = [];
  for (const [qid, a] of last) if (a.correct === false) out.push(qid);
  return out;
}

/** Yanlış sorulara ait soru nesneleri (ders içerikleriyle eşleştirilmiş). */
export async function loadMistakeQuestions() {
  const ids = new Set(pendingMistakeIds(store.state.answers));
  if (!ids.size) return [];
  const courses = await getReadyCourses();
  const out = [];
  for (const c of courses) {
    for (const q of collectQuestions(c.course)) {
      if (ids.has(q.uid)) out.push({ ...q, courseName: c.shortName, color: c.color });
    }
  }
  return out;
}

export default async function mistakesView() {
  const questions = await loadMistakeQuestions();

  if (!questions.length) {
    const everAnswered = store.state.answers.length;
    return {
      title: 'Yanlışlarım',
      sub: 'Tekrar çöz',
      html: empty(
        everAnswered ? 'target' : 'exam',
        everAnswered ? 'Bekleyen yanlışın yok' : 'Henüz soru çözmedin',
        everAnswered
          ? 'Yanlış yaptığın her soru buraya düşer ve doğru çözene kadar kalır.'
          : 'Soru çözmeye başlayınca yanlışların burada birikir ve tek tuşla tekrar çözebilirsin.',
        '<div class="btn-row" style="justify-content:center;margin-top:14px">'
        + '<a class="btn primary" href="#/dersler">Derslere git</a>'
        + '<a class="btn ghost" href="#/istatistik">İstatistik</a></div>',
      ),
    };
  }

  // Ders bazında dağılım — kullanıcı neyle karşılaşacağını bilsin
  const byCourse = {};
  questions.forEach((q) => { byCourse[q.courseName] = (byCourse[q.courseName] || 0) + 1; });
  const chips = Object.entries(byCourse)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `<span class="chip">${escHtml(n)} · ${c}</span>`)
    .join('');

  const picked = shuffle(questions).slice(0, Math.min(20, questions.length));

  return {
    title: 'Yanlışlarım',
    sub: `${questions.length} soru bekliyor`,
    html: `<div class="stack">
        <div class="card">
          <b>Yanlış yaptığın sorular</b>
          <p class="small muted" style="margin:6px 0 10px">
            Doğru çözdüğünde soru bu listeden düşer. Bu turda ${picked.length} soru var.</p>
          <div class="row wrap" style="gap:6px">${chips}</div>
        </div>
      </div>
      ${quizShell('var(--bad)', picked.length)}`,

    onMount(root) {
      mountQuiz(root, picked, {
        showSource: true,
        retryLabel: 'Bir tur daha',
        finishActions: () => `
          <a class="btn" href="#/yanlislarim">Listeyi yenile</a>
          <a class="btn ghost" href="#/istatistik">İstatistik</a>`,
      });
    },
  };
}
