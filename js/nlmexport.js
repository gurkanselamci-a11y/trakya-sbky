// nlmexport.js — ders içeriğini NotebookLM'e kaynak olarak verilebilecek düz Markdown'a çevirir.
//
// NotebookLM kaynağı okuyup KENDİ anlatımını üretir; metni olduğu gibi seslendirmez.
// Bu yüzden hedef "seslendirilebilir metin" değil, ANLAŞILIR metin: uygulamaya özgü
// biçimlendirme (callout söz dizimi, KaTeX) düz yazıya çevrilir; ders künyesi ve o haftanın
// resmî izlence başlığı başa konur ki model bağlamı bilsin.
//
// Bu modülün DOM bağımlılığı yoktur: hem uygulama (konu sayfasındaki düğmeler) hem de
// komut satırı aracı (tools/export-notebooklm.mjs) aynı metni üretsin diye tek kaynaktır.

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

/** `\frac{a}{b}` ve `\dfrac{a}{b}` → `a bölü b`. */
function kesirleriAc(s) {
  for (let tur = 0; tur < 40; tur++) {
    const m = /\\[dt]?frac\s*\{/.exec(s);
    if (!m) break;
    const pay = icerik(s, m.index + m[0].length - 1);
    if (!pay) break;
    const payda = icerik(s, pay.son);
    if (!payda) break;
    const sar = (x) => (/[\s+\-=]/.test(x.trim()) ? `(${x.trim()})` : x.trim());
    s = s.slice(0, m.index) + `${sar(pay.govde)} bölü ${sar(payda.govde)}` + s.slice(payda.son);
  }
  return s;
}

const KOMUT = [
  [/\\times/g, ' × '], [/\\cdot/g, ' × '], [/\\div/g, ' bölü '],
  [/\\approx/g, ' ≈ '], [/\\neq/g, ' ≠ '], [/\\leq/g, ' ≤ '], [/\\geq/g, ' ≥ '],
  [/\\Rightarrow|\\rightarrow|\\to/g, ' → '], [/\\Leftrightarrow|\\leftrightarrow/g, ' ↔ '],
  [/\\uparrow/g, ' artar'], [/\\downarrow/g, ' azalır'],
  [/\\Delta/g, 'Δ'], [/\\sigma/g, 'σ'], [/\\mu/g, 'μ'], [/\\pi/g, 'π'],
  [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\lambda/g, 'λ'], [/\\infty/g, 'sonsuz'],
  [/\\sum/g, 'toplam'], [/\\sqrt\s*/g, 'karekök'],
  [/\\%/g, '%'], [/\\,|\\;|\\!|\\ /g, ' '], [/\\quad|\\qquad/g, '  '],
  [/\\left|\\right/g, ''], [/\\displaystyle/g, ''], [/\\mathrm|\\mathbf|\\operatorname/g, ''],
];

/** Tek bir matematik parçasını düz yazıya çevirir. */
export function matDuzYazi(m) {
  let s = kesirleriAc(m);
  s = s.replace(/\\text\s*\{/g, '{');
  for (const [re, yerine] of KOMUT) s = s.replace(re, yerine);
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\^\s*2\b/g, ' kare').replace(/\^\s*3\b/g, ' küp');
  s = s.replace(/\^\s*\(?([-\d a-zA-Z+]+)\)?/g, ' üssü $1');
  s = s.replace(/_\s*\{?([^\s{}]+)\}?/g, '$1');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Metindeki `$$…$$` ve `$…$` bloklarını düz yazıya çevirir. */
function matematigiCevir(metin) {
  let s = String(metin).replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `\n**Formül:** ${matDuzYazi(m)}\n`);
  return s.replace(/\$([^$\n]+?)\$/g, (_, m) => matDuzYazi(m));
}

// ---------------------------------------------------------------------------
// Uygulamaya özgü işaretlemeyi temizle
// ---------------------------------------------------------------------------

const CALLOUT = { dikkat: 'Dikkat', ipucu: 'İpucu', 'sınav': 'Sınavda çıkar', not: 'Not' };

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
  s = matematigiCevir(s);
  s = s.replace(/^(#{1,5}) /gm, (_, d) => '#'.repeat(Math.min(6, d.length + indir)) + ' ');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

const SIK = (n) => (n === undefined ? '' : ['', 'kolay', 'orta', 'zor'][n] || '');

function dogruCevap(q) {
  if (q.type === 'mcq') return matDuzYazi(String(q.choices?.[q.answer] ?? ''));
  if (q.type === 'tf') return q.answer ? 'Doğru' : 'Yanlış';
  if (q.type === 'numeric') return String(q.answer ?? '');
  if (Array.isArray(q.accept) && q.accept.length) return q.accept[0];
  return q.answer != null ? String(q.answer) : '(açık uçlu)';
}

/** Tek konunun gövdesi. */
function konuBolumu(t, resmi, baslikSeviyesi = '##') {
  const alt = baslikSeviyesi + '#';
  const p = [];
  p.push(`${baslikSeviyesi} ${t.week}. hafta — ${t.title}`);
  const resmiHafta = resmi?.weeks?.find((w) => w.n === t.week);
  if (resmiHafta) p.push(`*Resmî izlencedeki başlık:* ${resmiHafta.konu}`);
  if (t.summary) p.push(`*Özet:* ${t.summary}`);
  p.push('', notuHazirla(t.notes));

  if (t.keyPoints?.length) {
    p.push('', `${alt} Bu haftanın bilinmesi gerekenleri`, '');
    p.push(t.keyPoints.map((k) => `- ${matematigiCevir(k)}`).join('\n'));
  }
  if (t.pitfalls?.length) {
    p.push('', `${alt} Sık yapılan hatalar`, '');
    p.push(t.pitfalls.map((k) => `- ${matematigiCevir(k)}`).join('\n'));
  }
  if (t.flashcards?.length) {
    p.push('', `${alt} Terimler ve tanımlar`, '');
    p.push(t.flashcards.map((f) => `- **${matematigiCevir(f.q)}** — ${matematigiCevir(f.a)}`).join('\n'));
  }
  if (t.questions?.length) {
    p.push('', `${alt} Ölçme soruları, cevapları ve gerekçeleri`, '');
    p.push(t.questions.map((q, i) => {
      const satir = [`**Soru ${i + 1}** (${SIK(q.difficulty)}${q.type === 'open' ? ', açık uçlu' : ''}). ${matematigiCevir(q.q)}`];
      if (q.type === 'mcq' && q.choices) {
        satir.push(q.choices.map((c, j) => `   ${'ABCD'[j] || j + 1}) ${matDuzYazi(String(c))}`).join('\n'));
      }
      satir.push(`   *Doğru cevap:* ${dogruCevap(q)}`);
      if (q.explain) satir.push(`   *Gerekçe:* ${matematigiCevir(q.explain)}`);
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
  if (ders.description) p.push('', `**Dersin kapsamı.** ${ders.description}`);
  if (resmi?.amac) p.push('', `**Resmî ders amacı.** ${resmi.amac}`);
  if (resmi?.icerik) p.push('', `**Resmî ders içeriği.** ${resmi.icerik}`);
  if (resmi?.outcomes?.length) p.push('', '**Resmî öğrenme çıktıları.**', '', resmi.outcomes.map((o) => `- ${o}`).join('\n'));
  if (resmi?.resources?.length) p.push('', '**Resmî kaynak kitaplar.**', '', [...new Set(resmi.resources)].map((o) => `- ${o}`).join('\n'));
  p.push('', '---', '');
  return p.join('\n');
}

const duzelt = (s) => s.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

// ---------------------------------------------------------------------------
// Dışa açılan API
// ---------------------------------------------------------------------------

/** Tek haftanın kaynağı. */
export function konuKaynagi(ders, konu, resmi) {
  return duzelt(kunye(ders, resmi, `${konu.week}. hafta`) + konuBolumu(konu, resmi));
}

/** Dersin 14 haftasının tamamı. */
export function dersKaynagi(ders, resmi) {
  const govde = ders.topics.map((t) => konuBolumu(t, resmi)).join('\n\n---\n\n');
  return duzelt(kunye(ders, resmi, 'dersin tamamı, 14 hafta') + govde);
}

/** İndirilecek dosyanın adı. */
export function dosyaAdi(ders, konu = null) {
  const temiz = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return konu
    ? `${ders.code}-w${konu.week} ${temiz(konu.title)}.md`
    : `${ders.code} ${temiz(ders.shortName || ders.name)}.md`;
}

/** NotebookLM'in "özelleştir" kutusuna yapıştırılacak hazır yönerge. */
export const YONERGE = `Dili Türkçe olsun.

Rolün: Siyaset Bilimi ve Kamu Yönetimi bölümü öğrencisine bu konuyu sıfırdan anlatan
bir asistan. Öğrenci konuyu hiç bilmiyor varsay.

Şu sırayı izle:
1. Konu neden var, hangi soruyu çözmek için doğmuş? Günlük hayattan bir örnekle başla.
2. Temel kavramları teker teker tanımla. Her tanımdan sonra somut bir örnek ver.
3. Kavramlar arasındaki farkları açıkça karşılaştır; kaynakta "karıştırılan" ya da
   "sık yapılan hatalar" diye geçen yerleri mutlaka işle ve ayırt edici ölçütü söyle.
4. Varsa tarihsel gelişimi ve Türkiye'deki karşılığını anlat; mevzuat maddesi geçiyorsa
   madde numarasını söyle ve ne dediğini sade dille açıkla.
5. Sonunda 5 maddelik bir özet ve sınavda nelerin sorulabileceğini söyle.

Kurallar:
- Kaynakta olmayan bilgi ekleme, tarih ve sayı uydurma.
- Terimleri Türkçe kullan; yabancı karşılığını ilk geçtiğinde parantez içinde ver.
- Acele etme, ayrıntıya gir; yüzeysel geçme.`;
