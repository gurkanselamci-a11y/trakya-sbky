// views/course.js — bir dersin 14 haftalık konu listesi ve genel durumu.

import { store } from '../store.js';
import { getCourse, getCourseMeta, collectCards, collectQuestions, getOfficial } from '../data.js';
import { escHtml, progressBar, empty } from '../ui.js';
import { dueCount } from '../srs.js';
import { currentWeek } from './home.js';
import { ico } from '../icons.js';
import { aktsOf } from '../akts.js';

/**
 * Üniversitenin ilan ettiği haftalık ders planı. Uygulamadaki anlatımla aynı şey DEĞİL:
 * anlatımı biz yazdık, bu tablo dersin resmî izlencesidir ve sınavın neyi kapsadığını
 * gösterir. Ara sınav satırı planı ikiye böler — öncesi vizenin, sonrası finalin kapsamı.
 */
function resmiPlanHtml(resmi, renk) {
  if (!resmi?.weeks?.length) return '';
  const sinav = /ara sınav|vize|midterm/i;
  const sinavHaftasi = resmi.weeks.find((w) => sinav.test(w.konu));
  const satir = (w) => {
    const isSinav = sinav.test(w.konu);
    return `<li${isSinav ? ' style="font-weight:650"' : ''}>
      <span class="tiny muted">${w.n}.</span> ${escHtml(w.konu)}${isSinav ? '' : ''}</li>`;
  };
  const a = resmi.assessment;
  return `<details class="card" style="--c:${renk}">
    <summary style="cursor:pointer;font-weight:650">Resmî ders planı</summary>
    <p class="tiny muted" style="margin:10px 0 8px">Bölümün ilan ettiği haftalık izlence.
      Uygulamadaki konu sırası öğretim kolaylığı için farklı olabilir; sınavda sorumlu
      olduğun kapsam budur.${sinavHaftasi ? ` Ara sınav ${sinavHaftasi.n}. haftada:
      öncesi vizenin, sonrası finalin kapsamı.` : ''}</p>
    <ol class="small muted" style="margin:0;padding-left:22px;list-style:none">${resmi.weeks.map(satir).join('')}</ol>
    ${a ? `<p class="tiny muted" style="margin:10px 0 0">Değerlendirme: vize %${a.vize} · yarıyıl sonu %${a.final}</p>` : ''}
    ${resmi.amac ? `<p class="tiny muted" style="margin:10px 0 0"><b>Dersin amacı.</b> ${escHtml(resmi.amac)}</p>` : ''}
  </details>`;
}

export default async function courseView([code]) {
  const meta = await getCourseMeta(code);
  const course = await getCourse(code);
  const resmi = await getOfficial(code);

  if (!course) {
    return {
      title: meta.name,
      sub: code,
      html: empty('soon', 'İçerik henüz hazır değil',
        `${meta.name} dersi için konu anlatımı ve sorular eklenmemiş. docs/CONTENT_SCHEMA.md dosyasına göre data/courses/${code}.json ekleyebilirsin.`,
        '<a class="btn" href="#/dersler">Derslere dön</a>'),
    };
  }

  const pr = store.courseProgress(code, course.topics.length);
  const cards = collectCards(course);
  const due = dueCount(cards, store.state.srs);
  const qCount = collectQuestions(course).length;
  const week = currentWeek(store.settings);
  const thisWeek = week && week.n >= 1 && week.n <= course.topics.length ? week.n : null;

  const items = course.topics.map((t) => {
    const p = store.topicProgress(code, t.id);
    const isNow = t.week === thisWeek;
    return `<a class="week-item${p.read ? ' done' : ''}" href="#/konu/${code}/${t.id}" style="--c:${meta.color}">
      <span class="week-num">${p.read ? ico('check') : t.week}</span>
      <span class="wi-body">
        <b>${escHtml(t.title)}${isNow ? ' <span class="chip on" style="--c:' + meta.color + '">bu hafta</span>' : ''}</b>
        <small>${escHtml(t.summary || '')}</small>
      </span>
      ${p.attempts ? `<span class="wi-score" style="color:${p.bestScore >= 70 ? 'var(--ok)' : p.bestScore >= 50 ? 'var(--warn)' : 'var(--bad)'}">%${p.bestScore}</span>` : '<span class="tiny muted">—</span>'}
    </a>`;
  }).join('');

  return {
    title: meta.shortName,
    sub: `${code}${meta.instructor ? ' · ' + meta.instructor : ''}`,
    html: `
      <div class="stack">
        <div class="card" style="--c:${meta.color}">
          <div class="row">
            <span class="cc-ico" style="width:44px;height:44px;font-size:22px;background:color-mix(in srgb, ${meta.color} 18%, transparent);border-radius:12px;display:grid;place-content:center">${ico(meta.icon)}</span>
            <span class="grow"><h1 style="font-size:19px;margin:0">${escHtml(course.name)}</h1>
            <span class="tiny muted">${escHtml(code)}${course.credits ? ` · ${course.credits.kredi} kredi · ${aktsOf(code, course)} AKTS` : ''}</span></span>
          </div>
          <div style="margin-top:13px">${progressBar(pr.pct, meta.color)}</div>
          <div class="row spread tiny muted" style="margin-top:6px">
            <span>${pr.read}/${course.topics.length} konu okundu</span>
            <span>%${pr.pct} tamamlandı</span>
          </div>
          ${course.description ? `<p class="small muted" style="margin:12px 0 0">${escHtml(course.description)}</p>` : ''}
        </div>

        <div class="btn-row">
          <a class="btn primary grow" href="#/quiz/${code}">${ico('target')} Karışık soru çöz</a>
          <a class="btn" href="#/kartlar/${code}">${ico('layers')} Kartlar${due.total ? ` (${due.total})` : ''}</a>
        </div>
        <div class="btn-row">
          <a class="btn grow" href="#/sinav/${code}/vize">${ico('exam')} Vize denemesi</a>
          <a class="btn grow" href="#/sinav/${code}/final">${ico('exam')} Final denemesi</a>
        </div>

        <div class="row wrap" style="gap:6px">
          <span class="chip">${course.topics.length} konu</span>
          <span class="chip">${qCount} soru</span>
          <span class="chip">${cards.length} kart</span>
          ${pr.quizzed ? `<span class="chip ${pr.avgScore >= 70 ? 'ok' : 'bad'}">ortalama %${pr.avgScore}</span>` : ''}
        </div>

        ${course.outcomes?.length ? `<details class="card"><summary style="cursor:pointer;font-weight:650">Öğrenme çıktıları</summary>
          <ul class="small muted" style="margin:10px 0 0;padding-left:20px">${course.outcomes.map((o) => `<li>${escHtml(o)}</li>`).join('')}</ul>
        </details>` : ''}

        ${course.resources?.length || resmi?.resources?.length ? `<details class="card"><summary style="cursor:pointer;font-weight:650">Kaynaklar</summary>
          ${resmi?.resources?.length ? `<p class="tiny muted" style="margin:10px 0 4px"><b>Dersin ilan edilen kaynağı</b></p>
            <ul class="small muted" style="margin:0;padding-left:20px">${resmi.resources.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>` : ''}
          ${course.resources?.length ? `<p class="tiny muted" style="margin:12px 0 4px"><b>Ek okuma</b></p>
            <ul class="small muted" style="margin:0;padding-left:20px">${course.resources.map((r) => `<li><b>${escHtml(r.title)}</b>${r.note ? ' — ' + escHtml(r.note) : ''}</li>`).join('')}</ul>` : ''}
        </details>` : ''}

        ${resmiPlanHtml(resmi, meta.color)}

        <div>
          <div class="sec-title"><h2>Konular</h2><span class="tiny muted">14 hafta</span></div>
          <div class="week-list">${items}</div>
        </div>
      </div>`,
  };
}
