// syncmerge.js — iki cihazın durumunu kayıpsız birleştirme kuralları.
//
// Saf fonksiyonlar: tarayıcıya, Firebase'e ya da store'a dokunmaz; bu yüzden Node'da
// doğrudan test edilir (tools/test-sync.mjs).
//
// Temel fikir: yerel durum her zaman gerçek kaynaktır (uygulama çevrimdışı çalışır).
// Buluttaki kopya ile yerel kopya anahtar anahtar birleştirilir:
//
//   - Birikimli veriler (ilerleme, kart tekrarları, cevaplar, çalışma günleri, sınavlar,
//     seri) BİRLEŞİM ile birleşir: iki cihazda yapılan her şey korunur. Aynı kayıt iki
//     tarafta varsa daha yeni olan (lastAt / at) kazanır. Birleştirme sıradan bağımsızdır
//     ve tekrar tekrar uygulanabilir — eşitleme kaç kez çalışırsa çalışsın sonuç aynıdır.
//
//   - Tercih niteliğindeki veriler (ayarlar, notlar, yer imleri, dersler, notlar, transkript)
//     SON YAZAN KAZANIR ile birleşir; anahtarın en son değiştiği zaman (`at`) karşılaştırılır.
//     Birleşim burada yanlış olurdu: silinen yer imi diğer cihazdan geri gelirdi.
//
//   - Sıfırlama: birikimli veride birleşim, silinen kaydı diğer cihazdan geri getirir.
//     Bu yüzden her anahtarın bir `base` (sıfırlama anı) değeri var; o andan eski kayıtlar
//     iki taraftan da atılır. Sıfırlama böylece bütün cihazlara yayılır.

/** Birleşimle birleşen anahtarlar; geri kalanı "son yazan kazanır". */
export const ACCUMULATIVE = ['progress', 'srs', 'answers', 'sessions', 'examHistory', 'streak'];

/** Buluta yazılmayan anahtarlar. */
export const LOCAL_ONLY = ['schema'];

const MAX_ANSWERS = 2000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const dayStart = (day) => new Date(`${day}T00:00:00`).getTime();
const dayOf = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------------------------------------------------------------- budama (sıfırlama)

/** `base` anından eski kayıtları atar. base 0 ise değer olduğu gibi döner. */
export function prune(key, v, base) {
  if (!base || v == null) return v;
  switch (key) {
    case 'progress': {
      const out = {};
      for (const [code, topics] of Object.entries(v)) {
        const kept = Object.fromEntries(Object.entries(topics || {}).filter(([, t]) => (t?.lastAt || 0) >= base));
        if (Object.keys(kept).length) out[code] = kept;
      }
      return out;
    }
    case 'srs':
      return Object.fromEntries(Object.entries(v).filter(([, c]) => (c?.lastAt || 0) >= base));
    case 'answers':
    case 'examHistory':
      return (Array.isArray(v) ? v : []).filter((x) => (x?.at || 0) >= base);
    case 'sessions':
      // Gün çözünürlüğü: sıfırlamanın yapıldığı gün korunur, öncekiler atılır.
      return Object.fromEntries(Object.entries(v).filter(([day]) => dayStart(day) >= dayStart(dayOf(base))));
    case 'streak':
      return v.lastDay && dayStart(v.lastDay) < dayStart(dayOf(base)) ? null : v;
    default:
      return v;
  }
}

// ---------------------------------------------------------------- birleştiriciler

function mergeProgress(a = {}, b = {}) {
  const out = {};
  for (const code of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const A = a?.[code] || {};
    const B = b?.[code] || {};
    const topics = {};
    for (const t of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[t];
      const y = B[t];
      if (!x || !y) { topics[t] = x || y; continue; }
      const newer = (y.lastAt || 0) > (x.lastAt || 0) ? y : x;
      const older = newer === x ? y : x;
      const merged = { ...older, ...newer, lastAt: Math.max(x.lastAt || 0, y.lastAt || 0) };
      // Alanlar yalnızca bir tarafta varsa eklenir: yoksa "bestScore: 0" gibi yeni alanlar
      // her eşitlemede belgeyi "değişmiş" gösterir ve boşuna yazma yapılır.
      // "okundu" bir tercih: daha yeni değişiklik kazanır (işareti kaldırmak da geçerli).
      if ('read' in x || 'read' in y) merged.read = !!newer.read;
      // Skor ve deneme birikimli: hangi cihazda elde edildiyse korunur.
      if ('bestScore' in x || 'bestScore' in y) merged.bestScore = Math.max(x.bestScore || 0, y.bestScore || 0);
      if ('attempts' in x || 'attempts' in y) merged.attempts = Math.max(x.attempts || 0, y.attempts || 0);
      topics[t] = merged;
    }
    if (Object.keys(topics).length) out[code] = topics;
  }
  return out;
}

function mergeSrs(a = {}, b = {}) {
  const out = { ...(a || {}) };
  for (const [id, card] of Object.entries(b || {})) {
    const mine = out[id];
    const ta = mine ? (mine.lastAt || mine.due || 0) : -1;
    const tb = card ? (card.lastAt || card.due || 0) : -1;
    if (!mine || tb > ta) out[id] = card;
  }
  return out;
}

function answerKey(x) {
  return `${x?.at || 0}|${x?.qid ?? x?.id ?? x?.q ?? ''}|${x?.code ?? ''}`;
}

function mergeAnswers(a = [], b = []) {
  const seen = new Map();
  for (const x of [...(a || []), ...(b || [])]) if (x) seen.set(answerKey(x), x);
  return [...seen.values()].sort((p, q) => (p.at || 0) - (q.at || 0)).slice(-MAX_ANSWERS);
}

function mergeExams(a = [], b = []) {
  const seen = new Map();
  for (const x of [...(a || []), ...(b || [])]) if (x) seen.set(`${x.at || 0}|${x.code ?? ''}|${x.scope ?? ''}`, x);
  return [...seen.values()].sort((p, q) => (p.at || 0) - (q.at || 0));
}

function mergeSessions(a = {}, b = {}) {
  // Aynı gün iki cihazda çalışılmışsa toplamı bilemeyiz (hangi dakika hangi cihazda sayıldı
  // belli değil); her alanın büyüğünü almak tekrar eşitlemede şişmeyi önler.
  const out = {};
  for (const day of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[day] || {};
    const y = b?.[day] || {};
    out[day] = {
      minutes: Math.max(x.minutes || 0, y.minutes || 0),
      questions: Math.max(x.questions || 0, y.questions || 0),
      correct: Math.max(x.correct || 0, y.correct || 0),
    };
  }
  return out;
}

function mergeStreak(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const later = (b.lastDay || '') > (a.lastDay || '') ? b : a;
  return { ...later, best: Math.max(a.best || 0, b.best || 0, later.current || 0) };
}

const MERGERS = {
  progress: mergeProgress,
  srs: mergeSrs,
  answers: mergeAnswers,
  sessions: mergeSessions,
  examHistory: mergeExams,
  streak: mergeStreak,
};

// ---------------------------------------------------------------- anahtar birleştirme

/**
 * Bir anahtarın yerel ve bulut kopyasını birleştirir.
 * local/remote = { v, at, base } — remote yoksa null.
 * Dönüş: { v, at, base }
 */
export function mergeKey(key, local, remote) {
  const L = local || { v: undefined, at: 0, base: 0 };
  if (!remote) return { v: L.v, at: L.at || 0, base: L.base || 0 };
  const base = Math.max(L.base || 0, remote.base || 0);
  const at = Math.max(L.at || 0, remote.at || 0);

  if (MERGERS[key]) {
    const merged = MERGERS[key](prune(key, L.v, base), prune(key, remote.v, base));
    return { v: merged, at, base };
  }
  // Son yazan kazanır. Eşitlikte yerel kalır (gereksiz yazma olmasın) — ama yerelde hiç
  // değiştirilmemiş (at = 0) bir değer buluttakine her zaman yol verir: yeni cihazın
  // varsayılan ayarları, hesaptaki gerçek ayarları ezmemeli.
  const remoteWins = (remote.at || 0) > (L.at || 0) || !L.at;
  const winner = remoteWins ? remote : L;
  return { v: winner.v, at: winner.at || 0, base };
}

/**
 * Tüm durumu birleştirir.
 * localState: store.state
 * meta: { at: {key: ms}, base: {key: ms} }  — yerel değişiklik ve sıfırlama zamanları
 * remote: { key: { v, at, base } }          — buluttan okunan
 * Dönüş: { state, meta } — birleşmiş durum ve yeni zaman bilgisi
 */
export function mergeState(localState, meta, remote) {
  const state = { ...localState };
  const next = { at: { ...(meta?.at || {}) }, base: { ...(meta?.base || {}) } };
  const keys = new Set([...Object.keys(localState || {}), ...Object.keys(remote || {})]);
  for (const key of keys) {
    if (LOCAL_ONLY.includes(key)) continue;
    const r = mergeKey(key, { v: localState?.[key], at: meta?.at?.[key] || 0, base: meta?.base?.[key] || 0 }, remote?.[key]);
    if (r.v !== undefined) state[key] = r.v;
    next.at[key] = r.at;
    next.base[key] = r.base;
  }
  return { state, meta: next };
}

// ---------------------------------------------------------------- belge düzeni

/**
 * Durumu bulut belgelerine böler. Firestore'da belge başına 1 MiB sınırı var; kart
 * tekrarları tüm dersler çalışılınca bu sınırı aşabileceği için ders koduna göre parçalanır
 * (kart kimliği "KAM101/w1/c0" biçiminde).
 * Dönüş: { docId: { key, v, at, base } }
 */
export function splitDocs(state, meta) {
  const docs = {};
  for (const [key, v] of Object.entries(state || {})) {
    if (LOCAL_ONLY.includes(key) || v === undefined) continue;
    const at = meta?.at?.[key] || 0;
    const base = meta?.base?.[key] || 0;
    if (key === 'srs') {
      const shards = {};
      for (const [id, card] of Object.entries(v || {})) {
        const code = String(id).split('/')[0] || '_';
        (shards[code] ||= {})[id] = card;
      }
      for (const [code, part] of Object.entries(shards)) docs[`srs~${code}`] = { key, v: part, at, base };
      // Parça yoksa (hiç kart çalışılmamış ya da sıfırlanmış) sıfırlama bilgisini taşıyan boş belge.
      docs['srs~_meta'] = { key, v: {}, at, base };
    } else {
      docs[key] = { key, v, at, base };
    }
  }
  return docs;
}

/** Bulut belgelerini anahtarlara geri toplar (splitDocs'un tersi). */
export function joinDocs(docs) {
  const out = {};
  for (const [docId, d] of Object.entries(docs || {})) {
    const key = docId.startsWith('srs~') ? 'srs' : docId;
    const cur = out[key];
    if (key === 'srs') {
      out.srs = {
        v: { ...(cur?.v || {}), ...(d.v || {}) },
        at: Math.max(cur?.at || 0, d.at || 0),
        base: Math.max(cur?.base || 0, d.base || 0),
      };
    } else {
      out[key] = { v: d.v, at: d.at || 0, base: d.base || 0 };
    }
  }
  return out;
}

/** Kısa, kararlı özet — değişmeyen belgeyi tekrar yazmamak için. (FNV-1a 32 bit) */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + str.length;
}

/** Değer "boş" mu — birikimli anahtarda doludan boşa geçiş sıfırlama demektir. */
export function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return Object.keys(v).length === 0;
  return false;
}
