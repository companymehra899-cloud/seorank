const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8000);
const ENDPOINTS = require("./endpoints.json");
const LIVE = require("./live");
const SERPER = require("./serper");
require("./env")();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8"
};

function loadRedirects() {
  const file = path.join(ROOT, "_redirects");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(/\s+/);
      return { from: parts[0], to: parts[1], code: Number(parts[2] || 301) };
    });
}

const REDIRECTS = loadRedirects();

function injectIncludes(html) {
  return html.replace(/<!--#include\s+([a-zA-Z0-9_-]+)\s*-->/g, (match, name) => {
    const partial = path.join(ROOT, "partials", `${name}.html`);
    if (!fs.existsSync(partial)) return match;
    return fs.readFileSync(partial, "utf8");
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function parseBody(req, raw) {
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }
  const out = {};
  new URLSearchParams(raw).forEach((value, key) => { out[key] = value; });
  return out;
}

function findRedirect(pathname) {
  for (const rule of REDIRECTS) {
    if (rule.from === "/*") continue;
    if (rule.from === pathname) return rule;
    if (rule.from.endsWith("/*") && pathname.startsWith(rule.from.slice(0, -1)) && !rule.to.includes("*")) {
      return rule;
    }
  }
  return null;
}

const PLANS = [
  { id: "core", name: "Core", priceMonthly: 129, priceAnnual: 103.2, projects: 10, keywords: "2k", prompts: 100 },
  { id: "growth", name: "Growth", priceMonthly: 279, priceAnnual: 223.2, projects: 30, keywords: "5k", prompts: 250 },
  { id: "enterprise", name: "Enterprise", priceMonthly: null, priceAnnual: null, projects: "Custom", keywords: "Custom", prompts: "Custom" }
];

function hashString(value) {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function seeded(seed, min, max) {
  const span = max - min + 1;
  const value = Math.abs(Math.trunc(Number(seed) || 0)) % span;
  return min + value;
}

function cleanHost(value) {
  const text = String(value || "").trim();
  try {
    return new URL(text.startsWith("http") ? text : `https://${text}`).hostname || "example.com";
  } catch {
    return text.replace(/[^a-z0-9.-]/gi, "") || "example.com";
  }
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const TOOL_REQUIRED = {
  "rank-tracker": ["url", "keyword"],
  "keyword-research": ["keyword"],
  "on-page-checker": ["url"],
  "backlink-checker": ["url"],
  "competitor-analysis": ["url", "competitor", "keyword"],
  "ai-visibility": ["brand"]
};

const TOOL_NOTE = "Demo dataset generated locally. No outbound requests are made to the submitted host.";

function demoRankTracker(body) {
  const host = cleanHost(body.url);
  const keyword = String(body.keyword).trim();
  const engines = ["Google", "Google", "Google", "Bing", "Google", "Bing"];
  const devices = ["Desktop", "Mobile", "Mobile", "Desktop", "Desktop", "Mobile"];
  const locations = ["United States", "United Kingdom", "Germany", "India", "Canada", "Australia"];
  const rows = engines.map((engine, index) => {
    const seed = hashString(`${keyword}:${index}`);
    const position = seeded(seed, 1, 42);
    const change = seeded(seed >>> 3, -4, 6);
    return [keyword, engine, devices[index], locations[index], `#${position}`, change > 0 ? `+${change}` : String(change)];
  });
  return {
    tool: "rank-tracker",
    title: "Rank tracking preview",
    summary: `Tracked ${rows.length} positions for "${keyword}" on ${host}.`,
    columns: ["Keyword", "Engine", "Device", "Location", "Position", "Change"],
    rows,
    note: TOOL_NOTE
  };
}

async function liveRankTracker(body) {
  const keyword = String(body.keyword).trim();
  const domain = String(body.url).trim();
  const data = await SERPER.search(keyword, { num: 100 });
  const target = data.organic.find((entry) => SERPER.matchesDomain(entry.link, domain));
  const rows = data.organic.slice(0, 10).map((entry) => {
    const isTarget = SERPER.matchesDomain(entry.link, domain);
    return [String(entry.position || "-"), (SERPER.hostOf(entry.link) || entry.link) + (isTarget ? " (your site)" : ""), entry.title || ""];
  });
  if (target && Number(target.position) > 10) {
    rows.unshift([String(target.position), SERPER.hostOf(target.link) + " (your site)", target.title || ""]);
  }
  const summary = target
    ? `"${keyword}": ${cleanHost(domain)} ranks #${target.position} on Google (live).`
    : `"${keyword}": ${cleanHost(domain)} not found in the top ${data.organic.length} Google results (live).`;
  return {
    tool: "rank-tracker",
    title: "Live Google positions",
    summary,
    columns: ["Position", "Domain", "Title"],
    rows,
    note: "Live Google SERP data via Serper."
  };
}

async function buildRankTracker(body) {
  if (!SERPER.enabled()) return demoRankTracker(body);
  try {
    return await liveRankTracker(body);
  } catch (error) {
    const fallback = demoRankTracker(body);
    fallback.note = `Live data unavailable (${error.message}). Showing demo data.`;
    return fallback;
  }
}

function demoKeywordResearch(body) {
  const keyword = String(body.keyword).trim();
  const variants = [keyword, `best ${keyword}`, `${keyword} tools`, `free ${keyword}`, `${keyword} for beginners`, `${keyword} alternatives`, `${keyword} pricing`, `how to ${keyword}`];
  const intents = ["Commercial", "Commercial", "Commercial", "Informational", "Informational", "Commercial", "Transactional", "Informational"];
  const rows = variants.map((variant, index) => {
    const seed = hashString(variant);
    const cpc = (seeded(seed >>> 8, 1, 45) / 10).toFixed(2);
    return [variant, formatNumber(seeded(seed, 320, 24000)), seeded(seed >>> 4, 12, 78), `$${cpc}`, intents[index]];
  });
  return {
    tool: "keyword-research",
    title: "Keyword ideas",
    summary: `${rows.length} keyword ideas for "${keyword}".`,
    columns: ["Keyword", "Volume", "Difficulty", "CPC", "Intent"],
    rows,
    note: TOOL_NOTE
  };
}

async function liveKeywordResearch(body) {
  const keyword = String(body.keyword).trim();
  const [searchData, suggestions] = await Promise.all([
    SERPER.search(keyword, { num: 10 }).catch(() => ({ peopleAlsoAsk: [], relatedSearches: [] })),
    SERPER.autocomplete(keyword).catch(() => [])
  ]);
  const rows = [];
  const seen = new Set();
  const add = (text, type) => {
    const value = String(text || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push([value, type]);
  };
  suggestions.forEach((item) => add(item, "Google autocomplete"));
  searchData.relatedSearches.forEach((item) => add(item.query || item, "Related search"));
  searchData.peopleAlsoAsk.forEach((item) => add(item.question || item, "People also ask"));
  if (!rows.length) throw new Error("No keyword suggestions returned");
  return {
    tool: "keyword-research",
    title: "Live keyword ideas",
    summary: `${rows.length} real keyword suggestions for "${keyword}" from Google (live).`,
    columns: ["Keyword", "Type"],
    rows,
    note: "Live Google autocomplete, related searches and People Also Ask via Serper."
  };
}

async function buildKeywordResearch(body) {
  if (!SERPER.enabled()) return demoKeywordResearch(body);
  try {
    return await liveKeywordResearch(body);
  } catch (error) {
    const fallback = demoKeywordResearch(body);
    fallback.note = `Live data unavailable (${error.message}). Showing demo data.`;
    return fallback;
  }
}

function buildOnPageChecker(body) {
  return LIVE.analyzePage(String(body.url).trim());
}

function buildBacklinkChecker(body) {
  const host = cleanHost(body.url);
  const seed = hashString(host);
  const domains = seeded(seed, 180, 4200);
  const backlinks = domains * seeded(seed >>> 4, 8, 22);
  const sources = ["techcrunch.com", "searchengineland.com", "moz.com", "hubspot.com", "backlinko.com", "neilpatel.com"];
  const anchors = ["natural anchor", "brand name", "exact match", "URL anchor", "naked link", "generic phrase"];
  const types = ["Dofollow", "Dofollow", "Nofollow", "Dofollow", "Nofollow", "Dofollow"];
  const rows = sources.map((source, index) => {
    const s = hashString(`${host}:${source}`);
    return [source, anchors[index], seeded(s, 45, 94), types[index], `$${formatNumber(seeded(s >>> 3, 40, 980))}`];
  });
  return {
    tool: "backlink-checker",
    title: "Backlink profile",
    summary: `${formatNumber(backlinks)} backlinks from ${formatNumber(domains)} referring domains for ${host}.`,
    columns: ["Referring domain", "Anchor text", "Authority", "Type", "Value"],
    rows,
    note: TOOL_NOTE
  };
}

function demoCompetitorAnalysis(body) {
  const host = cleanHost(body.url);
  const rival = cleanHost(body.competitor);
  const seed = hashString(`${host}:${rival}`);
  const metrics = ["Organic keywords", "Organic traffic", "Backlinks", "Referring domains", "Paid keywords", "Domain authority"];
  const rows = metrics.map((metric) => {
    const s = hashString(`${metric}:${seed}`);
    return [metric, formatNumber(seeded(s, 1200, 92000)), formatNumber(seeded(s >>> 3, 1200, 92000))];
  });
  return {
    tool: "competitor-analysis",
    title: "Competitor overview",
    summary: `Side-by-side organic and paid metrics for ${host} and ${rival}.`,
    columns: ["Metric", host, rival],
    rows,
    note: TOOL_NOTE
  };
}

async function liveCompetitorAnalysis(body) {
  const keyword = String(body.keyword).trim();
  const domain = String(body.url).trim();
  const rival = String(body.competitor).trim();
  const data = await SERPER.search(keyword, { num: 100 });
  const mine = data.organic.find((entry) => SERPER.matchesDomain(entry.link, domain));
  const theirs = data.organic.find((entry) => SERPER.matchesDomain(entry.link, rival));
  const rows = data.organic.slice(0, 10).map((entry) => {
    const host = SERPER.hostOf(entry.link) || entry.link;
    const flag = SERPER.matchesDomain(entry.link, domain) ? " (you)" : SERPER.matchesDomain(entry.link, rival) ? " (rival)" : "";
    return [String(entry.position || "-"), host + flag, entry.title || ""];
  });
  const summary = `"${keyword}": ${cleanHost(domain)} ${mine ? "#" + mine.position : "not in top 100"}, ${cleanHost(rival)} ${theirs ? "#" + theirs.position : "not in top 100"} (live).`;
  return {
    tool: "competitor-analysis",
    title: "Live competitor positions",
    summary,
    columns: ["Position", "Domain", "Title"],
    rows,
    note: "Live Google SERP comparison via Serper."
  };
}

async function buildCompetitorAnalysis(body) {
  if (!SERPER.enabled()) return demoCompetitorAnalysis(body);
  try {
    return await liveCompetitorAnalysis(body);
  } catch (error) {
    const fallback = demoCompetitorAnalysis(body);
    fallback.note = `Live data unavailable (${error.message}). Showing demo data.`;
    return fallback;
  }
}

function buildAiVisibility(body) {
  const brand = String(body.brand).trim();
  const engines = ["Google AI Overviews", "ChatGPT", "Gemini", "Perplexity", "Microsoft Copilot"];
  const sentiments = ["Positive", "Positive", "Neutral", "Positive", "Neutral"];
  const rows = engines.map((engine, index) => {
    const seed = hashString(`${brand}:${engine}`);
    const mentions = seeded(seed, 12, 480);
    const share = (seeded(seed >>> 3, 40, 380) / 10).toFixed(1);
    return [engine, formatNumber(mentions), sentiments[index], `${share}%`];
  });
  return {
    tool: "ai-visibility",
    title: "AI share of voice",
    summary: `Brand mentions and sentiment for "${brand}" across ${rows.length} AI engines.`,
    columns: ["AI engine", "Mentions", "Sentiment", "Share of voice"],
    rows,
    note: TOOL_NOTE
  };
}

const TOOL_BUILDERS = {
  "rank-tracker": buildRankTracker,
  "keyword-research": buildKeywordResearch,
  "on-page-checker": buildOnPageChecker,
  "backlink-checker": buildBacklinkChecker,
  "competitor-analysis": buildCompetitorAnalysis,
  "ai-visibility": buildAiVisibility
};

async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();

  if (pathname === "/api/health" && method === "GET") {
    return sendJson(res, 200, { status: "ok", service: "optirank", time: new Date().toISOString() });
  }

  if (pathname === "/api/plans" && method === "GET") {
    return sendJson(res, 200, { plans: PLANS });
  }

  if (pathname === "/api/audit" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(req, raw);
    if (!String(body.url || "").trim()) return sendJson(res, 400, { error: "A url field is required" });
    try {
      return sendJson(res, 200, await LIVE.analyzeSite(String(body.url).trim()));
    } catch (error) {
      return sendJson(res, 502, { error: error.message || "Could not reach the submitted URL" });
    }
  }

  if (pathname === "/api/contact" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(req, raw);
    if (!body.email || !body.message) return sendJson(res, 400, { error: "Email and message are required" });
    return sendJson(res, 201, { status: "received", message: "Thanks, our team will reply within one business day." });
  }

  if (pathname === "/api/subscribe" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(req, raw);
    if (!body.email) return sendJson(res, 400, { error: "Email is required" });
    return sendJson(res, 201, { status: "subscribed", message: `${body.email} is subscribed.` });
  }

  if (pathname === "/api/tool" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(req, raw);
    const tool = String(body.tool || "");
    const required = TOOL_REQUIRED[tool];
    const builder = TOOL_BUILDERS[tool];
    if (!required || !builder) return sendJson(res, 400, { error: "Unknown tool" });
    for (const field of required) {
      if (!String(body[field] || "").trim()) return sendJson(res, 400, { error: `A ${field} field is required` });
    }
    try {
      return sendJson(res, 200, await builder(body));
    } catch (error) {
      return sendJson(res, 502, { error: error.message || "Could not run this tool" });
    }
  }

  sendJson(res, 404, { error: "Unknown API endpoint", path: pathname });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    const withHtml = `${filePath}.html`;
    if (fs.existsSync(withHtml)) filePath = withHtml;
  }

  if (!fs.existsSync(filePath)) {
    const notFound = path.join(ROOT, "404.html");
    const html = fs.existsSync(notFound) ? injectIncludes(fs.readFileSync(notFound, "utf8")) : "<h1>404</h1>";
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  let body = fs.readFileSync(filePath);
  if (ext === ".html") body = Buffer.from(injectIncludes(body.toString("utf8")), "utf8");

  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let pathname = parsed.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      pathname = parsed.pathname;
    }

    if (pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, pathname);
      } catch (error) {
        sendJson(res, 500, { error: "Internal server error", detail: String(error && error.message) });
      }
      return;
    }

    if (req.method === "GET") {
      const rule = findRedirect(pathname);
      if (rule) {
        res.writeHead(rule.code, { Location: rule.to });
        return res.end();
      }
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error");
  }
});

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, () => {
  console.log(`OptiRank running at http://localhost:${PORT}`);
  console.log(`API base: ${ENDPOINTS.base} (${ENDPOINTS.endpoints.length} endpoints)`);
  console.log(`Redirect rules loaded: ${REDIRECTS.length}`);
});
