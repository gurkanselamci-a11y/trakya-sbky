// ui.js — küçük yardımcılar.

import { ico } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let toastTimer = null;
export function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function progressBar(pct, color) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `<div class="bar"${color ? ` style="--c:${color}"` : ''}><i style="width:${p}%"></i></div>`;
}

export function ring(pct, size = 54, label = '') {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `<div class="goal-ring" style="background:conic-gradient(var(--acc) ${p * 3.6}deg, var(--surface-2) 0)">
    <span style="background:var(--bg);width:${size - 14}px;height:${size - 14}px;border-radius:50%;display:grid;place-content:center">${label || p + '%'}</span>
  </div>`;
}

export function fmtMin(min) {
  const m = Math.round(min || 0);
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  return `${h} sa ${m % 60} dk`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Bos durum kutusu. `icon` bir simge kimligidir (bkz. js/icons.js), emoji degil. */
export function empty(icon, title, sub, action = '') {
  return `<div class="empty"><div class="e-ico">${ico(icon)}</div><b>${escHtml(title)}</b>
    ${sub ? `<p class="small">${escHtml(sub)}</p>` : ''}${action}</div>`;
}

/** Sayfadaki "Kopyala" düğmelerini bağlar. */
export function bindCopy(root) {
  $$('.copy-btn', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        toast('Kod kopyalandı');
      } catch { toast('Kopyalanamadı'); }
    });
  });
}

/**
 * Satırından geniş satır içi formülleri kaydırılabilir `.math-long` kutusuna alır.
 * md.js bunu TeX uzunluğundan tahmin eder, ama gerçek genişlik puntoya, ekrana ve
 * formülün içeriğine bağlı: "1, 3, 5, …" gibi virgüllü diziler kısa görünüp KaTeX
 * tarafından bölünemez ve telefonda sayfayı yana kaydırır. Burada gerçekten ölçülür.
 * Tek yönlüdür; kutu, formül sığdığında düz satır içi gibi görünür.
 */
export function fitMath(root = document) {
  const wide = [];
  for (const k of root.querySelectorAll('.katex')) {
    if (k.closest('.katex-display, .math-long, .table-wrap')) continue;
    let host = k.parentElement;
    while (host && getComputedStyle(host).display.startsWith('inline')) host = host.parentElement;
    if (!host || !host.clientWidth) continue;               // DOM'da değil / gizli
    const cs = getComputedStyle(host);
    const avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (k.getBoundingClientRect().width > avail + 1) wide.push(k);
  }
  // Önce hepsini ölç, sonra yaz — okuma/yazma iç içe olursa her adımda yeniden yerleşim hesaplanır.
  for (const k of wide) {
    const box = document.createElement('span');
    box.className = 'math-long';
    k.replaceWith(box);
    box.appendChild(k);
  }
}

// KaTeX yazı tipleri geç inerse ya da ekran döner/daralırsa genişlikler değişir.
let fitTimer = null;
const refit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitMath(), 150); };
addEventListener('resize', refit);
document.fonts?.addEventListener?.('loadingdone', refit);

/** Basit onay kutusu (native confirm — PWA'da yeterli). */
export function confirmAction(msg) { return window.confirm(msg); }
