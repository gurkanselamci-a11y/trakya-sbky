// firebase-config.js — Firebase projesinin web yapılandırması.
//
// Bu değerler GİZLİ DEĞİLDİR: her Firebase web uygulamasında tarayıcıya açıkça gönderilir.
// Verileri koruyan şey anahtar değil, Firestore güvenlik kurallarıdır (firestore.rules).
//
// null bırakılırsa hesap sistemi kapalı kalır ve uygulama eskisi gibi yalnızca bu cihazda
// çalışır. Kurulum adımları: docs/FIREBASE-KURULUM.md
//
// TÜ SBKY sürümü için henüz Firebase projesi açılmadı — hesap/eşitleme kapalı.
// Siteye yüklerken buraya yeni projenin değerleri yazılacak (KKÜ projesinden BAĞIMSIZ olmalı).

export const firebaseConfig = null;

// AKTS düzeltmelerini yapabilen hesaplar. Güvenlik kuralı (firestore.rules) da aynı listeyi
// kullanır; burası yalnızca düzenleme ekranını göstermek için. İkisi birlikte güncellenmeli.
export const ADMIN_EMAILS = ['gurkanselamci@gmail.com'];
