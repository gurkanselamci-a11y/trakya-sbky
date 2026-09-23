// icons.js — arayuz simgeleri. Semboller index.html icindeki <svg class="sprite"> blogunda
// tanimli; burasi yalnizca onlara referans veren minik bir sarmalayici.
// Kullanim:  ico('search')            -> satir ici simge
//            ico('trophy', 'ico-lg')  -> buyuk gosterim

export const ico = (name, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
