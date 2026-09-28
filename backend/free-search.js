const TIMEOUT_MS = 12000;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BLOCKED_HOSTS = [
  "bokep", "xvideos", "xhamster", "pornhub", "xnxx", "xvideos", "youporn",
  "eporner", "tiava", "theporndude", "thebestfetishsites", "bokeptoket",
  "friv.com", "poki.com", "crazygames.com"
];

function hostOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomain(link, domain) {
  const host = hostOf(link);
  const target = String(domain || "").replace(/^www\./i, "").toLowerCase();
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}

function isBlockedHost(link) {
  const host = hostOf(link);
  return BLOCKED_HOSTS.some((part) => host === part || host.includes(part));
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " "));
}

function queryTokens(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .split(/[^\w.]+/)
    .map((token) => token.replace(/^www\./, ""))
    .filter((token) => token.length > 2 && !["site", "www", "http", "https", "com", "the", "and", "for"].includes(token));
}

function looksRelevant(organic, query) {
  const tokens = queryTokens(query);
  if (!organic.length) return false;
  if (!tokens.length) return true;
  const hits = organic.filter((entry) => {
    const hay = `${entry.link} ${entry.title} ${entry.snippet}`.toLowerCase();
    return tokens.some((token) => hay.includes(token));
  });
  return hits.length >= Math.min(2, organic.length);
}

async function fetchText(url, options) {
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT_MS);
  try {
    const init = {
      method: opts.method || "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: opts.accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    };
    if (opts.body) {
      init.body = opts.body;
      init.headers["Content-Type"] = opts.contentType || "application/x-www-form-urlencoded";
    }
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Search request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function autocomplete(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`;
  const raw = await fetchText(url, { accept: "application/json,text/javascript,*/*;q=0.8" });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Autocomplete returned invalid JSON");
  }
  const suggestions = Array.isArray(data[1]) ? data[1] : [];
  return suggestions.map((item) => String(item || "").trim()).filter(Boolean);
}

function urlFromCite(cite) {
  const text = stripTags(cite);
  if (!text) return "";
  const parts = text.split(/\s*[›>]\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const host = parts[0].replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const path = parts.slice(1).join("/").replace(/^\/+/, "");
  const href = path ? `https://${host}/${path}` : `https://${host}`;
  try {
    return new URL(href).href;
  } catch {
    return "";
  }
}

function parseBingResults(html) {
  const organic = [];
  const blocks = String(html || "").match(/<li class="b_algo[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    const citeMatch = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const link = citeMatch ? urlFromCite(citeMatch[1]) : "";
    if (!link || isBlockedHost(link)) continue;
    organic.push({
      position: organic.length + 1,
      link,
      title: stripTags(titleMatch ? titleMatch[1] : link),
      snippet: stripTags(snippetMatch ? snippetMatch[1] : "")
    });
  }
  return organic;
}

function parseDdgResults(html) {
  const organic = [];
  const blocks = String(html || "").split(/class="result /);
  for (const block of blocks.slice(1)) {
    if (/\bresult--ad\b/.test(block)) continue;
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1]);
    if (!href || href.includes("duckduckgo.com/y.js") || href.includes("/aclick")) continue;
    if (!/^https?:\/\//i.test(href) || isBlockedHost(href)) continue;
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    organic.push({
      position: organic.length + 1,
      link: href,
      title: stripTags(titleMatch ? titleMatch[1] : href),
      snippet: stripTags(snippetMatch ? snippetMatch[1] : "")
    });
  }
  return organic;
}

async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`;
  const html = await fetchText(url);
  return parseBingResults(html);
}

async function searchDdg(query) {
  const body = `q=${encodeURIComponent(query)}&b=`;
  const html = await fetchText("https://html.duckduckgo.com/html/", { method: "POST", body });
  return parseDdgResults(html);
}

async function search(query, options) {
  const opts = options || {};
  const num = Math.min(Math.max(Number(opts.num) || 10, 1), 30);
  const q = String(query || "").trim();
  if (!q) throw new Error("A query is required");

  const attempts = [
    { name: "Bing", run: () => searchBing(q) },
    { name: "DuckDuckGo", run: () => searchDdg(q) }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const organic = await attempt.run();
      if (!organic.length || !looksRelevant(organic, q)) continue;
      const filtered = organic.map((entry, index) => Object.assign({}, entry, { position: index + 1 }));
      return {
        organic: filtered.slice(0, num),
        peopleAlsoAsk: [],
        relatedSearches: [],
        source: attempt.name
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No relevant search results returned");
}

async function relatedKeywords(query) {
  const q = String(query || "").trim();
  const seen = new Set();
  const rows = [];
  const add = (text, type) => {
    const value = String(text || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ value, type });
  };
  const extras = [`${q} `, `best ${q}`, `${q} tools`, `free ${q}`];
  const batches = await Promise.all(
    [q, ...extras].map((seed) => autocomplete(seed).catch(() => []))
  );
  batches.forEach((list) => list.forEach((item) => add(item, "Google autocomplete")));
  return rows;
}

module.exports = {
  autocomplete,
  relatedKeywords,
  search,
  hostOf,
  matchesDomain
};
