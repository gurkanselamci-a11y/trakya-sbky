// views/schedule.js — haftalık ders programı.
//
// Program artık kullanıcının seçtiği derslerden kurulur (bkz. plan.js): farklı
// yarıyıllardan ders alınabildiği için tek bir yarıyılın tablosu yetmiyor.
// Hiç ders seçilmemişse etkin yarıyılın resmî programı örnek olarak gösterilir.

import { getCurriculum } from '../data.js';
import { escHtml, DAYS } from '../ui.js';
import { store } from '../store.js';
import { currentWeek } from './home.js';
import { weekSlots, byDay, conflicts, weeklyHours, toMin, totalAkts, myCourses } from '../plan.js';
import { ico } from '../icons.js';

export default async function scheduleView() {
  const cur = await getCurriculum();
  const now = new Date();
  const dow = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const week = currentWeek(store.settings);

  const { official, semester, slots, missing } = weekSlots(cur);
  const grouped = byDay(slots);
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => grouped[d]?.length);
  const clash = conflicts(slots);
  const hours = weeklyHours(slots);
  const mine = myCourses(cur);

  const slotHtml = (slot) => {
    const isNow = slot.day === dow && nowMin >= toMin(slot.start) && nowMin < toMin(slot.end);
    const past = slot.day === dow && nowMin >= toMin(slot.end);
    return `<a class="slot${isNow ? ' now' : ''}" href="#/ders/${slot.code}"
        style="--c:${slot.color || 'var(--acc)'}${past ? ';opacity:.55' : ''}">
      <span class="time">${escHtml(slot.start)}<br><span class="muted" style="font-size:10px">${escHtml(slot.end)}</span></span>
      <span class="sl-body grow">
        <b>${ico(slot.icon || 'book')} ${escHtml(slot.name || slot.code)}</b>
        <small>${escHtml(slot.code)}${slot.room ? ' · ' + escHtml(slot.room) : ''}${slot.kind ? ' · ' + escHtml(slot.kind) : ''}${slot.instructor ? ' · ' + escHtml(slot.instructor) : ''}</small>
      </span>
      ${isNow ? '<span class="chip on">şu an</span>' : ''}
    </a>`;
  };

  return {
    title: 'Ders Programı',
    sub: official ? `${cur.academicYear} · örnek program` : `${mine.length} ders${week ? ' · ' + week.label : ''}`,
    html: `<div class="stack">
      ${official ? `<div class="card" style="--c:var(--acc)">
          <b>Bu, bölümün ${semester}. yarıyıl programı</b>
          <p class="small muted" style="margin:6px 0 0">Kendi programını görmek için bu dönem aldığın dersleri seç —
          hangi yarıyıldan olursa olsun. Resmî programda saati olan dersler hazır gelir.</p>
          <div class="btn-row" style="margin-top:10px">
            <a class="btn primary" href="#/derslerim">Derslerimi seç</a>
          </div>
        </div>`
      : `<div class="card">
          <div class="row spread">
            <div><b>${escHtml(cur.department)}</b>
            <div class="tiny muted">${mine.length} ders · ${totalAkts(cur)} AKTS · haftada ${hours ? hours.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : 0} saat</div></div>
            <a class="btn ghost small" href="#/derslerim">Düzenle</a>
          </div>
        </div>`}

      ${clash.length ? `<div class="callout c-warn">
        <div class="callout-h">Çakışma</div>
        ${clash.map(([a, b]) => `<p style="margin:4px 0">${DAYS[a.day]} ${escHtml(a.start)} — <b>${escHtml(a.shortName || a.code)}</b>
          ile <b>${escHtml(b.shortName || b.code)}</b> üst üste geliyor.</p>`).join('')}
      </div>` : ''}

      ${days.length ? days.map((d) => `<div class="day-block">
        <h3>${DAYS[d]}${d === dow ? ' · bugün' : ''}</h3>
        ${grouped[d].map(slotHtml).join('')}
      </div>`).join('')
      : `<div class="empty"><div class="e-ico">${ico('calendar')}</div><b>Programın boş</b>
          <p class="small">Seçtiğin derslerin saatini girersen burada görünür.</p>
          <a class="btn primary" href="#/derslerim">Ders saatlerini gir</a></div>`}

      ${missing.length ? `<div class="card">
        <b class="small">Saati girilmemiş dersler</b>
        <p class="tiny muted" style="margin:6px 0 8px">Bu dersler programda görünmüyor çünkü saatleri yok.</p>
        <div class="btn-row">${missing.map((c) => `<a class="chip" href="#/derslerim">${ico(c.icon)} ${escHtml(c.shortName)}</a>`).join('')}</div>
      </div>` : ''}

      <div class="card">
        <b class="small">Not</b>
        <p class="tiny muted" style="margin:6px 0 0">Bölüm haftalık ders programını Bologna paketinde
        yayımlamıyor, bu yüzden hazır saat gelmiyor — saatleri <a href="#/derslerim">Derslerim</a>
        ekranından kendin giriyorsun. Kesin program için
        <a href="https://kamuyonetimi.trakya.edu.tr" target="_blank" rel="noopener">kamuyonetimi.trakya.edu.tr</a>
        sayfasına ve OBS'ye bak.</p>
      </div>
    </div>`,
  };
}
