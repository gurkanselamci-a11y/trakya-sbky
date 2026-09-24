// firebase-config.js — Firebase projesinin web yapılandırması.
//
// Bu değerler GİZLİ DEĞİLDİR: her Firebase web uygulamasında tarayıcıya açıkça gönderilir.
// Verileri koruyan şey anahtar değil, Firestore güvenlik kurallarıdır (firestore.rules).
//
// null bırakılırsa hesap sistemi kapalı kalır ve uygulama eskisi gibi yalnızca bu cihazda
// çalışır. Kurulum adımları: docs/FIREBASE-KURULUM.md
//
export const firebaseConfig = {
  apiKey: 'AIzaSyCCZLbDXrGvRumAb1oW94o8_jZMJNe3TN4',
  authDomain: 'tu-sbky-qievly.firebaseapp.com',
  projectId: 'tu-sbky-qievly',
  storageBucket: 'tu-sbky-qievly.firebasestorage.app',
  messagingSenderId: '519954614635',
  appId: '1:519954614635:web:b83c9d2116d64d5028642e',
};

// AKTS düzeltmelerini yapabilen hesaplar. Güvenlik kuralı (firestore.rules) da aynı listeyi
// kullanır; burası yalnızca düzenleme ekranını göstermek için. İkisi birlikte güncellenmeli.
export const ADMIN_EMAILS = ['gurkanselamci@gmail.com'];
