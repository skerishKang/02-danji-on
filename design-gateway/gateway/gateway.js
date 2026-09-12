/* DanjiOn design gateway landing renderer (#395). Fully relative, no network calls. */
(function () {
  'use strict';

  var STATUS_LABEL = {
    PRODUCTION: 'PRODUCTION',
    DESIGN_AUTHORITY: 'DESIGN_AUTHORITY',
    COMPARISON_ONLY: 'COMPARISON_ONLY',
    ARCHIVED: 'ARCHIVED'
  };
  var ORDER = ['PRODUCTION', 'DESIGN_AUTHORITY', 'COMPARISON_ONLY', 'ARCHIVED'];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function badge(container, kind, label) {
    container.appendChild(el('span', 'badge ' + kind, label || kind));
  }

  function metaList(container, term, value) {
    var dl = container.querySelector('dl.meta') || (function () {
      var created = el('dl', 'meta');
      container.appendChild(created);
      return created;
    })();
    dl.appendChild(el('dt', null, term));
    dl.appendChild(el('dd', null, value));
  }

  function card(version) {
    var node = el('article', 'card');
    node.appendChild(el('h2', null, version.name));
    node.appendChild(el('p', 'sub', '/' + version.id + '/ · ' + version.runtime));

    var badges = el('div', 'badges');
    badge(badges, STATUS_LABEL[version.status] ? version.status : 'ARCHIVED', version.status);
    if (version.frozen) badge(badges, 'FROZEN', 'FROZEN');
    else badge(badges, 'FROZEN', 'MUTABLE');
    if (version.doNotMerge) badge(badges, 'DO_NOT_MERGE', 'DO-NOT-MERGE');
    if (version.bundle.state === 'PENDING') badge(badges, 'PENDING', 'BUNDLE PENDING');
    else badge(badges, 'MOUNTED', version.bundle.mode === 'assembled' ? 'ASSEMBLED' : 'MOUNTED');
    node.appendChild(badges);

    metaList(node, 'VERSION_NAME', version.name);
    metaList(node, 'SOURCE_SHA', version.source.sha);
    metaList(node, 'SOURCE_REF', version.source.ref);
    metaList(node, 'SOURCE_PATH', version.source.path);
    metaList(node, 'STATUS', version.status);
    metaList(node, 'FROZEN', version.frozen ? 'YES' : 'NO');
    metaList(node, 'DO_NOT_MERGE', version.doNotMerge ? 'YES' : 'NO');
    metaList(node, 'CAPTURED_AT', version.source.capturedAt);

    var href = './' + encodeURIComponent(version.id) + '/' + version.bundle.entry
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    var link;
    if (version.bundle.state === 'READY') {
      link = el('a', 'open', '이 버전 열기 →');
      link.href = href;
    } else {
      link = el('span', 'open disabled', '프리뷰 번들 대기 중 (PENDING)');
    }
    node.appendChild(link);
    node.appendChild(el('p', 'muted', version.notes));
    return node;
  }

  fetch('./registry/versions.json', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('registry http ' + response.status);
      return response.json();
    })
    .then(function (registry) {
      var host = document.getElementById('cards');
      host.replaceChildren();
      var versions = registry.versions.slice().sort(function (a, b) {
        return ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
      });
      versions.forEach(function (version) {
        host.appendChild(card(version));
      });
    })
    .catch(function (error) {
      var host = document.getElementById('cards');
      host.replaceChildren(el('p', 'error', '레지스트리를 불러오지 못했습니다: ' + error.message));
    });
})();
