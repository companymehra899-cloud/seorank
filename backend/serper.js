const ENDPOINT = "https://google.serper.dev/search";
const AUTOCOMPLETE_ENDPOINT = "https://google.serper.dev/autocomplete";
const TIMEOUT_MS = 12000;

function apiKey() {
  return process.env.SERPER_API_KEY || "";
}

function enabled() {
  return Boolean(apiKey());
}

async function search(query, options) {
  const key = apiKey();
  if (!key) throw new Error("No search API key configured");
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: String(query),
        num: Math.min(Math.max(Number(opts.num) || 10, 10), 100),
        gl: opts.gl || "us",
        hl: opts.hl || "en"
      })
    });
    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }
    const data = await response.json();
    return {
      organic: Array.isArray(data.organic) ? data.organic : [],
      peopleAlsoAsk: Array.isArray(data.peopleAlsoAsk) ? data.peopleAlsoAsk : [],
      relatedSearches: Array.isArray(data.relatedSearches) ? data.relatedSearches : []
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Search API timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function autocomplete(query, options) {
  const key = apiKey();
  if (!key) throw new Error("No search API key configured");
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(AUTOCOMPLETE_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: String(query),
        gl: opts.gl || "us",
        hl: opts.hl || "en"
      })
    });
    if (!response.ok) {
      throw new Error(`Autocomplete API returned ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.suggestions)
      ? data.suggestions.map((item) => (item && item.value) || "").filter(Boolean)
      : [];
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Autocomplete API timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomain(link, domain) {
  const host = hostOf(link);
  let target = String(domain || "").trim().toLowerCase().replace(/^www\./, "");
  if (!host || !target) return false;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.includes("/")) {
      target = new URL(target.includes("://") ? target : `https://${target}`).hostname.replace(/^www\./i, "").toLowerCase();
    }
  } catch {
    target = target.split("/")[0].replace(/^www\./, "");
  }
  return host === target || host.endsWith(`.${target}`);
}

module.exports = { enabled, search, autocomplete, hostOf, matchesDomain };
