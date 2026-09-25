(function () {
  "use strict";

  function hashString(value) {
    var str = String(value || "");
    var hash = 0;
    for (var i = 0; i < str.length; i += 1) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function seeded(seed, min, max) {
    var span = max - min + 1;
    var value = Math.abs(Math.trunc(Number(seed) || 0)) % span;
    return min + value;
  }

  function cleanHost(value) {
    var text = String(value || "").trim();
    try {
      return new URL(text.indexOf("http") === 0 ? text : "https://" + text).hostname || "example.com";
    } catch (error) {
      return text.replace(/[^a-z0-9.-]/gi, "") || "example.com";
    }
  }

  function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  var DEMO_NOTE = "Demo data (static build). Deploy the Node backend for live results.";

  function demoAudit(url) {
    var host = cleanHost(url);
    return {
      url: url,
      host: host,
      generatedAt: new Date().toISOString(),
      mode: "demo",
      note: DEMO_NOTE,
      score: 82,
      checks: [
        { id: "canonical", label: "Canonical URL", status: "pass", detail: "Canonical tag present and self-referencing on " + host },
        { id: "title", label: "Meta title", status: "pass", detail: "Unique title found, 54 characters" },
        { id: "description", label: "Meta description", status: "warn", detail: "Description found but 168 characters, trim below 160" },
        { id: "redirects", label: "Redirects", status: "pass", detail: "No redirect chains detected" },
        { id: "internal-links", label: "Internal links", status: "pass", detail: "142 internal links, 0 broken" },
        { id: "privacy", label: "Privacy policy page", status: "warn", detail: "Privacy page found, not linked in the footer" },
        { id: "terms", label: "Terms and conditions page", status: "warn", detail: "Terms page found, not linked in the footer" },
        { id: "robots", label: "robots.txt", status: "pass", detail: "robots.txt reachable and declares a sitemap" },
        { id: "sitemap", label: "XML sitemap", status: "pass", detail: "sitemap.xml reachable and valid" },
        { id: "h1", label: "H1 heading", status: "pass", detail: "Exactly one H1 found" }
      ]
    };
  }

  function demoRankTracker(payload) {
    var host = cleanHost(payload.url);
    var keyword = String(payload.keyword || "").trim();
    var engines = ["Google", "Google", "Google", "Bing", "Google", "Bing"];
    var devices = ["Desktop", "Mobile", "Mobile", "Desktop", "Desktop", "Mobile"];
    var locations = ["United States", "United Kingdom", "Germany", "India", "Canada", "Australia"];
    var rows = engines.map(function (engine, index) {
      var seed = hashString(keyword + ":" + index);
      var position = seeded(seed, 1, 42);
      var change = seeded(seed >>> 3, -4, 6);
      return [keyword, engine, devices[index], locations[index], "#" + position, change > 0 ? "+" + change : String(change)];
    });
    return {
      tool: "rank-tracker",
      title: "Rank tracking preview",
      summary: "Tracked " + rows.length + " positions for \"" + keyword + "\" on " + host + ".",
      columns: ["Keyword", "Engine", "Device", "Location", "Position", "Change"],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoKeywordResearch(payload) {
    var keyword = String(payload.keyword || "").trim();
    var variants = [keyword, "best " + keyword, keyword + " tools", "free " + keyword, keyword + " for beginners", keyword + " alternatives", keyword + " pricing", "how to " + keyword];
    var intents = ["Commercial", "Commercial", "Commercial", "Informational", "Informational", "Commercial", "Transactional", "Informational"];
    var rows = variants.map(function (variant, index) {
      var seed = hashString(variant);
      var cpc = (seeded(seed >>> 8, 1, 45) / 10).toFixed(2);
      return [variant, formatNumber(seeded(seed, 320, 24000)), seeded(seed >>> 4, 12, 78), "$" + cpc, intents[index]];
    });
    return {
      tool: "keyword-research",
      title: "Keyword ideas",
      summary: rows.length + " keyword ideas for \"" + keyword + "\".",
      columns: ["Keyword", "Volume", "Difficulty", "CPC", "Intent"],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoOnPage(payload) {
    var url = String(payload.url || "").trim();
    var host = cleanHost(url);
    var seed = hashString(url);
    var score = seeded(seed, 62, 96);
    var rows = [
      ["Title tag", score > 80 ? "Good" : "Improve", "Keep titles between 45 and 60 characters."],
      ["Meta description", seeded(seed, 0, 1) ? "Good" : "Too long", "Trim descriptions below 160 characters."],
      ["H1 heading", "Good", "Exactly one H1 found on the page."],
      ["Word count", formatNumber(seeded(seed >>> 2, 420, 1900)) + " words", "Aim for 800+ words on competitive pages."],
      ["Image alt text", seeded(seed >>> 3, 0, 3) === 0 ? "Missing" : "Good", "Add descriptive alt text to every image."],
      ["Internal links", seeded(seed >>> 5, 6, 42) + " links", "Add 2-3 internal links to related pages."],
      ["Page load", (seeded(seed >>> 6, 12, 38) / 10).toFixed(1) + "s", "Target under 2.5s on mobile."]
    ];
    return {
      tool: "on-page-checker",
      title: "On-page score",
      summary: "On-page score " + score + "/100 for " + host + ".",
      columns: ["Element", "Status", "Recommendation"],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoBacklink(payload) {
    var host = cleanHost(payload.url);
    var seed = hashString(host);
    var domains = seeded(seed, 180, 4200);
    var backlinks = domains * seeded(seed >>> 4, 8, 22);
    var sources = ["techcrunch.com", "searchengineland.com", "moz.com", "hubspot.com", "backlinko.com", "neilpatel.com"];
    var anchors = ["natural anchor", "brand name", "exact match", "URL anchor", "naked link", "generic phrase"];
    var types = ["Dofollow", "Dofollow", "Nofollow", "Dofollow", "Nofollow", "Dofollow"];
    var rows = sources.map(function (source, index) {
      var s = hashString(host + ":" + source);
      return [source, anchors[index], seeded(s, 45, 94), types[index], "$" + formatNumber(seeded(s >>> 3, 40, 980))];
    });
    return {
      tool: "backlink-checker",
      title: "Backlink profile",
      summary: formatNumber(backlinks) + " backlinks from " + formatNumber(domains) + " referring domains for " + host + ".",
      columns: ["Referring domain", "Anchor text", "Authority", "Type", "Value"],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoCompetitor(payload) {
    var host = cleanHost(payload.url);
    var rival = cleanHost(payload.competitor);
    var seed = hashString(host + ":" + rival);
    var metrics = ["Organic keywords", "Organic traffic", "Backlinks", "Referring domains", "Paid keywords", "Domain authority"];
    var rows = metrics.map(function (metric) {
      var s = hashString(metric + ":" + seed);
      return [metric, formatNumber(seeded(s, 1200, 92000)), formatNumber(seeded(s >>> 3, 1200, 92000))];
    });
    return {
      tool: "competitor-analysis",
      title: "Competitor overview",
      summary: "Side-by-side organic and paid metrics for " + host + " and " + rival + ".",
      columns: ["Metric", host, rival],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoAiVisibility(payload) {
    var brand = String(payload.brand || "").trim();
    var engines = ["Google AI Overviews", "ChatGPT", "Gemini", "Perplexity", "Microsoft Copilot"];
    var sentiments = ["Positive", "Positive", "Neutral", "Positive", "Neutral"];
    var rows = engines.map(function (engine, index) {
      var seed = hashString(brand + ":" + engine);
      var mentions = seeded(seed, 12, 480);
      var share = (seeded(seed >>> 3, 40, 380) / 10).toFixed(1);
      return [engine, formatNumber(mentions), sentiments[index], share + "%"];
    });
    return {
      tool: "ai-visibility",
      title: "AI share of voice",
      summary: "Brand mentions and sentiment for \"" + brand + "\" across " + rows.length + " AI engines.",
      columns: ["AI engine", "Mentions", "Sentiment", "Share of voice"],
      rows: rows,
      note: DEMO_NOTE
    };
  }

  function demoTool(tool, payload) {
    if (tool === "rank-tracker") return demoRankTracker(payload);
    if (tool === "keyword-research") return demoKeywordResearch(payload);
    if (tool === "on-page-checker") return demoOnPage(payload);
    if (tool === "backlink-checker") return demoBacklink(payload);
    if (tool === "competitor-analysis") return demoCompetitor(payload);
    if (tool === "ai-visibility") return demoAiVisibility(payload);
    return null;
  }

  function handle(endpoint, payload) {
    return new Promise(function (resolve, reject) {
      var body = payload || {};
      if (endpoint === "/api/audit") return resolve(demoAudit(String(body.url || "")));
      if (endpoint === "/api/tool") {
        var result = demoTool(String(body.tool || ""), body);
        if (result) return resolve(result);
        return reject(new Error("Unknown tool"));
      }
      if (endpoint === "/api/subscribe") return resolve({ status: "subscribed", message: String(body.email || "") + " is subscribed." });
      if (endpoint === "/api/contact") return resolve({ status: "received", message: "Thanks, our team will reply within one business day." });
      reject(new Error("Unsupported endpoint"));
    });
  }

  window.OptirankDemo = { handle: handle };
})();
