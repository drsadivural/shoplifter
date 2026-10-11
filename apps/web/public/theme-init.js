// Apply the saved theme/language before first paint to avoid a light/dark flash.
(function () {
  try {
    var t = localStorage.getItem('rg.theme');
    if (t === 'light' || t === 'dark' || t === 'system') document.documentElement.setAttribute('data-theme', t);
    var l = localStorage.getItem('rg.locale');
    if (l === 'ja' || l === 'en') document.documentElement.setAttribute('lang', l);
  } catch (e) {
    /* storage unavailable: keep defaults */
  }
})();
