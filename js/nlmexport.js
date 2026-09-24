// nlmexport.js — ders içeriğini NotebookLM'e kaynak olarak verilebilecek düz Markdown'a çevirir.
//
// NotebookLM kaynağı okuyup KENDİ anlatımını üretir (metni olduğu gibi seslendirmez), ama
// okuduğu metni anlaması gerekir. Uygulamaya özgü iki şey buna engel: `> [!dikkat]` gibi
// kutu söz dizimi ve `$\frac{a}{b}$` gibi KaTeX. Bu modül ikisini de düz yazıya indirger,
// başa ders künyesini koyar ki model bağlamı bilsin.
//
// MÜHENDİSLİK İÇERİĞİNE ÖZGÜ İKİ KARAR:
//  1. Kod blokları matematik çevirisinden MUAF tutulur. Aksi hâlde kabuk örneğindeki
//     `$PATH ... $HOME` gibi iki dolar işareti matematik sanılıp kod bozuluyor; `x^2`
//     ya da `a_i` içeren kod da yanlış çevriliyordu. Kod, NotebookLM'in zaten okuyabildiği
//     bir biçim — olduğu gibi bırakmak hem doğru hem yeterli.
//  2. Sembol sözlüğü geniş tutuldu: bu bölümün içeriğinde mantık (∧ ∨ ¬ ∀ ∃), kümeler
//     (∪ ∩ ⊆ ∈), karmaşıklık (Θ Ω), modüler aritmetik ve olasılık işaretleri sık geçiyor.
//     Çevrilemeyen bir komut metinde `\komut` olarak kalırsa model onu kelime sanır.

// ---------------------------------------------------------------------------
// KaTeX → düz yazı
// ---------------------------------------------------------------------------

/** `{...}` çiftini dengeli biçimde kapatır. */
function icerik(s, bas) {
  let derinlik = 0;
  for (let i = bas; i < s.length; i++) {
    if (s[i] === '{') derinlik++;
    else if (s[i] === '}') { derinlik--; if (!derinlik) return { govde: s.slice(bas + 1, i), son: i + 1 }; }
  }
  return null;
}

/** `\frac{a}{b}`, `\dfrac`, `\tfrac` → `a bölü b`. */
function kesirleriAc(m) {
  let s = String(m);
  for (let n = 0; n < 40; n++) {
    const bul = /\\[dt]?frac\s*\{/.exec(s);
    if (!bul) break;
    const pay = icerik(s, bul.index + bul[0].length - 1);
    if (!pay) break;
    const payda = icerik(s, pay.son);
    if (!payda) break;
    const sar = (x) => (/[\s+\-=]/.test(x.trim()) ? `(${x.trim()})` : x.trim());
    s = s.slice(0, bul.index) + `${sar(pay.govde)} bölü ${sar(payda.govde)}` + s.slice(payda.son);
  }
  return s;
}

/** `\binom{n}{k}` → `n'in k'li kombinasyonu`. */
function binomlariAc(m) {
  let s = String(m);
  for (let n = 0; n < 20; n++) {
    const bul = /\\d?binom\s*\{/.exec(s);
    if (!bul) break;
    const ust = icerik(s, bul.index + bul[0].length - 1);
    if (!ust) break;
    const alt = icerik(s, ust.son);
    if (!alt) break;
    s = s.slice(0, bul.index) + `${ust.govde.trim()}'in ${alt.govde.trim()}'li kombinasyonu` + s.slice(alt.son);
  }
  return s;
}

const KOMUT = [
  // işlemler ve karşılaştırma
  [/\\times/g, ' × '], [/\\cdot/g, ' × '], [/\\div/g, ' bölü '], [/\\pm/g, ' artı eksi '],
  [/\\approx/g, ' ≈ '], [/\\neq|\\ne\b/g, ' ≠ '], [/\\leq|\\le\b/g, ' ≤ '], [/\\geq|\\ge\b/g, ' ≥ '],
  [/\\ll\b/g, ' çok küçüktür '], [/\\gg\b/g, ' çok büyüktür '], [/\\equiv/g, ' ≡ '],
  // oklar ve mantık
  [/\\Rightarrow|\\implies/g, ' ⇒ '], [/\\rightarrow|\\to\b/g, ' → '],
  [/\\Leftrightarrow|\\iff|\\leftrightarrow/g, ' ↔ '],
  [/\\land|\\wedge/g, ' ve '], [/\\lor|\\vee/g, ' veya '], [/\\lnot|\\neg/g, ' değil '],
  [/\\oplus/g, ' dışlayıcı veya '], [/\\forall/g, ' her '], [/\\exists/g, ' en az bir '],
  [/\\models/g, ' gerektirir '], [/\\vdash/g, ' türetilir '],
  // kümeler
  [/\\cup/g, ' birleşim '], [/\\cap/g, ' kesişim '], [/\\setminus/g, ' fark '],
  [/\\subseteq/g, ' alt kümesidir '], [/\\subset/g, ' öz alt kümesidir '],
  [/\\notin/g, ' elemanı değildir '], [/\\in\b/g, ' elemanıdır '],
  [/\\emptyset|\\varnothing/g, ' boş küme '], [/\\mathbb\s*\{([A-Z])\}/g, '$1'],
  // analiz ve toplamlar
  [/\\sum/g, ' toplam '], [/\\prod/g, ' çarpım '], [/\\int/g, ' integral '],
  [/\\lim/g, ' limit '], [/\\partial/g, ' kısmi türev '], [/\\infty/g, ' sonsuz '],
  [/\\sqrt\s*/g, ' karekök '], [/\\log/g, ' log '], [/\\ln/g, ' ln '],
  [/\\bmod|\\mod/g, ' mod '], [/\\pmod\s*\{?([^}]*)\}?/g, ' (mod $1)'],
  [/\\lfloor|\\rfloor/g, ''], [/\\lceil|\\rceil/g, ''],
  [/\\max/g, ' maksimum '], [/\\min/g, ' minimum '],
  // karmaşıklık ve yunan harfleri
  [/\\Theta/g, 'Θ'], [/\\Omega/g, 'Ω'], [/\\Delta/g, 'Δ'], [/\\Sigma/g, 'Σ'],
  [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
  [/\\epsilon|\\varepsilon/g, 'ε'], [/\\theta/g, 'θ'], [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'],
  [/\\pi/g, 'π'], [/\\rho/g, 'ρ'], [/\\sigma/g, 'σ'], [/\\tau/g, 'τ'],
  [/\\phi|\\varphi/g, 'φ'], [/\\omega/g, 'ω'],
  // biçim komutları — anlamı yok, atılır
  [/\\%/g, '%'], [/\\,|\\;|\\!|\\ /g, ' '], [/\\quad|\\qquad/g, '  '],
  [/\\left|\\right/g, ''], [/\\displaystyle/g, ''],
  [/\\mathrm|\\mathbf|\\mathit|\\operatorname|\\text\b|\\texttt|\\textbf|\\textit|\\textsc|\\mathtt|\\mathsf/g, ''],
  [/\\overline\s*\{([^}]*)\}/g, "$1'nin değili"], [/\\bar\s*\{?([^\s{}]+)\}?/g, "$1'nin değili"],
  [/\\vec\s*\{?([^\s{}]+)\}?/g, '$1 vektörü'], [/\\hat\s*\{?([^\s{}]+)\}?/g, '$1 şapka'],
  [/\\dots|\\cdots|\\ldots/g, '…'],
];

/** Tek bir matematik parçasını düz yazıya çevirir. */
export function matDuzYazi(m) {
  let s = binomlariAc(kesirleriAc(m));
  s = s.replace(/\\text\s*\{/g, '{');
  // KAÇIŞLI SÜSLÜ PARANTEZ küme gösterimidir (`\{a, b\}` = "a, b kümesi") ve korunmalı;
  // gruplama parantezleri ise atılır. İkisi aynı karakter olduğu için küme parantezleri
  // önce kenara alınır — yoksa derleyici dersindeki FIRST/FOLLOW kümeleri parantezsiz
  // kalıp "i, a" gibi anlamsız bir listeye dönüşüyordu.
  s = s.replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  for (const [re, yerine] of KOMUT) s = s.replace(re, yerine);
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  s = s.replace(/\^\s*2\b/g, ' kare').replace(/\^\s*3\b/g, ' küp');
  s = s.replace(/\^\s*\(?([-\d a-zA-Z+]+)\)?/g, ' üssü $1');
  s = s.replace(/_\s*\{?([^\s{}]+)\}?/g, '$1');
  // Çevrilemeyen komut kaldıysa ters eğik çizgiyi at; model `\qquad` gibi bir şeyi
  // kelime sanmasın.
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Metindeki `$$…$$` ve `$…$` bloklarını düz yazıya çevirir.
 *
 * KAÇIŞLI DOLAR: içerikte `\$t2`, `\$sp` gibi MIPS kaydedici adları var (BIL2002).
 * Bunlar matematik değil, düz metinde görünmesi gereken dolar işareti. Önce kenara
 * alınmazsa hem metinde `\$` olarak kalıyor hem de aradaki gerçek formül sınırlarını
 * kaydırıp iki ayrı formülü tek parça sanmaya yol açıyordu.
 */
function matematigiCevir(metin) {
  const KACIS = '\u0001DLR\u0001';
  let s = String(metin).replace(/\\\$/g, KACIS);
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `\n**Formül:** ${matDuzYazi(m)}\n`);
  // Satır içi matematik SATIR ATLAYABİLİR: uzun ilişkisel cebir ifadeleri kaynakta
  // iki satıra bölünmüş halde duruyor. Bu yüzden `\n` yasağı yerine "boş satır
  // geçmesin" kuralı kullanılır; yoksa iki ayrı formül tek parça sanılır.
  s = s.replace(/\$([^$]{1,600}?)\$/g, (tam, m) => (m.includes('\n\n') ? tam : matDuzYazi(m)));
  return s.replace(new RegExp(KACIS, 'g'), '$');
}

/**
 * Kodu koruyarak metnin geri kalanında matematiği çevirir.
 *
 * Hem üç ters tırnaklı bloklar hem de `satır içi kod` korunur: ikincisi olmadan
 * MIPS kaydedicisi `$t0` ya da kabuk değişkeni `$PATH` matematik sanılıp bozuluyordu.
 */
function matematigiCevirKoduKoru(metin) {
  const bloklar = [];
  const sakla = (blok) => `\u0000KOD${bloklar.push(blok) - 1}\u0000`;
  const yer = String(metin)
    .replace(/```[\s\S]*?```/g, sakla)
    .replace(/`[^`\n]+`/g, sakla);
  return matematigiCevir(yer).replace(/\u0000KOD(\d+)\u0000/g, (_, n) => bloklar[+n]);
}

// ---------------------------------------------------------------------------
// Uygulamaya özgü işaretlemeyi temizle
// ---------------------------------------------------------------------------

const CALLOUT = {
  dikkat: 'Dikkat', ipucu: 'İpucu', sınav: 'Sınavda çıkar', sinav: 'Sınavda çıkar',
  örnek: 'Örnek', ornek: 'Örnek', not: 'Not', tanım: 'Tanım', tanim: 'Tanım',
};

/** `> [!dikkat]` bloklarını `**Dikkat.** …` paragrafına çevirir. */
function calloutlariAc(metin) {
  const satirlar = String(metin).split('\n');
  const cikti = [];
  let i = 0;
  while (i < satirlar.length) {
    const m = /^>\s*\[!([^\]]+)\]\s*(.*)$/.exec(satirlar[i]);
    if (!m) { cikti.push(satirlar[i++]); continue; }
    const etiket = CALLOUT[m[1].trim().toLocaleLowerCase('tr')] || m[1].trim();
    const govde = [];
    if (m[2].trim()) govde.push(m[2].trim());
    i++;
    while (i < satirlar.length && /^>/.test(satirlar[i])) { govde.push(satirlar[i].replace(/^>\s?/, '').trim()); i++; }
    cikti.push('', `**${etiket}.** ${govde.join(' ').replace(/\s{2,}/g, ' ').trim()}`, '');
  }
  return cikti.join('\n');
}

/** Konu notunu düz Markdown'a indirger; başlıkları bir düzey aşağı alır. */
function notuHazirla(notes, indir = 1) {
  let s = calloutlariAc(notes || '');
  s = matematigiCevirKoduKoru(s);
  s = s.replace(/^(#{1,5}) /gm, (_, d) => '#'.repeat(Math.min(6, d.length + indir)) + ' ');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Tek satırlık alanlar (madde, kart, soru, başlık) için ortak temizlik.
 * Kutu söz dizimi yalnız `notes` içinde sanılıyordu; oysa `keyPoints` ve `pitfalls`
 * maddelerinin içinde de `> [!dikkat]` geçiyor (MUH0150'de 11 haftada).
 */
const duzMetin = (s) => matematigiCevirKoduKoru(calloutlariAc(String(s || ''))).replace(/\n{2,}/g, ' ').trim();

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

const SIK = (n) => (n === undefined ? '' : ['', 'kolay', 'orta', 'zor'][n] || '');

// DIKKAT: sik metinleri ve kisa cevaplar `$...$` SINIRLAYICILARIYLA gelir; dogrudan
// matDuzYazi'ya verilirse komutlar cevrilir ama dolar isaretleri metinde kalir ve
// NotebookLM onlari okur. Sinirlayiciyi de isleyen matematigiCevir... kullanilmali.
function dogruCevap(q) {
  if (q.type === 'mcq') return matematigiCevirKoduKoru(String(q.choices?.[q.answer] ?? ''));
  if (q.type === 'tf') return q.answer ? 'Doğru' : 'Yanlış';
  if (q.type === 'numeric') return String(q.answer ?? '');
  if (q.type === 'code') return `(kodun çıktısı) ${String(q.expected ?? '').trim()}`;
  if (Array.isArray(q.accept) && q.accept.length) return q.accept[0];
  return q.answer != null ? String(q.answer) : '(açık uçlu)';
}

/** Tek konunun gövdesi. */
function konuBolumu(t, resmi, baslikSeviyesi = '##') {
  const alt = baslikSeviyesi + '#';
  const p = [];
  p.push(`${baslikSeviyesi} ${t.week}. hafta — ${duzMetin(t.title)}`);
  const resmiHafta = resmi?.weeks?.find((w) => w.n === t.week);
  if (resmiHafta) p.push(`*Resmî izlencedeki başlık:* ${resmiHafta.konu}`);
  if (t.summary) p.push(`*Özet:* ${matematigiCevirKoduKoru(t.summary)}`);
  p.push('', notuHazirla(t.notes));

  if (t.keyPoints?.length) {
    p.push('', `${alt} Bu haftanın bilinmesi gerekenleri`, '');
    p.push(t.keyPoints.map((k) => `- ${duzMetin(k)}`).join('\n'));
  }
  if (t.pitfalls?.length) {
    p.push('', `${alt} Sık yapılan hatalar`, '');
    p.push(t.pitfalls.map((k) => `- ${duzMetin(k)}`).join('\n'));
  }
  if (t.flashcards?.length) {
    p.push('', `${alt} Terimler ve tanımlar`, '');
    p.push(t.flashcards.map((f) => `- **${duzMetin(f.q)}** — ${duzMetin(f.a)}`).join('\n'));
  }
  if (t.questions?.length) {
    p.push('', `${alt} Ölçme soruları, cevapları ve gerekçeleri`, '');
    p.push(t.questions.map((q, i) => {
      const satir = [`**Soru ${i + 1}** (${SIK(q.difficulty)}${q.type === 'open' ? ', açık uçlu' : ''}). ${duzMetin(q.q)}`];
      if (q.type === 'mcq' && q.choices) {
        satir.push(q.choices.map((c, j) => `   ${'ABCD'[j] || j + 1}) ${matematigiCevirKoduKoru(String(c))}`).join('\n'));
      }
      if (q.type === 'code' && q.code) satir.push('', '```' + (q.lang || '') + '\n' + q.code + '\n```');
      satir.push(`   *Doğru cevap:* ${dogruCevap(q)}`);
      if (q.explain) satir.push(`   *Gerekçe:* ${duzMetin(q.explain)}`);
      return satir.join('\n');
    }).join('\n\n'));
  }
  return p.join('\n');
}

/** Dosyanın başına konan ders künyesi — modelin bağlamı bilmesi için. */
function kunye(ders, resmi, kapsam) {
  const p = [];
  p.push(`# ${ders.name} (${ders.code}) — ${kapsam}`, '');
  p.push('> Bu belge Trakya Üniversitesi İktisadi ve İdari Bilimler Fakültesi, Siyaset Bilimi ve');
  p.push('> Kamu Yönetimi Bölümü öğrencisi için hazırlanmış bir ders çalışma kaynağıdır.', '');
  p.push(`- **Ders:** ${ders.name} (${ders.code}), ${ders.semester}. yarıyıl`);
  if (ders.credits) p.push(`- **Kredi / AKTS:** ${ders.credits.kredi} / ${ders.credits.akts}`);
  if (ders.instructor) p.push(`- **Öğretim elemanı:** ${ders.instructor}`);
  if (resmi?.assessment) p.push(`- **Değerlendirme:** vize %${resmi.assessment.vize}, final %${resmi.assessment.final}`);
  if (ders.description) p.push('', `**Dersin kapsamı.** ${duzMetin(ders.description)}`);
  if (resmi?.amac) p.push('', `**Resmî ders amacı.** ${resmi.amac}`);
  if (resmi?.icerik) p.push('', `**Resmî ders içeriği.** ${resmi.icerik}`);
  if (resmi?.outcomes?.length) p.push('', '**Resmî öğrenme çıktıları.**', '', resmi.outcomes.map((o) => `- ${o}`).join('\n'));
  if (resmi?.resources?.length) p.push('', '**Kaynaklar.**', '', [...new Set(resmi.resources)].map((o) => `- ${o}`).join('\n'));
  // Ders dosyalarında kaynaklar {title, note} nesnesidir; resmî izlencede ise düz metin.
  // İkisi de gelebilir, bu yüzden tür yoklanır — yoksa listede "[object Object]" çıkar.
  else if (ders.resources?.length) {
    p.push('', '**Kaynaklar.**', '', ders.resources.map((o) => {
      if (typeof o === 'string') return `- ${duzMetin(o)}`;
      const ad = duzMetin(o.title || o.ad || '');
      const not = duzMetin(o.note || o.not || '');
      return not ? `- **${ad}** — ${not}` : `- ${ad}`;
    }).join('\n'));
  }
  p.push('', '---', '');
  return p.join('\n');
}

const duzelt = (s) => s.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

// ---------------------------------------------------------------------------
// Dışa açılan API
// ---------------------------------------------------------------------------

/** Tek haftanın kaynağı. */
export function konuKaynagi(ders, konu, resmi = null) {
  return duzelt(kunye(ders, resmi, `${konu.week}. hafta`) + konuBolumu(konu, resmi));
}

/** Dersin 14 haftasının tamamı. */
export function dersKaynagi(ders, resmi = null) {
  const govde = ders.topics.map((t) => konuBolumu(t, resmi)).join('\n\n---\n\n');
  return duzelt(kunye(ders, resmi, `dersin tamamı, ${ders.topics.length} hafta`) + govde);
}

/** İndirilecek dosyanın adı. */
export function dosyaAdi(ders, konu = null) {
  const temiz = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return konu
    ? `${ders.code}-h${konu.week} ${temiz(konu.title)}.md`
    : `${ders.code} ${temiz(ders.shortName || ders.name)}.md`;
}

/** NotebookLM'in "özelleştir" kutusuna yapıştırılacak hazır yönerge. */
export const YONERGE = `Dili Türkçe olsun.

Rolün: Siyaset Bilimi ve Kamu Yönetimi bölümü öğrencisine bu haftayı sıfırdan anlatan
bir asistan. Öğrenci konuyu hiç bilmiyor varsay.

Şu sırayı izle:
1. Konu neden var, hangi soruyu çözmek için doğmuş? Günlük hayattan somut bir örnekle başla.
2. Temel kavramları teker teker tanımla; her tanımdan sonra somut bir örnek ver.
3. Kavramlar arasındaki farkları açıkça karşılaştır. Kaynakta "karıştırılan", "dikkat" ya da
   "sık yapılan hatalar" diye geçen yerleri mutlaka işle: yanlış olan nedir, doğrusu nedir,
   ayırt edici ölçüt nedir?
4. Mevzuat maddesi geçiyorsa madde numarasını söyle ve ne dediğini sade dille açıkla;
   tarihsel gelişimi ve Türkiye'deki karşılığını anlat.
5. Sayısal bir örnek varsa adım adım, ara sonuçları söyleyerek çöz.
6. Sonunda 5 maddelik özet ver ve sınavda bu haftadan ne sorulabileceğini söyle.

Kurallar:
- Kaynakta olmayan bilgi ekleme; sayı, tarih ve madde numarası uydurma.
- Terimleri Türkçe kullan, yabancı karşılığını ilk geçtiğinde parantez içinde ver.
- Acele etme, ayrıntıya gir; yüzeysel geçme.`;
