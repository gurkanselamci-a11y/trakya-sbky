// attachments.js — konulara eklenen dosyalar (PDF, Word, Excel, resim).
//
// NEDEN IndexedDB: uygulamanın tüm durumu localStorage'da tek bir JSON kaydında duruyor ve
// tarayıcılar localStorage'a ~5 MB tanıyor. Tek bir ders notu PDF'i bu sınırı aşar; üstelik
// store.js kota dolduğunda cevap geçmişini kırparak yer açıyor — dosyaları oraya koymak
// öğrencinin ilerlemesini sessizce sildirirdi. IndexedDB ikili veriyi (Blob) doğrudan tutar,
// kotası diskle orantılıdır ve çevrimdışı da çalışır.
//
// Dosyalar YALNIZCA bu cihazda durur: ne bulut eşitlemesine ne de "Yedek al" JSON'una girer
// (ikisi de metin durumu taşır; megabaytlarca dosya taşımak için tasarlanmadılar). Arayüz
// bunu kullanıcıya açıkça söyler.

const DB_NAME = 'tusbky-files';
const STORE = 'files';

/** Tek dosya üst sınırı. Telefon depolamasını tek bir dosyanın doldurmasını önler. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Kabul edilen türler: uzantı → görünen tür. `accept` özniteliği de buradan üretilir. */
const TYPES = {
  pdf: 'PDF',
  doc: 'Word', docx: 'Word',
  xls: 'Excel', xlsx: 'Excel', csv: 'Excel',
  jpg: 'Resim', jpeg: 'Resim', png: 'Resim', webp: 'Resim', heic: 'Resim', gif: 'Resim',
};
export const ACCEPT = Object.keys(TYPES).map((e) => '.' + e).join(',') + ',image/*';

export const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
export const kindOf = (name, mime = '') => TYPES[extOf(name)] || (String(mime).startsWith('image/') ? 'Resim' : null);

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Bu tarayıcı dosya saklamayı desteklemiyor')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('topic', 'topic', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Dosya deposu açılamadı'));
    });
    dbPromise.catch(() => { dbPromise = null; }); // bir sonraki denemede yeniden açmayı dene
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
  }));
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/**
 * Konuya dosya ekler. Geçersiz tür ya da büyük dosya reddedilir; eklenenler ve
 * reddedilenler ayrı döner ki arayüz ikisini de bildirebilsin.
 */
export async function addFiles(topicKey, fileList) {
  const added = [];
  const rejected = [];
  const rows = [];
  for (const f of Array.from(fileList || [])) {
    const kind = kindOf(f.name, f.type);
    if (!kind) { rejected.push({ name: f.name, why: 'desteklenmeyen tür' }); continue; }
    if (f.size > MAX_FILE_BYTES) { rejected.push({ name: f.name, why: `${fmtSize(MAX_FILE_BYTES)} sınırını aşıyor` }); continue; }
    const row = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      topic: topicKey,
      name: f.name,
      type: f.type || '',
      kind,
      size: f.size,
      at: Date.now(),
      blob: f,
    };
    rows.push(row);
  }
  if (rows.length) {
    await tx('readwrite', (s) => { rows.forEach((r) => s.put(r)); });
    rows.forEach(({ blob, ...meta }) => added.push(meta));
    askPersistence();
  }
  return { added, rejected };
}

/** Konunun dosyaları, eklenme sırasına göre (Blob'suz — liste hafif kalsın). */
export async function listFiles(topicKey) {
  const rows = await tx('readonly', (s) => req2p(s.index('topic').getAll(topicKey)));
  return (rows || []).map(({ blob, ...meta }) => meta).sort((a, b) => a.at - b.at);
}

export async function getFile(id) {
  return tx('readonly', (s) => req2p(s.get(id)));
}

export async function removeFile(id) {
  return tx('readwrite', (s) => { s.delete(id); });
}

/** Tüm dosyaların sayısı ve toplam boyutu — Ayarlar/Notlarım gibi özet ekranlar için. */
export async function usage() {
  const rows = await tx('readonly', (s) => req2p(s.getAll()));
  return { count: rows.length, bytes: rows.reduce((a, r) => a + (r.size || 0), 0) };
}

/**
 * Tarayıcıdan kalıcı depolama iste. İstenmezse tarayıcı disk daralınca site verisini
 * (dolayısıyla öğrencinin eklediği notları) uyarı vermeden silebilir.
 */
let persistAsked = false;
function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage?.persist?.(); } catch (_) { /* desteklenmiyorsa sorun değil */ }
}

export function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB';
}
