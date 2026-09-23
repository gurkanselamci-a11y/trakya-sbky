// views/quiz.js — bir dersin (veya tek haftanın) sorularını çözdürür.

import { store } from '../store.js';
import { getCourse, getCourseMeta, collectQuestions, shuffle } from '../data.js';
import { empty } from '../ui.js';
import { mountQuiz, quizShell } from '../quizrunner.js';
import { ico } from '../icons.js';

export default async function quizView([code, topicId]) {
  const meta = await getCourseMeta(code);
  const course = await getCourse(code);
  if (!course) return { title: meta.name, sub: code, html: empty('soon', 'İçerik yok', '') };

  const topic = topicId ? course.topics.find((t) => t.id === topicId) : null;
  const pool = collectQuestions(course, topic ? [topic.id] : null);
  if (!pool.length) {
    return {
      title: 'Soru yok',
      sub: meta.shortName,
      html: empty('help', 'Bu bölümde soru yok', '', `<a class="btn" href="#/ders/${code}">Derse dön</a>`),
    };
  }

  const questions = topic
    ? pool
    : shuffle(pool).slice(0, Math.min(store.settings.quizLength || 10, pool.length));

  return {
    title: topic ? `${topic.week}. Hafta Soruları` : 'Karışık Sorular',
    sub: meta.shortName,
    html: quizShell(meta.color, questions.length),

    onMount(root) {
      mountQuiz(root, questions, {
        onFinish({ score, answered }) {
          if (topic) {
            const prev = store.topicProgress(code, topic.id);
            store.setTopicProgress(code, topic.id, {
              bestScore: Math.max(prev.bestScore || 0, score),
              attempts: (prev.attempts || 0) + 1,
            });
            return;
          }
          // Karışık quizde her konunun skoru ayrı güncellenir
          const byTopic = {};
          answered.forEach((a) => {
            byTopic[a.q.topicId] ||= { r: 0, n: 0 };
            byTopic[a.q.topicId].n += 1;
            if (a.correct) byTopic[a.q.topicId].r += 1;
          });
          for (const [tid, v] of Object.entries(byTopic)) {
            const prev = store.topicProgress(code, tid);
            const s = Math.round((v.r / v.n) * 100);
            store.setTopicProgress(code, tid, {
              bestScore: Math.max(prev.bestScore || 0, s),
              attempts: (prev.attempts || 0) + 1,
            });
          }
        },
        finishActions: () => `
          ${topic ? `<a class="btn" href="#/konu/${code}/${topic.id}">Konuya dön</a>` : ''}
          <a class="btn ghost" href="#/ders/${code}">Ders sayfası</a>`,
      });
    },
  };
}
