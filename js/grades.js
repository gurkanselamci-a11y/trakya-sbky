// grades.js — harf notu ölçeği, ders başarı notu ve ortalama (GANO/YANO) hesabı.
//
// Kaynak: Trakya Üniversitesi Ön Lisans ve Lisans Eğitim-Öğretim Yönetmeliği
// (RG 8/9/2025-33011), not sistemi RG 23/11/2025-33086 ile değişik hâli.
// Ayrıntı ve madde atıfları: docs/NOT-SISTEMI.md
//
// Değerlendirme MUTLAKtır (Madde 28/3) — bağıl değerlendirme Geçici Madde 1 ile
// kapatıldı. Yine de harf arayüzde elle değiştirilebilir (bkz. views/grades.js).
//
// DİKKAT: Bu tablo Kırıkkale'ninkinden farklıdır. Trakya'da DC harfi YOKTUR, BA/BB/CB
// eşikleri daha düşüktür ve FD 30-49 aralığıdır. Eski (2003 tarihli, yürürlükten
// kalkmış) yönetmeliğe ait tablolar internette hâlâ dolaşıyor; buradaki tablo
// yürürlükteki metinden alınmıştır.

export const SCALE = [
  { k: 'AA', c: 4.00, min: 90 },
  { k: 'BA', c: 3.50, min: 80 },
  { k: 'BB', c: 3.00, min: 70 },
  { k: 'CB', c: 2.50, min: 65 },
  { k: 'CC', c: 2.00, min: 60 },
  { k: 'DD', c: 1.50, min: 50 },  // katsayısı var ama BAŞARISIZ (Madde 28/5)
  { k: 'FD', c: 1.00, min: 30 },
  { k: 'FF', c: 0.00, min: 0 },
];

/**
 * Ortalamaya katsayısıyla giren ya da hiç girmeyen özel harfler (Madde 28/7).
 * Trakya'da "geçti/kaldı" karşılığı G/K değil BL/BZ'dir; DZ ise FF sayılarak
 * ortalamaya KATILIR — devamsızlık ortalamayı düşürür.
 */
export const SPECIAL = [
  { k: 'DZ', c: 0.00, label: 'Devamsız — FF sayılır, ortalamaya katılır' },
  { k: 'BL', c: null, label: 'Başarılı — ortalamaya katılmaz' },
  { k: 'BZ', c: null, label: 'Başarısız — ortalamaya katılmaz' },
];

const BY_KEY = new Map([...SCALE, ...SPECIAL].map((x) => [x.k, x]));

/**
 * Geçme sınırı: AA/BA/BB/CB/CC başarılı, DD/FD/FF başarısız (Madde 28/5).
 * Koşullu ("şartlı geçer / DB") geçme 23/11/2025 değişikliğiyle KALDIRILDI —
 * DD'nin katsayısı 1.50 olduğu hâlde ders geçilmiş sayılmaz.
 */
export const PASS_COEF = 2.00;

/**
 * Yarıyıl sonu ve bütünleme sınavı barajı (Madde 25/13-c, 25/14-c): sınavdan 50'nin
 * altında alan öğrencinin harf notu, ağırlıklı ortalaması ne olursa olsun FF'tir.
 */
export const EXAM_FLOOR = 50;

/**
 * Yönetmelikteki yuvarlama (Madde 28/2): virgülden sonraki ilk basamak 5'ten küçükse
 * aşağı, 5 ve üstündeyse yukarı. Harf, yuvarlanmış tam sayıdan belirlenir — 59,5
 * öğrenci için DD değil CC'dir, bu fark bir dersin geçme/kalmasını değiştirir.
 */
export const roundScore = (v) => (Number.isFinite(v) ? Math.floor(v + 0.5) : null);

export function letterFromScore(score) {
  if (!Number.isFinite(score)) return null;
  const hit = SCALE.find((x) => roundScore(score) >= x.min);
  return (hit || SCALE[SCALE.length - 1]).k;
}

/** Harfin katsayısı. Bilinmeyen harf ya da ortalamaya girmeyen harf (BL/BZ) için null. */
export function coefOf(letter) {
  const row = BY_KEY.get(letter);
  return row ? row.c : null;
}

export function countsInGpa(letter) {
  return Number.isFinite(coefOf(letter));
}

export function statusOf(letter) {
  if (letter === 'BL') return { k: 'pass', label: 'Başarılı' };
  if (letter === 'BZ') return { k: 'fail', label: 'Başarısız' };
  const c = coefOf(letter);
  if (!Number.isFinite(c)) return { k: 'none', label: '—' };
  if (c >= PASS_COEF) return { k: 'pass', label: 'Geçti' };
  return { k: 'fail', label: 'Kaldı' };
}

// ---------- ders içi değerlendirme ----------

/**
 * Yeni seçilen bir dersin varsayılan değerlendirme kalemleri (Madde 28/2):
 * ara sınav %30 + yarıyıl sonu %70. Birim kurulu kararıyla ara sınav payı %30-50
 * arasına çıkabildiği için ağırlıklar arayüzden değiştirilebilir.
 * `floor` alanı, o kalemin 50 barajına tabi olduğunu söyler.
 */
export const defaultItems = () => ([
  { id: 'vize', name: 'Vize', weight: 30, score: null },
  { id: 'final', name: 'Final', weight: 70, score: null, floor: EXAM_FLOOR },
  { id: 'but', name: 'Bütünleme', weight: 70, score: null, replaces: 'final', floor: EXAM_FLOOR },
]);

/**
 * Hesaba girecek kalemler. Bütünleme notu girildiyse finalin yerini alır; girilmediyse
 * bütünleme satırı hesap dışıdır (listede yine görünür, kullanıcı gerekirse doldurur).
 */
export function effectiveItems(items) {
  const list = (items || []).filter((i) => i && Number.isFinite(Number(i.weight)));
  const replaced = new Set(
    list.filter((i) => i.replaces && Number.isFinite(i.score)).map((i) => i.replaces),
  );
  return list.filter((i) => {
    if (replaced.has(i.id)) return false;                 // yerine bütünleme geçti
    if (i.replaces && !Number.isFinite(i.score)) return false; // boş bütünleme
    return true;
  });
}

/**
 * Ders başarı notu.
 * `score` girilen kalemlerin ağırlıklı ortalamasıdır — yani "şu ana kadarki" not.
 * Tüm ağırlık dolduğunda (`done`) bu, dersin kesin notudur.
 *
 * Baraj kuralı: barajlı bir kaleme (final/bütünleme) 50'nin altında not girildiyse
 * harf doğrudan FF olur. Ortalama yine gösterilir — öğrenci kaç puanla kaldığını
 * görsün diye — ama harfin ortalamayla ilgisi kalmaz.
 */
export function computeCourse(items) {
  const list = effectiveItems(items);
  const total = list.reduce((a, i) => a + Number(i.weight), 0);
  const filled = list.filter((i) => Number.isFinite(i.score));
  const filledWeight = filled.reduce((a, i) => a + Number(i.weight), 0);
  const score = filledWeight
    ? filled.reduce((a, i) => a + Number(i.score) * Number(i.weight), 0) / filledWeight
    : null;
  const floored = filled.find((i) => Number.isFinite(i.floor) && Number(i.score) < i.floor);
  return {
    score,
    total,
    filledWeight,
    done: filledWeight > 0 && filledWeight >= total,
    floorFail: floored ? { name: floored.name, floor: floored.floor, score: Number(floored.score) } : null,
    letter: floored ? 'FF' : letterFromScore(score),
  };
}

/**
 * Hedef nota ulaşmak için kalan kalemlerden gereken puan.
 * Girilmemiş ağırlık yoksa ya da hedef zaten imkânsızsa null döner.
 *
 * Kalanlar arasında barajlı bir sınav varsa sonuç en az 50'dir: ağırlıklı hesap 42
 * dese bile finalden 50 almayan FF alır, "42 yeter" demek öğrenciyi yanıltır.
 */
export function neededFor(items, target) {
  const list = effectiveItems(items);
  const total = list.reduce((a, i) => a + Number(i.weight), 0);
  const got = list
    .filter((i) => Number.isFinite(i.score))
    .reduce((a, i) => a + Number(i.score) * Number(i.weight), 0);
  const rest = list.filter((i) => !Number.isFinite(i.score));
  const left = total - list.filter((i) => Number.isFinite(i.score)).reduce((a, i) => a + Number(i.weight), 0);
  if (left <= 0) return null;
  const need = (target * total - got) / left;
  const hasFloor = rest.some((i) => Number.isFinite(i.floor));
  return hasFloor ? Math.max(need, EXAM_FLOOR) : need;
}

// ---------- ortalama ----------

/**
 * Ağırlıklı ortalama. rows = [{ akts, letter }]
 * Ağırlık birimi AKTS'dir (Madde 29/2) — yerel kredi değil.
 * BL/BZ gibi katsayısı olmayan harfler ve harfi olmayan dersler hesaba girmez.
 */
export function gpa(rows) {
  return weightedGpa((rows || []).map((r) => ({ akts: r.akts, coef: coefOf(r.letter) })));
}

/**
 * Ağırlıklı ortalamanın çekirdeği: parts = [{ akts, coef }].
 * Ders ders girilen notlar ve "önceki dönemlerden devir" (tek satırda GANO + AKTS)
 * aynı formülle birleşsin diye ayrı duruyor.
 */
export function weightedGpa(parts) {
  let pts = 0;
  let akts = 0;
  let counted = 0;
  for (const p of parts || []) {
    // DİKKAT: Number(null) === 0. Harfi olmayan ders "FF" gibi sayılmasın diye
    // katsayı sayı DEĞİLSE (null/undefined) satır tamamen atlanır.
    const c = typeof p.coef === 'number' ? p.coef : NaN;
    const a = Number(p.akts);
    if (!Number.isFinite(c) || !Number.isFinite(a) || a <= 0) continue;
    pts += c * a;
    akts += a;
    counted += 1;
  }
  // Madde 29/3: bölme virgülden sonra iki basamak yürütülür.
  return { gpa: akts ? Math.round((pts / akts) * 100) / 100 : null, akts, counted };
}

/** Geçilen (katsayı ≥ CC ya da BL) derslerin AKTS toplamı. */
export function earnedAkts(rows) {
  return (rows || []).reduce((sum, r) => {
    const a = Number(r.akts) || 0;
    const st = statusOf(r.letter);
    return st.k === 'pass' ? sum + a : sum;
  }, 0);
}

/** Mezuniyet derecesi (Madde 32/2). Normal süre + disiplin cezasızlık şartı ayrıca aranır. */
export function honorOf(gano) {
  if (!Number.isFinite(gano)) return null;
  if (gano >= 3.50) return 'Yüksek onur';
  if (gano >= 3.00) return 'Onur';
  return null;
}

export const fmtGpa = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
export const fmtScore = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString().replace('.', ',') : '—');
