// views/search.js — tüm derslerde konu, soru ve kart araması (Türkçe karakter duyarsız).
//
// İKİ KATMANLI ARAMA. Eskiden tek katman vardı ve ilk aramada 141 ders dosyasının tamamı
// iniyordu: 54 MB ve masaüstünde 6 saniye — telefonda hem mobil veriyi yakan hem de
// sekmeyi dondurma riski taşıyan bir maliyet. Şimdi:
//   1. Hızlı katman: `data/search.json` (tools/build-search.mjs üretir). Başlıklar tam,
//      gövdeler ilk 120 karaktere kırpılmış. Tek istek, ~11 MB yerine tek dosya.
//   2. Derin katman: kullanıcı açıkça isterse ders dosyaları yüklenir ve notların tamamında
//      aranır. Çevrimdışı destek için service worker bu dosyaları zaten önbelleğe aldığından
//      çoğu zaman ağdan bir şey inmez.

import { getIndex, getReadyCourses, normalize } from '../data.js';
import { mdPhrase } from '../md.js';
import { escHtml, empty } from '../ui.js';
import { ico } from '../icons.js';

let fastCache = null;
let deepCache = null;
let deepWanted = false;

const KINDS = ['konu', 'kart', 'soru'];

function finish(items) {
  items.forEach((it) => { it.hay = ' ' + normalize(it.title + ' ' + it.body) + ' '; });
  return items;
}

/** Hızlı katman: derlenmiş arama dizini + ders/konu üstverisi. */
async function buildFastIndex() {
  if (fastCache) return fastCache;
  const [idx, res] = await Promise.all([
    getIndex(),
    fetch('data/search.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!res || !Array.isArray(res.rows)) return (fastCache = []);

  const items = [];
  for (const [kind, code, ti, title, body] of res.rows) {
    const c = idx.courses[code];
    if (!c) continue;                       // dizinde yoksa (yarım ders) atla
    const t = (c.topics || [])[ti];
    if (!t) continue;
    items.push({
      kind: KINDS[kind] || 'konu',
      code, color: c.color, icon: c.icon, courseName: c.shortName || c.name,
      week: t.week, topicId: t.id,
      title, body: body || '',
      href: kind === 1 ? `#/kartlar/${code}` : kind === 2 ? `#/quiz/${code}/${t.id}` : `#/konu/${code}/${t.id}`,
    });
  }
  fastCache = finish(items);
  return fastCache;
}

/** Derin katman: ders dosyalarının tamamı — notların içinde de arar. */
async function buildDeepIndex() {
  if (deepCache) return deepCache;
  const courses = await getReadyCourses();
  const items = [];

  for (const c of courses) {
    for (const t of c.course.topics) {
      items.push({
        kind: 'konu',
        code: c.code, color: c.color, icon: c.icon, courseName: c.shortName,
        week: t.week, topicId: t.id,
        title: t.title,
        body: [t.summary, ...(t.keyPoints || []), ...(t.pitfalls || []), t.notes].filter(Boolean).join(' \n '),
        href: `#/konu/${c.code}/${t.id}`,
      });

      (t.flashcards || []).forEach((f) => items.push({
        kind: 'kart',
        code: c.code, color: c.color, icon: c.icon, courseName: c.shortName,
        week: t.week, topicId: t.id,
        title: f.q,
        body: f.a,
        href: `#/kartlar/${c.code}`,
      }));

      (t.questions || []).forEach((q) => items.push({
        kind: 'soru',
        code: c.code, color: c.color, icon: c.icon, courseName: c.shortName,
        week: t.week, topicId: t.id,
        title: q.q,
        body: [(q.choices || []).join(' '), q.explain].filter(Boolean).join(' '),
        answer: q,
        href: `#/quiz/${c.code}/${t.id}`,
      }));
    }
  }
  deepCache = finish(items);
  return deepCache;
}

const activeIndex = () => (deepWanted ? buildDeepIndex() : buildFastIndex());
const isIndexReady = () => !!(deepWanted ? deepCache : fastCache);

export function invalidateSearchIndex() { fastCache = null; deepCache = null; }

/** Kisa terimlerde tam kelime ara — "to" kelimesi "otomatik" icinde eslesmesin. */
function has(hay, t) {
  return t.length >= 4 ? hay.includes(t) : hay.includes(' ' + t + ' ');
}

function score(item, terms) {
  const titleNorm = ' ' + normalize(item.title) + ' ';
  let s = 0;
  for (const t of terms) {
    if (!has(item.hay, t)) return 0;          // her terim geçmeli
    if (has(titleNorm, t)) s += 10;
    s += 1;
  }
  if (item.kind === 'konu') s += 3;           // konular biraz öne çıksın
  return s;
}

/** Eşleşmenin geçtiği yerden kısa bir alıntı çıkarır ve terimi işaretler. */
function snippet(item, terms) {
  const plain = item.body.replace(/```[\s\S]*?```/g, ' [kod] ').replace(/[#*>`|]/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = normalize(plain);
  let at = -1;
  for (const t of terms) { const i = norm.indexOf(t.length >= 4 ? t : ' ' + t + ' '); if (i >= 0) { at = i; break; } }
  if (at < 0) return escHtml(plain.slice(0, 140)) + (plain.length > 140 ? '…' : '');
  const start = Math.max(0, at - 60);
  const cut = plain.slice(start, start + 170);
  return (start ? '…' : '') + escHtml(cut) + (start + 170 < plain.length ? '…' : '');
}

export default async function searchView([raw]) {
  const initial = raw ? decodeURIComponent(raw) : '';

  return {
    title: 'Ara',
    sub: 'Konu, soru ve kartlarda',
    html: `<div class="stack">
      <input class="ans-input" id="q" type="search" placeholder="Ne arıyorsun? (ör. türev, pointer, Sakarya)"
        value="${escHtml(initial)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="seg" id="kindSeg">
        <button data-kind="" class="on">Tümü</button>
        <button data-kind="konu">Konular</button>
        <button data-kind="soru">Sorular</button>
        <button data-kind="kart">Kartlar</button>
      </div>
      <div id="results"></div>
    </div>`,

    onMount(root) {
      const input = root.querySelector('#q');
      const results = root.querySelector('#results');
      let kind = '';
      let timer = null;
      let runId = 0;

      async function run() {
        const my = ++runId;
        const query = input.value.trim();
        if (query.length < 2) {
          results.innerHTML = empty('search', 'Aramaya başla',
            'En az 2 harf yaz. Konu başlıkları, sorular ve kartlar anında aranır.');
          results.dataset.q = '';
          return;
        }

        if (!isIndexReady()) {
          results.innerHTML = `<div class="empty"><div class="e-ico">${ico('clock')}</div><b>Aranıyor…</b>
            <p class="small">${deepWanted ? 'Ders içerikleri yükleniyor.' : 'Arama dizini hazırlanıyor.'}</p></div>`;
          results.dataset.q = '';
        }

        const items = await activeIndex();
        if (my !== runId) return; // daha yeni bir arama başladı
        const terms = normalize(query).split(' ').filter(Boolean);
        const hits = items
          .map((it) => ({ it, s: score(it, terms) }))
          .filter((x) => x.s > 0 && (!kind || x.it.kind === kind))
          .sort((a, b) => b.s - a.s)
          .slice(0, 60);

        // Derin arama önerisi: notların tamamı yalnızca istenirse indirilir.
        const deepBar = deepWanted
          ? '<p class="tiny muted" style="margin-top:10px">Notların tamamında arandı.</p>'
          : `<p class="tiny muted" style="margin-top:10px">Başlıklarda ve metin başlarında arandı.
               <button class="btn" id="deepBtn" style="margin-left:6px">Notların tamamında ara</button></p>`;

        if (!hits.length) {
          results.innerHTML = empty('help', 'Sonuç yok', `"${query}" için bir şey bulunamadı. Farklı bir kelime dene.`) + deepBar;
          results.dataset.q = query;
          bindDeep();
          return;
        }

        const counts = { konu: 0, soru: 0, kart: 0 };
        let total = 0;
        items.forEach((it) => { if (score(it, terms) > 0) { counts[it.kind]++; total++; } });

        results.innerHTML = `
          <p class="tiny muted">${counts.konu} konu · ${counts.soru} soru · ${counts.kart} kart bulundu${total > hits.length ? ` — en uygun ${hits.length} tanesi gösteriliyor` : ''}</p>
          <div class="week-list" style="margin-top:8px">
            ${hits.map((h) => {
              const it = h.it;
              const badge = ico({ konu: 'book', soru: 'help', kart: 'layers' }[it.kind]);
              return `<a class="week-item" href="${it.href}" style="--c:${it.color}">
                <span class="week-num">${badge}</span>
                <span class="wi-body">
                  <b style="white-space:normal">${mdPhrase(String(it.title).slice(0, 160))}</b>
                  <small style="white-space:normal;display:block;margin-top:3px">${snippet(it, terms)}</small>
                  <span class="tiny muted" style="display:block;margin-top:4px">${ico(it.icon)} ${escHtml(it.courseName)} · ${it.week}. hafta</span>
                </span>
              </a>`;
            }).join('')}
          </div>${deepBar}`;
        // Hangi sorgunun sonuçları duruyor — testler eski sonuçları okumasın diye.
        results.dataset.q = query;
        bindDeep();
      }

      function bindDeep() {
        const btn = results.querySelector('#deepBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
          deepWanted = true;
          btn.disabled = true;
          btn.textContent = 'Yükleniyor…';
          run();
        });
      }

      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; run(); } });

      root.querySelector('#kindSeg').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kind]');
        if (!b) return;
        root.querySelectorAll('#kindSeg button').forEach((x) => x.classList.toggle('on', x === b));
        kind = b.dataset.kind;
        run();
      });

      // Kullanıcı yazarken dizin arkada hazırlansın — ilk arama beklemesin.
      activeIndex().then(() => { if (input.value.trim().length >= 2) run(); });

      run();
      setTimeout(() => { if (!initial) input.focus(); }, 120);
      return () => clearTimeout(timer);
    },
  };
}
