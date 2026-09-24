// docx.js — düz Markdown'ı gerçek bir Word belgesine (.docx) çevirir. Bağımlılık yok.
//
// NEDEN GERÇEK DOCX: kolay yol, HTML'i `.doc` uzantısıyla kaydetmektir; Word çoğu sürümde
// açar ama "dosya biçimi uzantıyla uyuşmuyor" uyarısı verir ve Google Dokümanlar'da
// bozulabilir. .docx ise yalnızca birkaç XML dosyasını ZIP'leyerek üretilebiliyor; bu
// dosya onu yapıyor. Böylece Word, LibreOffice, Google Dokümanlar ve telefon uygulamaları
// belgeyi uyarısız açıyor.
//
// KAPSAM: uygulamanın ürettiği metin zaten sade (nlmexport.js KaTeX'i düz yazıya çevirmiş
// oluyor). Bu yüzden başlık, paragraf, kalın/italik, satır içi kod, madde listesi, tablo,
// kod bloğu ve yatay çizgi destekleniyor — ders notunun tamamı bu yapılardan oluşuyor.
// Numaralandırma için ayrı bir numbering.xml gerekmesin diye listeler doğrudan biçimlendirme
// (madde imi + girinti) ile yazılıyor; görünüm Word'de aynı, dosya çok daha basit kalıyor.

// ---------------------------------------------------------------------------
// Küçük ZIP yazıcı (yalnızca "store" — sıkıştırmasız)
// ---------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Dosya listesini ZIP baytlarına çevirir. */
function zip(dosyalar) {
  const enc = new TextEncoder();
  const parcalar = [];
  const merkez = [];
  let ofset = 0;

  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const { ad, icerik } of dosyalar) {
    const adB = enc.encode(ad);
    const veri = enc.encode(icerik);
    const c = crc32(veri);
    const yerel = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(c), ...u32(veri.length), ...u32(veri.length), ...u16(adB.length), ...u16(0),
    ]);
    parcalar.push(yerel, adB, veri);
    merkez.push(new Uint8Array([
      0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(c), ...u32(veri.length), ...u32(veri.length), ...u16(adB.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(ofset),
    ]), adB);
    ofset += yerel.length + adB.length + veri.length;
  }

  const merkezBoy = merkez.reduce((a, x) => a + x.length, 0);
  const son = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(dosyalar.length), ...u16(dosyalar.length), ...u32(merkezBoy), ...u32(ofset), ...u16(0),
  ]);

  const hepsi = [...parcalar, ...merkez, son];
  const boy = hepsi.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(boy);
  let i = 0;
  for (const p of hepsi) { out.set(p, i); i += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown → WordprocessingML
// ---------------------------------------------------------------------------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Satır içi işaretleme → w:r dizisi. Kalın, italik, satır içi kod. */
function kosular(metin) {
  const out = [];
  // Belirteçleri sırayla ayıkla: `kod`, **kalın**, *italik*
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let son = 0;
  let m;
  const duz = (t, bicim = '') => {
    if (!t) return;
    // Word'de satır sonu korunmaz; metindeki boşluklar için xml:space gerekir.
    out.push(`<w:r>${bicim}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
  };
  while ((m = re.exec(metin))) {
    duz(metin.slice(son, m.index));
    if (m[1]) duz(m[1].slice(1, -1), '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F2F3F5"/></w:rPr>');
    else if (m[2]) duz(m[2].slice(2, -2), '<w:rPr><w:b/></w:rPr>');
    else if (m[3]) duz(m[3].slice(1, -1), '<w:rPr><w:i/></w:rPr>');
    son = m.index + m[0].length;
  }
  duz(metin.slice(son));
  return out.join('') || '<w:r><w:t/></w:r>';
}

const p = (icerik, pPr = '') => `<w:p>${pPr}${icerik}</w:p>`;

/**
 * Başlık paragrafı. Stil dosyası (styles.xml) eklemek yerine doğrudan biçimlendirme
 * kullanılıyor: tek parçalık bir belge daha az yerde bozulur. `outlineLvl` sayesinde
 * Word'ün gezinme bölmesi ve içindekiler tablosu yine de çalışır.
 */
function baslik(metin, seviye) {
  const punto = [32, 28, 26, 24][seviye - 1] || 24;
  const rPr = `<w:rPr><w:b/><w:sz w:val="${punto}"/><w:color w:val="1F3864"/></w:rPr>`;
  const kosu = `<w:r>${rPr}<w:t xml:space="preserve">${esc(metin.replace(/\*\*/g, ''))}</w:t></w:r>`;
  const pPr = `<w:pPr><w:keepNext/><w:spacing w:before="${seviye === 1 ? 360 : 240}" w:after="120"/>`
    + `<w:outlineLvl w:val="${seviye - 1}"/></w:pPr>`;
  return p(kosu, pPr);
}

/** Tablo satırını hücrelere böler (kaçışlı `\|` hücre içinde kalır). */
const hucreler = (satir) => satir.trim().replace(/^\|/, '').replace(/\|$/, '')
  .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function tablo(satirlar) {
  const basliklar = hucreler(satirlar[0]);
  const govde = satirlar.slice(2).map(hucreler);
  const kenar = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((k) => `<w:${k} w:val="single" w:sz="4" w:color="C9CDD4"/>`).join('') + '</w:tblBorders>';
  const satir = (hucre, kalin) => `<w:tr>${hucre.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${kalin ? '<w:shd w:val="clear" w:fill="EEF1F5"/>' : ''}</w:tcPr>${p(kalin ? kosular(`**${c}**`) : kosular(c))}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${kenar}</w:tblPr>${satir(basliklar, true)}${govde.map((r) => satir(r, false)).join('')}</w:tbl>`;
}

/** Düz Markdown → belge gövdesi (w:body içeriği). */
function govdeUret(md) {
  const satirlar = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < satirlar.length) {
    const satir = satirlar[i];

    if (!satir.trim()) { i++; continue; }

    // Kod bloğu
    if (/^```/.test(satir)) {
      const govde = [];
      i++;
      while (i < satirlar.length && !/^```/.test(satirlar[i])) govde.push(satirlar[i++]);
      i++;
      for (const k of govde) {
        out.push(p(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(k)}</w:t></w:r>`,
          '<w:pPr><w:shd w:val="clear" w:fill="F6F7F9"/><w:spacing w:after="0"/><w:ind w:left="240"/></w:pPr>'));
      }
      continue;
    }

    // Yatay çizgi
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(satir)) {
      out.push(p('<w:r><w:t/></w:r>', '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C9CDD4"/></w:pBdr></w:pPr>'));
      i++; continue;
    }

    // Başlık
    const h = satir.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(baslik(h[2].trim(), Math.min(4, h[1].length))); i++; continue; }

    // Tablo
    if (satir.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|/.test(satirlar[i + 1] || '')) {
      const blok = [];
      while (i < satirlar.length && satirlar[i].includes('|')) blok.push(satirlar[i++]);
      out.push(tablo(blok));
      out.push(p('<w:r><w:t/></w:r>', '<w:pPr><w:spacing w:after="120"/></w:pPr>'));
      continue;
    }

    // Liste (madde imi ya da numaralı) — girintili alt maddeler de desteklenir
    const l = satir.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (l) {
      const derinlik = Math.min(2, Math.floor(l[1].length / 2));
      const im = /\d/.test(l[2]) ? `${l[2]} ` : '• ';
      out.push(p(kosular(im + l[3]),
        `<w:pPr><w:ind w:left="${360 + derinlik * 300}" w:hanging="220"/><w:spacing w:after="60"/></w:pPr>`));
      i++; continue;
    }

    // Alıntı
    if (/^>\s?/.test(satir)) {
      const govde = [];
      while (i < satirlar.length && /^>\s?/.test(satirlar[i])) govde.push(satirlar[i++].replace(/^>\s?/, ''));
      out.push(p(kosular(govde.join(' ')),
        '<w:pPr><w:ind w:left="300"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="6" w:color="9AA4B2"/></w:pBdr><w:spacing w:after="120"/></w:pPr>'));
      continue;
    }

    // Paragraf
    const par = [];
    while (i < satirlar.length && satirlar[i].trim()
      && !/^(#{1,6}\s|>\s?|```|\s*([-*+]|\d+\.)\s)/.test(satirlar[i])) par.push(satirlar[i++]);
    out.push(p(kosular(par.join(' ')), '<w:pPr><w:spacing w:after="120"/><w:jc w:val="both"/></w:pPr>'));
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// Dışa açılan API
// ---------------------------------------------------------------------------

/** Düz Markdown → .docx baytları (Uint8Array). */
export function markdownToDocx(md, { baslik: belgeAdi = 'Ders notu' } = {}) {
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>' + govdeUret(md)
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/>'
    + '</w:sectPr></w:body></w:document>';

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>';

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>';

  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + `<dc:title>${esc(belgeAdi)}</dc:title><dc:creator>TÜ SBKY Çalışma</dc:creator>`
    + '</cp:coreProperties>';

  return zip([
    { ad: '[Content_Types].xml', icerik: contentTypes },
    { ad: '_rels/.rels', icerik: rels },
    { ad: 'docProps/core.xml', icerik: core },
    { ad: 'word/document.xml', icerik: document },
  ]);
}

/** Tarayıcıda indirilebilir Blob. */
export function docxBlob(md, secenek) {
  return new Blob([markdownToDocx(md, secenek)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
