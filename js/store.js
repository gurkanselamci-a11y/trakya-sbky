// store.js — tüm kalıcı durum. localStorage üzerinde tek JSON blob.
// Şema sürümü değişirse migrate() içinde taşı.

const KEY = 'tusbky.v1';
const SCHEMA = 1;

const emptyState = () => ({
  schema: SCHEMA,
  settings: {
    theme: 'auto',          // auto | dark | light
    dailyGoal: 30,          // dakika
    newCardsPerDay: 20,
    quizLength: 10,
    // Ana sayfadaki selamlama. Hesap sistemiyle birlikte her kullanıcının kendi adı:
    // hesap açarken yazılan ya da Google hesabındaki ad. Ayarlar'dan değiştirilebilir.
    name: '',
    semesterStart: '2026-09-21', // güz dönemi ilk ders haftası — Ayarlar'dan değiştirilebilir
    activeSemester: 1,
    // Konu anlatımının okuma ayarları. null = "temanın değerini kullan" (css/app.css).
    // Sayı yazılırsa tema değerinin üzerine geçer; uzun oturumda göz yorulduğunda
    // Ayarlar'dan büyütülür. Somut sayı yerine null tutmamızın sebebi: tema
    // değiştiğinde ayara hiç dokunmamış kullanıcı yeni temanın puntosunu almalı.
    readingSize: null,      // px
    readingLine: null,      // satır aralığı (birimsiz)
    // Konu, quiz, kart ve sınav ekranlarında ekranın kararmasını/ekran koruyucuya
    // geçmesini engeller (Screen Wake Lock). Sınav sayacı ekran kapanınca donmasın diye.
    keepAwake: true,
    // Önceki dönemlerden devir: dersleri tek tek girmek istemeyen için
    // transkriptin özeti (GANO + o GANO'nun kapsadığı toplam AKTS).
    priorGpa: null,
    priorAkts: 0,
  },
  // progress[code][topicId] = { read, readAt, bestScore, attempts, lastAt }
  progress: {},
  // srs[cardId] = { ef, interval, reps, lapses, due, lastAt }
  srs: {},
  // answers = son 2000 cevap kaydı (istatistik için)
  answers: [],
  // sessions[YYYY-MM-DD] = { minutes, questions, correct }
  sessions: {},
  // bookmarks = ["KAM101/w3", ...]
  bookmarks: [],
  // notes[code/topicId] = "kişisel not"
  notes: {},
  // examHistory = [{ at, code, scope, score, total, durationSec }]
  examHistory: [],
  // enrollment[code] = { at, slots: [{ day, start, end, room, kind }] }
  // "Bu dönem aldığım dersler" — yarıyıl karışık olabilir; ders programı buradan kurulur.
  enrollment: {},
  // grades[code] = { items: [{ id, name, weight, score, replaces? }], letter, manual }
  grades: {},
  // akts[KOD] = sayı — kullanıcının kendi AKTS düzeltmeleri. Müfredattaki değer yanlışsa
  // herkes kendi hesabı için düzeltebilir; yöneticinin herkes için yaptığı düzeltmenin
  // (Firestore config/akts) önüne geçer. Diğer veriler gibi cihazlar arası eşitlenir.
  akts: {},
  // transcript = [{ id, code, name, akts, letter, term }] — önceki dönemlerden gelen dersler
  transcript: [],
  streak: { current: 0, best: 0, lastDay: null },
});

/** Varsayılan ayarlar — "varsayılana dön" düğmeleri buradan okur. */
export const DEFAULT_SETTINGS = Object.freeze(emptyState().settings);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    console.warn('Kayıtlı veri okunamadı, sıfırdan başlanıyor.', err);
    return emptyState();
  }
}

function migrate(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  // Eksik alanları tamamla (ileri sürümlerde alan eklendiğinde kırılmasın)
  const merged = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  // "Kamu Yönetimi Defteri" temasının okuma değerleri kayıtlara somut sayı olarak
  // yazılmıştı; kullanıcı kaydırıcıya dokunmadıysa bunlar tercih değil, eski
  // varsayılandır. Temizleyip temaya bırakıyoruz.
  if (merged.settings.readingSize === 18.5) merged.settings.readingSize = null;
  if (merged.settings.readingLine === 1.72) merged.settings.readingLine = null;
  merged.schema = SCHEMA;
  return merged;
}

let state = load();
let saveTimer = null;
const listeners = new Set();

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Kota dolduysa en eski cevap kayıtlarını at ve tekrar dene
    console.warn('Kayıt başarısız, geçmiş kırpılıyor.', err);
    state.answers = state.answers.slice(-500);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
}

// Yazma 120 ms geciktirilir: art arda gelen değişiklikler (kart, cevap, sayaç) tek yazmada
// birleşsin. AMA sayfa gizlendiğinde ya da kapanırken bekleyen zamanlayıcı hiç çalışmayabilir
// — telefonda uygulama arka plana atılınca zamanlayıcılar dondurulur, sayfa kapanınca hiç
// tetiklenmez. Eskiden tam o anda yapılan değişiklik kayboluyordu; en sistematik örneği,
// sekme gizlenirken app.js'in eklediği oturum sonu çalışma dakikalarıydı. Bu yüzden:
//   1. Sayfa zaten gizliyse beklemeden yaz.
//   2. Gizlenme/kapanma anında bekleyen yazmayı boşalt.
function persist() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { writeNow(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 120);
}

if (typeof window !== 'undefined') {
  const flush = () => { if (saveTimer) writeNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  update(mutator) {
    mutator(state);
    persist();
    listeners.forEach((fn) => fn(state));
  },

  replaceAll(next) {
    state = migrate(next);
    persist();
    listeners.forEach((fn) => fn(state));
  },

  reset() { this.replaceAll(emptyState()); },

  export() { return JSON.stringify(state, null, 2); },

  // ---- kısayollar ----

  topicProgress(code, topicId) {
    return state.progress[code]?.[topicId] || { read: false, bestScore: 0, attempts: 0 };
  },

  setTopicProgress(code, topicId, patch) {
    this.update((s) => {
      s.progress[code] ||= {};
      s.progress[code][topicId] = { ...(s.progress[code][topicId] || {}), ...patch, lastAt: Date.now() };
    });
  },

  courseProgress(code, topicCount) {
    const p = state.progress[code] || {};
    const topics = Object.values(p);
    if (!topicCount) return { read: 0, pct: 0, avgScore: 0, quizzed: 0 };
    const read = topics.filter((t) => t.read).length;
    const quizzed = topics.filter((t) => (t.attempts || 0) > 0);
    const avgScore = quizzed.length
      ? Math.round(quizzed.reduce((a, t) => a + (t.bestScore || 0), 0) / quizzed.length)
      : 0;
    // İlerleme = okuma %50 + quiz başarısı %50
    const readPart = read / topicCount;
    const quizPart = quizzed.reduce((a, t) => a + (t.bestScore || 0) / 100, 0) / topicCount;
    return { read, quizzed: quizzed.length, avgScore, pct: Math.round((readPart * 0.5 + quizPart * 0.5) * 100) };
  },

  isBookmarked(key) { return state.bookmarks.includes(key); },

  toggleBookmark(key) {
    this.update((s) => {
      const i = s.bookmarks.indexOf(key);
      if (i >= 0) s.bookmarks.splice(i, 1); else s.bookmarks.push(key);
    });
    return this.isBookmarked(key);
  },

  getNote(key) { return state.notes[key] || ''; },
  setNote(key, text) {
    this.update((s) => {
      if (text.trim()) s.notes[key] = text; else delete s.notes[key];
    });
  },

  logAnswer(rec) {
    this.update((s) => {
      s.answers.push({ ...rec, at: Date.now() });
      if (s.answers.length > 2000) s.answers = s.answers.slice(-2000);
      const day = todayKey();
      s.sessions[day] ||= { minutes: 0, questions: 0, correct: 0 };
      s.sessions[day].questions += 1;
      if (rec.correct) s.sessions[day].correct += 1;
    });
    this.touchStreak();
  },

  addMinutes(min) {
    this.update((s) => {
      const day = todayKey();
      s.sessions[day] ||= { minutes: 0, questions: 0, correct: 0 };
      s.sessions[day].minutes += min;
    });
    this.touchStreak();
  },

  touchStreak() {
    const day = todayKey();
    if (state.streak.lastDay === day) return;
    this.update((s) => {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yesterday = dayKey(y);
      s.streak.current = s.streak.lastDay === yesterday ? s.streak.current + 1 : 1;
      s.streak.best = Math.max(s.streak.best, s.streak.current);
      s.streak.lastDay = day;
    });
  },

  todayStats() {
    const d = state.sessions[todayKey()] || { minutes: 0, questions: 0, correct: 0 };
    return d;
  },
};

export function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayKey() { return dayKey(new Date()); }
