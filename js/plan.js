// plan.js — "derslerim": hangi dersleri aldığım ve haftalık saatlerim.
//
// Ders programı artık müfredatın sabit 1. yarıyıl tablosundan değil, kullanıcının
// seçtiği derslerden kurulur: farklı yarıyıllardan ders alınabildiği için tek bir
// yarıyılın programı gerçeği yansıtmıyor. Seçilen dersin resmî programda saati varsa
// ilk seçimde oradan doldurulur, yoksa kullanıcı kendi saatini girer.

import { store } from './store.js';
import { defaultItems } from './grades.js';
import { aktsOf } from './akts.js';

export const KINDS = ['Teori', 'Uygulama', 'Lab'];

export function enrolledCodes() {
  return Object.keys(store.state.enrollment || {});
}

export function isEnrolled(code) {
  return !!(store.state.enrollment || {})[code];
}

/** Müfredatın resmî programında bu dersin saatleri (varsa). */
export function officialSlots(cur, code) {
  return (cur.schedule || [])
    .filter((s) => s.code === code)
    .map((s) => ({ day: s.day, start: s.start, end: s.end, room: s.room || '', kind: s.kind || 'Teori' }));
}

export function enroll(code, cur) {
  if (isEnrolled(code)) return;
  const slots = officialSlots(cur, code);
  store.update((s) => {
    s.enrollment[code] = { at: Date.now(), slots };
  });
}

export function unenroll(code) {
  store.update((s) => {
    delete s.enrollment[code];
    // Not kaydı bilerek silinmez: ders yanlışlıkla listeden çıkarılırsa girilen
    // sınav notları kaybolmasın. Tamamen temizlemek Ayarlar'ın işi.
  });
}

export function toggleEnroll(code, cur) {
  if (isEnrolled(code)) unenroll(code); else enroll(code, cur);
  return isEnrolled(code);
}

const emptySlot = () => ({ day: 1, start: '09:00', end: '10:00', room: '', kind: 'Teori' });

export function addSlot(code) {
  store.update((s) => {
    const e = s.enrollment[code];
    if (!e) return;
    e.slots ||= [];
    const last = e.slots[e.slots.length - 1];
    e.slots.push(last ? { ...last, room: last.room } : emptySlot());
  });
}

export function patchSlot(code, i, patch) {
  store.update((s) => {
    const slot = s.enrollment[code]?.slots?.[i];
    if (slot) Object.assign(slot, patch);
  });
}

export function removeSlot(code, i) {
  store.update((s) => {
    s.enrollment[code]?.slots?.splice(i, 1);
  });
}

/** Seçilen dersin resmî saatlerini geri yükler. */
export function resetSlots(code, cur) {
  store.update((s) => {
    if (s.enrollment[code]) s.enrollment[code].slots = officialSlots(cur, code);
  });
}

/** Bir dersin künyesi — müfredat dizininden, eksik alanlar için güvenli varsayılanlarla. */
export function courseInfo(cur, code) {
  const m = cur.courseIndex?.[code] || {};
  const sem = (cur.semesters || []).find((s) => s.courses.includes(code));
  return {
    code,
    name: m.name || code,
    shortName: m.shortName || m.name || code,
    icon: m.icon || 'book',
    color: m.color || '#6366f1',
    instructor: m.instructor || '',
    akts: aktsOf(code, m),          // yönetici düzeltmesi varsa o (js/akts.js)
    kredi: Number(m.credits?.kredi) || 0,
    elective: !!m.elective,
    semester: sem ? sem.n : null,
    semesterLabel: sem ? `${sem.label} · ${sem.term}` : '',
  };
}

/** Seçili dersler — künye + saatler, yarıyıl ve ada göre sıralı. */
export function myCourses(cur) {
  const e = store.state.enrollment || {};
  return Object.keys(e)
    .map((code) => ({ ...courseInfo(cur, code), slots: e[code].slots || [], at: e[code].at }))
    .sort((a, b) => (a.semester || 99) - (b.semester || 99) || a.name.localeCompare(b.name, 'tr'));
}

export function totalAkts(cur) {
  return myCourses(cur).reduce((a, c) => a + c.akts, 0);
}

/**
 * Haftalık programın satırları. Kullanıcı hiç ders seçmediyse müfredatın resmî
 * 1. yarıyıl programı gösterilir (`official: true`) — uygulama ilk açıldığında
 * program ekranı boş kalmasın.
 */
export function weekSlots(cur) {
  const mine = myCourses(cur);
  if (!mine.length) {
    // Resmî programda birden çok yarıyılın saatleri var (1. yarıyıl + 2026-2027 Güz
    // 3. yarıyıl dersleri). Hepsini birden basmak farklı yarıyılları üst üste bindirip
    // sahte çakışmalar gösterir; örnek görünüm yalnızca etkin yarıyılı gösterir.
    const sem = Number(store.state.settings?.activeSemester) || cur.activeSemester || 1;
    const semCourses = new Set((cur.semesters || []).find((s) => s.n === sem)?.courses || []);
    return {
      official: true,
      semester: sem,
      slots: (cur.schedule || [])
        .filter((s) => semCourses.has(s.code))
        .map((s) => ({ ...s, ...courseInfo(cur, s.code) })),
      missing: [],
    };
  }
  const slots = [];
  const missing = [];
  for (const c of mine) {
    if (!c.slots.length) { missing.push(c); continue; }
    c.slots.forEach((s, i) => slots.push({ ...c, ...s, code: c.code, slotIndex: i }));
  }
  slots.sort((a, b) => a.day - b.day || String(a.start).localeCompare(String(b.start)));
  return { official: false, slots, missing };
}

export function byDay(slots) {
  const map = {};
  for (const s of slots) (map[s.day] ||= []).push(s);
  Object.values(map).forEach((l) => l.sort((a, b) => String(a.start).localeCompare(String(b.start))));
  return map;
}

/** "HH:MM" → dakika; bozuk değerde NaN döner. */
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Aynı gün çakışan saatler — programda uyarı olarak gösterilir. */
export function conflicts(slots) {
  const out = [];
  const days = byDay(slots);
  for (const list of Object.values(days)) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.code === b.code) continue;
        if (toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) out.push([a, b]);
      }
    }
  }
  return out;
}

/** Haftalık toplam ders saati (süreye göre; saat girilmemiş dersler sayılmaz). */
export function weeklyHours(slots) {
  return slots.reduce((a, s) => {
    const d = toMin(s.end) - toMin(s.start);
    return a + (Number.isFinite(d) && d > 0 ? d / 60 : 0);
  }, 0);
}

// ---------- sınav notları ve geçmiş dersler ----------

/** Dersin not kaydı — yoksa varsayılan kalemlerle (vize/final/büt) oluşturulur. */
export function gradeOf(code) {
  const g = store.state.grades?.[code];
  if (g && Array.isArray(g.items)) return g;
  return { items: defaultItems(), letter: null, manual: false };
}

function withGrade(code, fn) {
  store.update((s) => {
    s.grades[code] ||= { items: defaultItems(), letter: null, manual: false };
    if (!Array.isArray(s.grades[code].items)) s.grades[code].items = defaultItems();
    fn(s.grades[code]);
  });
}

/** Kalem notu. Boş metin ya da geçersiz sayı "girilmedi" demektir. */
export function setItemScore(code, id, value) {
  const raw = String(value ?? '').replace(',', '.').trim();
  const n = raw === '' ? null : Number(raw);
  const score = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  withGrade(code, (g) => {
    const item = g.items.find((i) => i.id === id);
    if (item) item.score = score;
  });
}

export function setItemWeight(code, id, value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  withGrade(code, (g) => {
    const item = g.items.find((i) => i.id === id);
    if (item && Number.isFinite(n)) item.weight = Math.max(0, Math.min(100, n));
  });
}

export function addItem(code, name = 'Yeni kalem', weight = 10) {
  const id = 'k' + Date.now().toString(36);
  withGrade(code, (g) => {
    // Bütünleme her zaman en altta dursun.
    const at = g.items.findIndex((i) => i.replaces);
    const item = { id, name, weight, score: null };
    if (at >= 0) g.items.splice(at, 0, item); else g.items.push(item);
  });
  return id;
}

export function renameItem(code, id, name) {
  withGrade(code, (g) => {
    const item = g.items.find((i) => i.id === id);
    if (item) item.name = String(name || '').slice(0, 40) || 'Kalem';
  });
}

export function removeItem(code, id) {
  withGrade(code, (g) => { g.items = g.items.filter((i) => i.id !== id); });
}

/** Harfi elle sabitler; null verilirse yeniden puandan hesaplanır. */
export function setLetter(code, letter) {
  withGrade(code, (g) => {
    g.letter = letter || null;
    g.manual = !!letter;
  });
}

export function resetGrade(code) {
  store.update((s) => { delete s.grades[code]; });
}

// ---- geçmiş dersler (transkript) ----

export function transcript() {
  return store.state.transcript || [];
}

export function addPast(row) {
  const entry = {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    code: row.code || '',
    name: row.name || row.code || 'Ders',
    akts: Number(row.akts) || 0,
    letter: row.letter || 'AA',
    term: row.term || '',
  };
  store.update((s) => { s.transcript.push(entry); });
  return entry.id;
}

export function patchPast(id, patch) {
  store.update((s) => {
    const row = s.transcript.find((r) => r.id === id);
    if (!row) return;
    if ('akts' in patch) {
      const n = Number(String(patch.akts).replace(',', '.'));
      patch.akts = Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : 0;
    }
    Object.assign(row, patch);
  });
}

export function removePast(id) {
  store.update((s) => { s.transcript = s.transcript.filter((r) => r.id !== id); });
}
