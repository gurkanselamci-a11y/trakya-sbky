// views/home.js — ana sayfa: bugünün dersleri, hedef, devam et, hızlı erişim.

import { store } from '../store.js';
import { getCurriculum, getSemesterCourses, getReadyCoursesLite, getAllCardIds } from '../data.js';
import { dueCount } from '../srs.js';
import { pendingMistakeIds } from './mistakes.js';
import { escHtml, progressBar, fmtMin, DAYS, empty } from '../ui.js';
import { myCourses, weekSlots, toMin, totalAkts } from '../plan.js';
import { computeCourse, coefOf, weightedGpa, fmtGpa } from '../grades.js';
import { ico } from '../icons.js';
import { cloudConfigured } from '../cloud.js';
import { getUser, isAuthKnown } from '../sync.js';

export function currentWeek(settings) {
  if (!settings.semesterStart) return null;
  const start = new Date(settings.semesterStart + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return null;
  const diff = Math.floor((Date.now() - start.getTime()) / 604800000) + 1;
  if (diff < 1) return { n: 0, label: 'Dönem henüz başlamadı', daysTo: Math.ceil((start - Date.now()) / 86400000) };
  if (diff > 16) return { n: 16, label: 'Dönem sonu' };
  return { n: diff, label: `${diff}. hafta` };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export default async function homeView() {
  const cur = await getCurriculum();
  const s = store.state;
  const sem = s.settings.activeSemester || cur.activeSemester;
  const courses = await getSemesterCourses(sem);
  const ready = await getReadyCoursesLite();
  const due = dueCount(await getAllCardIds(), s.srs);
  const today = store.todayStats();
  const goal = s.settings.dailyGoal || 30;
  const goalPct = Math.min(100, Math.round((today.minutes / goal) * 100));
  const week = currentWeek(s.settings);
  const mistakeCount = pendingMistakeIds(s.answers).length;

  // Bugünün dersleri — kullanıcının seçtiği derslerden (yoksa müfredatın örnek programından)
  const dow = new Date().getDay();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const plan = weekSlots(cur);
  const todays = plan.slots.filter((x) => x.day === dow);

  const slotHtml = todays.map((x) => {
    const isNow = nowMin >= toMin(x.start) && nowMin < toMin(x.end);
    const past = nowMin >= toMin(x.end);
    return `<a class="slot${isNow ? ' now' : ''}" href="#/ders/${x.code}" style="--c:${x.color || 'var(--acc)'};${past ? 'opacity:.5' : ''}">
      <span class="time">${escHtml(x.start)}</span>
      <span class="sl-body grow"><b>${escHtml(x.shortName || x.code)}</b>
      <small>${escHtml(x.room || '')}${x.kind ? ' · ' + escHtml(x.kind) : ''}${isNow ? ' · şu an' : ''}</small></span>
      <span class="chip">${ico(x.icon || 'book')}</span></a>`;
  }).join('');

  // Not özeti — geçmiş dersler + bu dönem girilen notlar
  const mine = myCourses(cur);
  const gradeParts = [
    ...(Number(s.settings.priorGpa) > 0 && Number(s.settings.priorAkts) > 0
      ? [{ akts: Number(s.settings.priorAkts), coef: Number(s.settings.priorGpa) }] : []),
    ...(s.transcript || []).map((r) => ({ akts: r.akts, coef: coefOf(r.letter) })),
  ];
  const termParts = mine.map((c) => {
    const g = s.grades?.[c.code];
    const letter = g?.manual && g.letter ? g.letter : (g ? computeCourse(g.items).letter : null);
    return { akts: c.akts, coef: coefOf(letter) };
  });
  const gano = weightedGpa(gradeParts);
  const dno = weightedGpa(termParts);

  // En son çalışılan konu
  let lastStudy = null;
  for (const [code, topics] of Object.entries(s.progress)) {
    for (const [tid, p] of Object.entries(topics)) {
      if (p.lastAt && (!lastStudy || p.lastAt > lastStudy.at)) lastStudy = { code, tid, at: p.lastAt, read: p.read };
    }
  }
  let continueHtml = '';
  if (lastStudy) {
    const c = ready.find((x) => x.code === lastStudy.code);
    const t = c?.topics.find((x) => x.id === lastStudy.tid);
    if (c && t) {
      continueHtml = `<a class="card" href="#/konu/${c.code}/${t.id}" style="--c:${c.color};display:block">
        <div class="row spread"><span class="chip on">Kaldığın yer</span><span class="tiny muted">${t.week}. hafta</span></div>
        <b style="display:block;margin-top:8px;font-size:16px">${escHtml(t.title)}</b>
        <small class="muted">${escHtml(c.name)}</small>
      </a>`;
    }
  }

  // Kartlar: ders seçtiyse kendi dersleri, seçmediyse aktif yarıyılın dersleri.
  const shown = mine.length
    ? mine.map((c) => {
        const lite = ready.find((r) => r.code === c.code);
        return { ...c, hasContent: !!lite, topicCount: lite?.topicCount || 0 };
      })
    : courses;

  const progressCards = shown.filter((c) => c.hasContent).map((c) => {
    const pr = store.courseProgress(c.code, c.topicCount);
    return `<a class="course-card" href="#/ders/${c.code}" style="--c:${c.color}">
      <div class="cc-top"><span class="cc-ico">${ico(c.icon)}</span>
        <span class="grow"><h3>${escHtml(c.shortName)}</h3>
        <span class="cc-meta">${escHtml(c.instructor || c.code)}</span></span></div>
      ${progressBar(pr.pct, c.color)}
      <div class="cc-foot"><span>${pr.read}/${c.topicCount} konu</span><span>%${pr.pct}</span></div>
    </a>`;
  }).join('');

  const soonCount = shown.filter((c) => !c.hasContent).length;

  return {
    title: 'Ana Sayfa',
    sub: week ? `${cur.academicYear} · ${week.label}` : cur.academicYear,
    html: `
      <div class="stack">
        <div class="card" style="--c:var(--acc)">
          <div class="row spread">
            <div>
              <h1 style="margin:0">${greeting()}${s.settings.name ? ', ' + escHtml(s.settings.name) : ''}</h1>
              <p class="small muted" style="margin:2px 0 0">
                ${today.minutes >= goal
                  ? `Günlük hedefi tamamladın — ${fmtMin(today.minutes)} çalıştın.`
                  : `Bugün ${fmtMin(today.minutes)} çalıştın. Hedefe ${fmtMin(goal - today.minutes)} kaldı.`}
              </p>
            </div>
          </div>
          <div style="margin-top:12px">${progressBar(goalPct)}</div>
          <div class="row spread tiny muted" style="margin-top:6px">
            <span>${today.questions} soru · %${today.questions ? Math.round((today.correct / today.questions) * 100) : 0} doğru</span>
            <span>${ico('flame')} ${s.streak.current} gün</span>
          </div>
        </div>

        ${cloudConfigured() && isAuthKnown() && !getUser() ? `<a class="card" href="#/hesap" style="--c:var(--acc);display:block">
          <div class="row">${ico('user', 'ico-md')}
          <span class="grow"><b>Giriş yap</b>
          <small class="muted" style="display:block">İlerlemen hesabına kaydedilsin; telefondan da bilgisayardan da aynı yerden devam et</small></span>
          <span class="btn primary">Giriş</span></div></a>` : ''}

        ${due.total > 0 ? `<a class="card" href="#/kartlar" style="--c:var(--acc-2);display:block">
          <div class="row">${ico('layers', 'ico-md')}
          <span class="grow"><b>${due.total} kart seni bekliyor</b>
          <small class="muted" style="display:block">${due.due} tekrar · ${due.fresh} yeni</small></span>
          <span class="btn primary">Başla</span></div></a>` : ''}

        ${mistakeCount ? `<a class="card" href="#/yanlislarim" style="--c:var(--bad);display:block">
          <div class="row">${ico('target', 'ico-md')}
          <span class="grow"><b>${mistakeCount} yanlışın bekliyor</b>
          <small class="muted" style="display:block">Doğru çözene kadar listede kalır</small></span>
          <span class="btn">Çöz</span></div></a>` : ''}

        ${continueHtml}

        ${(gano.counted || dno.counted || mine.length) ? `<a class="card" href="#/notlar" style="--c:var(--acc-2);display:block">
          <div class="row">${ico('cap', 'ico-md')}
          <span class="grow"><b>GANO ${fmtGpa(gano.gpa)}${dno.counted ? ` · bu dönem ${fmtGpa(dno.gpa)}` : ''}</b>
          <small class="muted" style="display:block">${mine.length ? `${mine.length} ders · ${totalAkts(cur)} AKTS` : 'Notlarını gir'}</small></span>
          <span class="btn">Notlar</span></div></a>` : ''}

        <div>
          <div class="sec-title"><h2>Bugün · ${DAYS[dow]}</h2>
            <a href="#/program">Tüm program</a></div>
          ${todays.length ? slotHtml : `<div class="card center muted small">Bugün dersin yok. İyi çalışmalar</div>`}
          ${plan.official ? `<p class="tiny muted center" style="margin:8px 0 0">Bu, bölümün örnek programı —
            <a href="#/derslerim" style="color:var(--acc);font-weight:600">kendi derslerini seç</a>.</p>` : ''}
        </div>

        <div>
          <div class="sec-title"><h2>Derslerin</h2><a href="${mine.length ? '#/derslerim' : '#/dersler'}">${mine.length ? 'Düzenle' : 'Tümü'}</a></div>
          ${progressCards ? `<div class="course-grid">${progressCards}</div>`
            : empty('book', 'İçerik hazırlanıyor', 'Ders içerikleri henüz yüklenmemiş.')}
          ${soonCount ? `<p class="tiny muted center" style="margin-top:10px">+${soonCount} ders içerik bekliyor</p>` : ''}
        </div>

        <div>
          <div class="sec-title"><h2>Hızlı başla</h2></div>
          <div class="btn-row">
            <a class="btn" href="#/kartlar">${ico('layers')} Kart tekrarı</a>
            <a class="btn" href="#/sinav">${ico('exam')} Deneme sınavı</a>
            <a class="btn" href="#/program">${ico('calendar')} Ders programı</a>
            <a class="btn" href="#/istatistik">${ico('chart')} İlerlemem</a>
            <a class="btn" href="#/notlar">${ico('cap')} Notlar & ortalama</a>
            <a class="btn" href="#/derslerim">${ico('list')} Derslerim</a>
            <a class="btn" href="#/notlarim">${ico('note')} Notlarım</a>
          </div>
        </div>
      </div>`,
  };
}
