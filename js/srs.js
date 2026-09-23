// srs.js — SM-2 aralıklı tekrar algoritması (Anki'nin temeli).
// Kalite (q): 0 = hiç bilmedim, 3 = zor hatırladım, 4 = hatırladım, 5 = çok kolay.

const DAY = 86400000;

export const GRADES = [
  { q: 0, label: 'Bilmiyorum', hint: 'Baştan', cls: 'g-again' },
  { q: 3, label: 'Zor', hint: 'Zorlandım', cls: 'g-hard' },
  { q: 4, label: 'İyi', hint: 'Hatırladım', cls: 'g-good' },
  { q: 5, label: 'Kolay', hint: 'Çok kolay', cls: 'g-easy' },
];

export function newCard() {
  return { ef: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, lastAt: 0 };
}

/** SM-2 güncellemesi. Saf fonksiyon — yeni kart durumu döner. */
export function review(card, q, now = Date.now()) {
  const c = { ...newCard(), ...card };
  if (q < 3) {
    c.reps = 0;
    c.lapses += 1;
    c.interval = 0;
    c.due = now + 10 * 60 * 1000; // 10 dk sonra tekrar
  } else {
    c.reps += 1;
    if (c.reps === 1) c.interval = 1;
    else if (c.reps === 2) c.interval = 6;
    else c.interval = Math.round(c.interval * c.ef);
    c.due = now + c.interval * DAY;
  }
  // Kolaylık faktörü güncellemesi (SM-2 formülü), alt sınır 1.3.
  // DIKKAT: özgün SM-2'de kolaylık faktörü YALNIZCA q >= 3 iken güncellenir; başarısız
  // tekrarda kart baştan başlar ama faktör korunur. Bu koşul eskiden yoktu ve faktör her
  // derecede güncelleniyordu: q=0 tek seferde -0,80 düşürüyor, iki başarısızlık faktörü
  // 1,3 tabanına çakıyor ve oradan 2,5'e dönmek 12 kusursuz tekrar gerektiriyordu. Yani
  // dönem başında iki kez takılınan bir kart, sonradan iyi bilinse bile aylarca kısa
  // aralıklarla önüne çıkmaya devam ediyordu. Kartın zorluğunu, başarısızlığın kendisi
  // değil, yeniden öğrendikten sonra verilen derece belirler.
  if (q >= 3) {
    c.ef = Math.max(1.3, c.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }
  c.lastAt = now;
  return c;
}

/** Zamanı gelmiş + hiç çalışılmamış kartları sıraya dizer. */
export function buildQueue(allCards, srsState, { newPerDay = 20, now = Date.now() } = {}) {
  const due = [];
  const fresh = [];
  for (const card of allCards) {
    const st = srsState[card.id];
    if (!st || !st.reps) fresh.push(card);
    else if (st.due <= now) due.push({ card, due: st.due });
  }
  due.sort((a, b) => a.due - b.due);
  return [...due.map((d) => d.card), ...fresh.slice(0, newPerDay)];
}

export function dueCount(allCards, srsState, now = Date.now()) {
  let due = 0;
  let fresh = 0;
  for (const card of allCards) {
    const st = srsState[card.id];
    if (!st || !st.reps) fresh += 1;
    else if (st.due <= now) due += 1;
  }
  return { due, fresh, total: due + fresh };
}

export function formatInterval(card) {
  if (!card || !card.reps) return 'yeni';
  if (card.interval === 0) return '10 dk';
  if (card.interval === 1) return '1 gün';
  if (card.interval < 30) return `${card.interval} gün`;
  return `${Math.round(card.interval / 30)} ay`;
}

/** Bir sonraki aralığın önizlemesi (butonların altında gösterilir). */
export function previewInterval(card, q) {
  return formatInterval(review(card, q));
}
