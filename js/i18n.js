(function () {
  "use strict";

  var STORAGE_KEY = "optirank-lang";
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1, SELECT: 1, OPTION: 1 };
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var originalText = [];
  var originalAttrs = [];
  var originalTitle = "";
  var captured = false;
  var current = "en";

  function dictFor(lang) {
    var all = window.OPTIRANK_I18N || {};
    return all[lang] || {};
  }

  function translate(text, lang) {
    if (!text || lang === "en") return text;
    var dict = dictFor(lang);
    if (dict[text]) return dict[text];
    return text;
  }

  function capture() {
    if (captured) return;
    captured = true;
    originalTitle = document.title;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || SKIP_TAGS[parent.tagName]) continue;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      originalText.push({ node: node, value: node.nodeValue });
    }
    document.querySelectorAll("*").forEach(function (el) {
      if (SKIP_TAGS[el.tagName]) return;
      ATTRS.forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        originalAttrs.push({ el: el, attr: attr, value: el.getAttribute(attr) });
      });
    });
  }

  function apply(lang) {
    capture();
    current = lang;
    document.documentElement.lang = lang;
    document.title = translate(originalTitle, lang);
    originalText.forEach(function (item) {
      var raw = item.value;
      var leading = raw.match(/^\s*/)[0];
      var trailing = raw.match(/\s*$/)[0];
      var core = raw.slice(leading.length, raw.length - trailing.length);
      item.node.nodeValue = leading + translate(core, lang) + trailing;
    });
    originalAttrs.forEach(function (item) {
      item.el.setAttribute(item.attr, translate(item.value, lang));
    });
    document.querySelectorAll(".lang").forEach(function (select) {
      select.value = lang;
    });
  }

  function readSaved() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && /^(en|de|fr|es)$/.test(saved)) return saved;
    } catch (e) {}
    return "en";
  }

  function save(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  function init() {
    apply(readSaved());
    document.querySelectorAll(".lang").forEach(function (select) {
      select.value = current;
      select.addEventListener("change", function () {
        var lang = select.value;
        save(lang);
        apply(lang);
      });
    });
  }

  window.OptiRankI18n = {
    t: function (text) { return translate(text, current); },
    apply: apply,
    init: init,
    lang: function () { return current; }
  };
})();
