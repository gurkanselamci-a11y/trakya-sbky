// data.js — müfredat ve ders içeriklerinin yüklenmesi + türetilmiş sorgular.

let curriculumPromise = null;
let indexPromise = null;
const courseCache = new Map();
const missing = new Set();

export async function getCurriculum() {
  if (!curriculumPromise) {
    curriculumPromise = fetch('data/curriculum.json')
      .then((r) => { if (!r.ok) throw new Error('Müfredat yüklenemedi'); return r.json(); });
  }
  return curriculumPromise;
}

/**
 * Resmî ders bilgileri (data/official.json): üniversitenin ilan ettiği haftalık konu planı,
 * dersin amacı, öğrenme çıktıları, kaynak kitapları ve sınav ağırlıkları.
 *
 * Bu, uygulamadaki anlatımdan AYRI tutulur: anlatımı ve soruları biz yazdık, buradaki
 * alanlar ise OBS'teki ders bilgi formundan gelir. Öğrenci ders sayfasında ikisini de
 * görür ve sınavın hangi haftaları kapsadığını bilir. `node tools/build-official.mjs`
 * ile üretilir. Dosya yoksa uygulama eskisi gibi çalışır, resmî bölüm gizlenir.
 */
let officialPromise = null;
export async function getOfficial(code) {
  if (!officialPromise) {
    officialPromise = fetch('data/official.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  const all = await officialPromise;
  return code ? (all[code] || null) : all;
}

/**
 * Hafif içerik dizini (data/index.json): ders başlıkları ve konu listesi (her konunun
 * soru/kart sayısıyla). Ana sayfa / istatistik / kart rozeti bunu kullanır; böylece kabuk
 * 20 MB'lık ders dosyalarını beklemez. `node tools/build-index.mjs` ile üretilir.
 */
export async function getIndex() {
  if (!indexPromise) {
    indexPromise = fetch('data/index.json')
      .then((r) => (r.ok ? r.json() : { courses: {}, totals: {} }))
      .catch(() => ({ courses: {}, totals: {} }));
  }
  return indexPromise;
}

/** Dizinden ders özetleri — tam içerik indirilmeden. */
export async function getReadyCoursesLite() {
  const [idx, cur] = await Promise.all([getIndex(), getCurriculum()]);
  const order = [...new Set(cur.semesters.flatMap((s) => s.courses))];
  return order.filter((c) => idx.courses[c]).map((c) => idx.courses[c]);
}

/**
 * SRS sayımı için sadece kart kimlikleri. Dizin kimlikleri saklamaz; konu başına kart
 * sayısından (`t.c`) türetiliyor — biçim collectCards ile birebir aynı olmalı:
 * `<ders>/<konu>/c<sıra>`.
 */
export async function getAllCardIds() {
  const idx = await getIndex();
  const out = [];
  for (const c of Object.values(idx.courses)) {
    for (const t of c.topics || []) {
      for (let i = 0; i < (t.c || 0); i++) out.push({ id: `${c.code}/${t.id}/c${i}` });
    }
  }
  return out;
}

/** Ders içeriği. İçerik dosyası yoksa null döner (ders "yakında" olarak gösterilir). */
export async function getCourse(code) {
  if (courseCache.has(code)) return courseCache.get(code);
  if (missing.has(code)) return null;
  try {
    const res = await fetch(`data/courses/${code}.json`);
    if (!res.ok) { missing.add(code); return null; }
    const data = await res.json();
    data.topics ||= [];
    data.topics.forEach((t, i) => { t.id ||= `w${i + 1}`; t.week ||= i + 1; });
    courseCache.set(code, data);
    return data;
  } catch (err) {
    missing.add(code);
    return null;
  }
}

/** Ders üst bilgisi — içerik dosyası olmasa bile müfredattan döner. */
export async function getCourseMeta(code) {
  const cur = await getCurriculum();
  const idx = cur.courseIndex[code] || {};
  const semester = cur.semesters.find((s) => s.courses.includes(code));
  return {
    code,
    name: idx.name || code,
    shortName: idx.shortName || idx.name || code,
    icon: idx.icon || 'book',
    color: idx.color || '#6366f1',
    instructor: idx.instructor || '',
    elective: !!idx.elective,
    semester: semester ? semester.n : null,
  };
}

/** Bir yarıyıldaki tüm dersler (dizinden — tam içerik indirilmez). */
export async function getSemesterCourses(n) {
  const [cur, idx] = await Promise.all([getCurriculum(), getIndex()]);
  const sem = cur.semesters.find((s) => s.n === n);
  if (!sem) return [];
  return sem.courses.map((code) => {
    const base = cur.courseIndex[code] || {};
    const lite = idx.courses[code];
    return {
      code,
      name: lite?.name || base.name || code,
      shortName: lite?.shortName || base.shortName || base.name || code,
      icon: lite?.icon || base.icon || 'book',
      color: lite?.color || base.color || '#6366f1',
      instructor: lite?.instructor || base.instructor || '',
      elective: !!base.elective,
      semester: n,
      hasContent: !!lite,
      topicCount: lite?.topicCount || 0,
      questionCount: lite?.questionCount || 0,
      cardCount: lite?.cardCount || 0,
      topics: lite?.topics || [],
    };
  });
}

/**
 * İçeriği hazır olan tüm dersler — TAM içerikle. Ağır (~2 MB); yalnızca gerçekten
 * soru/kart metni gereken yerlerde kullan (arama, tüm derslerde kart tekrarı).
 * Hangi derslerin içeriği olduğunu dizinden öğrenir, boşuna 404 istemez.
 */
export async function getReadyCourses() {
  const [cur, index] = await Promise.all([getCurriculum(), getIndex()]);
  const order = [...new Set(cur.semesters.flatMap((s) => s.courses))];
  const codes = order.filter((c) => index.courses[c]);
  const list = await Promise.all(codes.map(async (code) => {
    const course = await getCourse(code);
    if (!course) return null;
    const meta = await getCourseMeta(code);
    return { ...meta, course, topicCount: course.topics.length };
  }));
  return list.filter(Boolean);
}

/** Tüm flashcard'ları benzersiz id ile toplar. */
export function collectCards(course) {
  const cards = [];
  for (const t of course.topics) {
    (t.flashcards || []).forEach((c, i) => {
      cards.push({
        id: `${course.code}/${t.id}/c${i}`,
        code: course.code,
        courseName: course.shortName || course.name,
        color: course.color,
        topicId: t.id,
        topicTitle: t.title,
        week: t.week,
        q: c.q,
        a: c.a,
      });
    });
  }
  return cards;
}

/** Tüm soruları benzersiz id ile toplar. */
export function collectQuestions(course, topicIds = null) {
  const out = [];
  for (const t of course.topics) {
    if (topicIds && !topicIds.includes(t.id)) continue;
    (t.questions || []).forEach((q, i) => {
      out.push({
        ...q,
        id: q.id || `${t.id}q${i}`,
        uid: `${course.code}/${t.id}/${q.id || i}`,
        // DİKKAT: `code` alanı sorunun kendi kaynak koduna aittir (type:"code").
        // Ders kodu bilerek `courseCode` adıyla eklenir, üzerine yazmasın.
        courseCode: course.code,
        topicId: t.id,
        topicTitle: t.title,
        week: t.week,
      });
    });
  }
  return out;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cevap doğrulama — tüm soru tipleri için tek kapı. */
export function checkAnswer(q, given) {
  switch (q.type) {
    case 'mcq':
      return { correct: Number(given) === Number(q.answer), expected: q.choices?.[q.answer] };
    case 'tf':
      return { correct: Boolean(given) === Boolean(q.answer), expected: q.answer ? 'Doğru' : 'Yanlış' };
    case 'numeric': {
      const val = parseFloat(String(given).replace(',', '.').trim());
      const tol = q.tolerance ?? 0.01;
      const ok = Number.isFinite(val) && Math.abs(val - Number(q.answer)) <= Math.abs(tol);
      return { correct: ok, expected: `${q.answer}${q.unit ? ' ' + q.unit : ''}` };
    }
    case 'short': {
      const norm = normalize(given);
      const accepted = (q.accept || []).map(normalize).filter(Boolean);
      // Kabul edilen cevap, öğrencinin cümlesinde TAM KELİME olarak geçiyorsa doğru sayılır:
      // accept "must" iken "must be tired" da kabul edilir, ama "mustard" edilmez.
      const padded = ` ${norm} `;
      const contains = (a) => padded.includes(` ${a} `);
      // Olumsuzluk tuzağı: accept "correct" iken "not correct" doğru sayılmamalı.
      const NEG = ['not', 'no', 'never', 'degil', 'yok', 'hayir', 'yanlis'];
      const negated = (a) => NEG.some((n) => !` ${a} `.includes(` ${n} `) && padded.includes(` ${n} `));
      const ok = norm.length > 0
        && accepted.some((a) => a === norm || (contains(a) && !negated(a)));
      return { correct: ok, expected: (q.accept || [])[0] };
    }
    case 'code': {
      const norm = String(given || '').trim().replace(/\r/g, '').replace(/[ \t]+$/gm, '');
      const exp = String(q.expected || '').trim().replace(/\r/g, '').replace(/[ \t]+$/gm, '');
      return { correct: norm === exp, expected: q.expected };
    }
    case 'open':
      return { correct: null, expected: q.explain }; // kendi kendini değerlendirme
    default:
      return { correct: null, expected: null };
  }
}

/**
 * Türkçe duyarlı sadeleştirme: küçük harf, aksan ve noktalama temizliği.
 * Kesme işareti BOŞLUĞA değil hiçliğe düşer; böylece "She's" ile "Shes",
 * "Ankara'da" ile "Ankarada" aynı kabul edilir.
 */
export function normalize(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[‘’ʼ'`´]/g, '')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
