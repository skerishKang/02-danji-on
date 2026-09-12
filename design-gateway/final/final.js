/* DanjiOn FINAL surface metadata renderer (#401).
 * Reads the build-time provenance sidecar and shows it as a small,
 * non-dominating label. Fully relative; no absolute origins; no network calls
 * outside the same-origin sidecar. The sibling-facing presentation itself lives
 * in the authority iframe and is never altered here. */
(function () {
  function text(el, value) {
    var node = document.getElementById(el);
    if (node) node.textContent = value;
  }

  fetch('./FINAL_SOURCE.json', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('provenance unavailable')); })
    .then(function (p) {
      var short = (p.sha || '').slice(0, 7);
      text('final-meta', 'V3 current authority · frontend/ · ' + short + ' · 비운영');
    })
    .catch(function () {
      text('final-meta', '비운영 미리보기 · 출처 메타데이터를 불러오지 못했습니다');
    });
})();
