// md.js — kucuk markdown motoru: KaTeX matematik + kod renklendirme + uyari kutulari.
// Bagimlilik: vendor/katex (global `katex`).
// Yer tutucular ASCII sentinel; ders icerigi icinde pratikte asla gecmez.

import { ico } from './icons.js';

const P0 = '@@MDS';
const P1 = 'SDM@@';

const KEYWORDS = {
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false bool',
  cpp: 'auto bool break case catch char class const continue default delete do double else enum explicit extern false float for friend goto if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print len range',
  js: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return super switch this throw true try typeof var void while yield console',
  sql: 'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP JOIN INNER LEFT RIGHT OUTER ON GROUP BY ORDER HAVING DISTINCT AS AND OR NOT NULL PRIMARY KEY FOREIGN REFERENCES INDEX COUNT SUM AVG MIN MAX LIMIT',
  // Donanim tanimlama dili (KAM303 FPGA dersi). Once ```cpp ile yaziliyordu; `always`,
  // `endmodule`, `posedge` gibi dilin en ayirt edici sozcukleri renklenmiyordu.
  verilog: 'module endmodule input output inout wire reg logic integer genvar parameter localparam assign always always_ff always_comb always_latch posedge negedge begin end if else case casez casex endcase default for while repeat forever generate endgenerate initial task endtask function endfunction signed unsigned and or not xor nand nor buf tri supply0 supply1 real time wait fork join disable package endpackage typedef enum struct union interface endinterface modport clocking endclocking property endproperty assert assume cover sequence endsequence',
};
const ALIASES = {
  'c++': 'cpp', py: 'python', javascript: 'js', java: 'cpp', cs: 'cpp',
  v: 'verilog', sv: 'verilog', systemverilog: 'verilog', vhdl: 'verilog',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function highlight(code, lang) {
  const key = ALIASES[(lang || '').toLowerCase()] || (lang || '').toLowerCase();
  const kw = KEYWORDS[key];
  const out = esc(code);
  if (!kw) return out;
  const kwRe = kw.trim().split(/\s+/).join('|');
  const lineComment = key === 'python' ? '#[^\\n]*' : '\\/\\/[^\\n]*';
  const directive = key === 'python' ? '' : '^[ \\t]*#[^\\n]*|';
  const re = new RegExp(
    '(\\/\\*[\\s\\S]*?\\*\\/|' + lineComment + ')'
    + '|(' + directive + '&quot;(?:\\\\.|[^&\\\\\\n]|&(?!quot;))*?&quot;|&#39;(?:\\\\.|[^&\\\\\\n]|&(?!#39;))*?&#39;)'
    + '|\\b(' + kwRe + ')\\b'
    + '|\\b(\\d+(?:\\.\\d+)?[fFuUlL]*)\\b'
    + '|\\b([A-Za-z_]\\w*)(?=\\s*\\()',
    'gm'
  );
  return out.replace(re, (m, comment, str, keyword, num, fn) => {
    if (comment) return '<span class="tk-com">' + comment + '</span>';
    if (str) return '<span class="tk-str">' + str + '</span>';
    if (keyword) return '<span class="tk-kw">' + keyword + '</span>';
    if (num) return '<span class="tk-num">' + num + '</span>';
    if (fn) return '<span class="tk-fn">' + fn + '</span>';
    return m;
  });
}

function renderMath(tex, display) {
  if (typeof katex === 'undefined') return '<code class="math-raw">' + esc(tex) + '</code>';
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false });
  } catch (err) {
    return '<code class="math-raw">' + esc(tex) + '</code>';
  }
}

const CALLOUTS = {
  'ipucu': { icon: 'bulb', cls: 'tip', title: 'İpucu' },
  'dikkat': { icon: 'alert', cls: 'warn', title: 'Dikkat' },
  'sınav': { icon: 'target', cls: 'exam', title: 'Sınavda çıkar' },
  'sinav': { icon: 'target', cls: 'exam', title: 'Sınavda çıkar' },
  'örnek': { icon: 'pencil', cls: 'note', title: 'Örnek' },
  'ornek': { icon: 'pencil', cls: 'note', title: 'Örnek' },
  'not': { icon: 'info', cls: 'note', title: 'Not' },
  'tanım': { icon: 'pin', cls: 'def', title: 'Tanım' },
  'tanim': { icon: 'pin', cls: 'def', title: 'Tanım' },
};

/** Markdown -> HTML */
export function md(src) {
  if (!src) return '';
  const slots = [];
  const stash = (html) => P0 + (slots.push(html) - 1) + P1;
  const restore = (s) => s.replace(new RegExp(P0 + '(\\d+)' + P1, 'g'), (_, n) => slots[+n]);

  let text = String(src).replace(/\r\n/g, '\n');

  // 1) Kod bloklari
  text = text.replace(/```([\w+#-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const l = (lang || '').trim();
    const body = code.replace(/\n$/, '');
    return stash(
      '<figure class="code"><figcaption><span>' + esc(l || 'kod') + '</span>'
      + '<button class="copy-btn" type="button" data-copy="' + esc(body) + '">Kopyala</button></figcaption>'
      + '<pre><code>' + highlight(body, l) + '</code></pre></figure>'
    );
  });

  // 2) Blok matematik
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stash('<div class="math-block">' + renderMath(tex.trim(), true) + '</div>'));

  // 3) Satir ici kod
  text = text.replace(/`([^`\n]+)`/g, (_, c) => stash('<code>' + esc(c) + '</code>'));

  // 4) Satir ici matematik.
  // Uzun satir ici formuller sarilamaz ve ekrani tasirir; onlari kaydirilabilir bir
  // kutuya alıyoruz. Kisa olanlar duz `inline` kalir ki metin hizasi bozulmasin.
  // Esik 40: 18.5px serif govde + kagit ic boslugunda telefonda (390px) ~42 karakter sigiyor.
  text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (m, pre, tex) => {
    const t = tex.trim();
    const html = renderMath(t, false);
    return pre + stash(t.length > 40 ? '<span class="math-long">' + html + '</span>' : html);
  });
  text = text.replace(/\\\$/g, '$');

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  const inline = (s) => restore(esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'));

  const blank = (s) => !s || !s.trim();
  const soloRe = new RegExp('^' + P0 + '(\\d+)' + P1 + '$');

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    const solo = line.trim().match(soloRe);
    if (solo) { out.push(slots[+solo[1]]); i++; continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(6, h[1].length + 1);
      out.push('<h' + lvl + '>' + inline(h[2].trim()) + '</h' + lvl + '>');
      i++; continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      let conf = { icon: 'quote', cls: 'note', title: 'Not' };
      let title = '';
      const tag = buf[0] && buf[0].match(/^\[!([^\]]+)\]\s*(.*)$/);
      if (tag) {
        conf = CALLOUTS[tag[1].toLowerCase().trim()] || { icon: 'quote', cls: 'note', title: tag[1] };
        title = tag[2].trim() || conf.title;
        buf[0] = '';
      }
      const inner = md(restore(buf.join('\n')));
      out.push('<div class="callout c-' + conf.cls + '"><div class="callout-h">' + conf.icon + ' ' + esc(title || conf.title) + '</div>' + inner + '</div>');
      continue;
    }

    // Tablo
    if (line.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] || '')) {
      // Hucre icinde dikey cizgi `\|` olarak kacislanabilir (orn. C'deki `|=` operatoru).
      const cells = (r) => r.trim()
        .replace(/^\|/, '').replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((a) => (a.startsWith(':') && a.endsWith(':') ? 'center' : a.endsWith(':') ? 'right' : 'left'));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) { rows.push(cells(lines[i])); i++; }
      const th = head.map((c, n) => '<th style="text-align:' + (aligns[n] || 'left') + '">' + inline(c) + '</th>').join('');
      const tb = rows.map((r) => '<tr>' + r.map((c, n) => '<td style="text-align:' + (aligns[n] || 'left') + '">' + inline(c) + '</td>').join('') + '</tr>').join('');
      out.push('<div class="table-wrap"><table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>');
      continue;
    }

    // Listeler
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const block = [];
      while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length))) {
        block.push(lines[i]); i++;
      }
      out.push(renderList(block, inline));
      continue;
    }

    // Paragraf
    const para = [];
    while (i < lines.length && !blank(lines[i])
           && !/^(#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i])
           && !soloRe.test(lines[i].trim())) { para.push(lines[i]); i++; }
    if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
    else i++;
  }

  return out.join('\n');
}

function renderList(block, inline) {
  const indentOf = (s) => s.match(/^\s*/)[0].length;
  const base = Math.min.apply(null, block.map(indentOf));
  const ordered = /^\s*\d+\./.test(block[0]);
  const items = [];
  let cur = null;
  for (const raw of block) {
    const ind = indentOf(raw);
    const m = raw.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (m && ind <= base + 1) {
      if (cur) items.push(cur);
      cur = { text: m[2], children: [] };
    } else if (cur) {
      cur.children.push(raw.slice(Math.min(ind, base + 2)));
    }
  }
  if (cur) items.push(cur);
  const tag = ordered ? 'ol' : 'ul';
  const html = items.map((it) => {
    const sub = it.children.length && /^\s*([-*+]|\d+\.)\s+/.test(it.children[0])
      ? renderList(it.children, inline)
      : it.children.filter((c) => c.trim()).map((c) => '<p>' + inline(c.trim()) + '</p>').join('');
    return '<li>' + inline(it.text) + sub + '</li>';
  }).join('');
  return '<' + tag + '>' + html + '</' + tag + '>';
}

/**
 * Tek paragraflik metinde <p> sarmalini atar, blok icerik (liste/tablo/kod) varsa
 * oldugu gibi birakir. Blok etiketi tasiyabildigi icin yalnizca BLOK baglamda
 * kullanilmali (orn. <div class="qtext">).
 */
export function mdInline(src) {
  const html = md(src || '');
  const only = html.match(/^<p>([\s\S]*)<\/p>$/);
  return only ? only[1] : html;
}

const BLOCK_TAG = /<(?:p|ul|ol|li|table|thead|tbody|tr|td|th|figure|pre|div|h[1-6]|blockquote|hr)\b/i;

/**
 * Kesin satir ici surum: <a>, <b>, <button> gibi satir ici kaplarin icine konacak metinler
 * icin. Bir <p> ya da <ul> satir ici kabin icine girdiginde tarayici HTML'i gecerli hale
 * getirmek ugruna etiketleri disa tasiyor (adoption agency): arama sonucunda <a> elemanlari
 * tek bir <p>'nin icine tasinip liste duzeni bozuluyordu. Bu yuzden paragraflar bosluga
 * indirilir; geride blok etiketi kalirsa bicimlendirmeden vazgecip duz metne duseriz —
 * bozuk DOM yerine sade metin.
 */
export function mdPhrase(src) {
  const text = String(src || '');
  const html = md(text)
    .replace(/<\/p>\s*<p>/g, ' ')
    .replace(/^<p>/, '')
    .replace(/<\/p>$/, '')
    .trim();
  if (BLOCK_TAG.test(html)) return esc(text.replace(/\s+/g, ' ').trim());
  return html;
}

export { esc };
