const dns = require("dns").promises;
const net = require("net");

const TIMEOUT_MS = 7000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT = "OptiRankBot/1.0 (+https://www.optirank.io/bot)";

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("::ffff:")) return isPrivateIpv4(value.slice(7));
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

function isBlockedHostname(host) {
  const name = host.toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name.endsWith(".local") || name.endsWith(".internal")) return true;
  if (name === "metadata.google.internal") return true;
  return false;
}

async function assertPublicHost(host) {
  const name = String(host).replace(/^\[|\]$/g, "");
  if (isBlockedHostname(name)) throw new Error("That host is not allowed");
  if (net.isIP(name)) {
    if (isPrivateIp(name)) throw new Error("That host resolves to a private address");
    return;
  }
  let records;
  try {
    records = await dns.lookup(name, { all: true });
  } catch {
    throw new Error(`Could not resolve ${name}`);
  }
  if (!records.length) throw new Error(`Could not resolve ${name}`);
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error("That host resolves to a private address");
  }
}

function normalizeTarget(input) {
  const text = String(input || "").trim();
  if (!text) throw new Error("A url field is required");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return new URL(`https://${text}`);
  }
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  return url;
}

async function readBodyLimited(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchOnce(url, accept) {
  await assertPublicHost(url.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: accept }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetch(rawUrl, accept) {
  let url = rawUrl instanceof URL ? rawUrl : normalizeTarget(rawUrl);
  const redirects = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const started = Date.now();
    const response = await fetchOnce(url, accept || "text/html,application/xhtml+xml,*/*;q=0.8");
    const elapsed = Date.now() - started;
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      redirects.push({ from: url.href, to: next.href, status: response.status });
      if (response.body) { try { await response.body.cancel(); } catch { /* ignore */ } }
      if (redirects.length > MAX_REDIRECTS) throw new Error("Too many redirects");
      url = next;
      continue;
    }
    const body = await readBodyLimited(response, MAX_BYTES);
    return {
      url: url.href,
      host: url.hostname,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      elapsed,
      body,
      redirects
    };
  }
  throw new Error("Too many redirects");
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
    .replace(/\s+/g, " ")
    .trim();
}

function pick(regex, html) {
  const match = html.match(regex);
  return match ? match[1] : null;
}

function metaByName(head, name) {
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i")
  ];
  for (const regex of patterns) {
    const value = pick(regex, head);
    if (value !== null) return decodeEntities(value);
  }
  return null;
}

function metaByProperty(head, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i")
  ];
  for (const regex of patterns) {
    const value = pick(regex, head);
    if (value !== null) return decodeEntities(value);
  }
  return null;
}

function textFromHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function countWords(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function scoreChecks(checks) {
  const passes = checks.filter((check) => check.status === "pass").length;
  return Math.round((passes / checks.length) * 100);
}

async function probe(url, accept) {
  try {
    const result = await safeFetch(url, accept);
    return { ok: result.status >= 200 && result.status < 400, status: result.status, result };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function analyzeSite(input) {
  const page = await safeFetch(input);
  const html = page.body;
  const head = html.split("</head>")[0] || html;
  const finalUrl = new URL(page.url);

  const title = decodeEntities(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, head) || "");
  const description = metaByName(head, "description");
  const canonical = pick(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i, head);
  const robotsMeta = metaByName(head, "robots") || "";
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = images.filter((img) => !/\balt\s*=/i.test(img)).length;
  const links = html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["']/gi) || [];
  const internalLinks = links.filter((link) => {
    const href = pick(/href\s*=\s*["']([^"']+)["']/i, link) || "";
    return href.startsWith("/") || href.startsWith(finalUrl.origin) || (!/^[a-z]+:|^\/\//i.test(href) && !href.startsWith("#"));
  }).length;
  const wordCount = countWords(textFromHtml(html));

  const checks = [];
  checks.push({ id: "reachable", label: "Page reachable", status: page.status < 400 ? "pass" : "fail", detail: `HTTP ${page.status} returned in ${page.elapsed}ms` });
  checks.push({ id: "https", label: "HTTPS enabled", status: finalUrl.protocol === "https:" ? "pass" : "fail", detail: finalUrl.protocol === "https:" ? "Served over HTTPS with a valid URL" : "Page is served over plain HTTP" });
  checks.push({ id: "redirects", label: "Redirects", status: page.redirects.length === 0 ? "pass" : page.redirects.length <= 2 ? "warn" : "fail", detail: page.redirects.length === 0 ? "No redirects detected" : `${page.redirects.length} redirect(s) before the final page` });
  checks.push({ id: "title", label: "Meta title", status: title.length >= 15 && title.length <= 60 ? "pass" : title ? "warn" : "fail", detail: title ? `"${title}" (${title.length} characters)` : "No title tag found" });
  checks.push({ id: "description", label: "Meta description", status: description && description.length >= 50 && description.length <= 160 ? "pass" : description ? "warn" : "fail", detail: description ? `${description.length} characters` : "No meta description found" });
  checks.push({ id: "canonical", label: "Canonical URL", status: canonical ? "pass" : "warn", detail: canonical ? `Self-referencing canonical found` : "No canonical tag found" });
  checks.push({ id: "h1", label: "H1 heading", status: h1Count === 1 ? "pass" : h1Count === 0 ? "fail" : "warn", detail: h1Count === 1 ? "Exactly one H1 found" : `${h1Count} H1 headings found` });
  checks.push({ id: "robots", label: "Robots meta", status: /noindex/i.test(robotsMeta) ? "fail" : "pass", detail: /noindex/i.test(robotsMeta) ? "Page is set to noindex" : "Page is indexable" });
  checks.push({ id: "images", label: "Image alt text", status: imagesMissingAlt === 0 ? "pass" : "warn", detail: images.length === 0 ? "No images found" : `${images.length} images, ${imagesMissingAlt} missing alt text` });
  checks.push({ id: "internal-links", label: "Internal links", status: internalLinks >= 3 ? "pass" : "warn", detail: `${internalLinks} internal links, ${wordCount} words on the page` });
  checks.push({ id: "og", label: "Open Graph tags", status: metaByProperty(head, "og:title") && metaByProperty(head, "og:description") ? "pass" : "warn", detail: metaByProperty(head, "og:title") ? "og:title and og:description present" : "Missing og:title or og:description" });

  const robotsProbe = await probe(new URL("/robots.txt", finalUrl), "text/plain,*/*;q=0.8");
  checks.push({ id: "robots-txt", label: "robots.txt", status: robotsProbe.ok ? "pass" : "warn", detail: robotsProbe.ok ? "robots.txt reachable" : "robots.txt not reachable" });

  const sitemapProbe = await probe(new URL("/sitemap.xml", finalUrl), "application/xml,text/xml,*/*;q=0.8");
  checks.push({ id: "sitemap", label: "XML sitemap", status: sitemapProbe.ok ? "pass" : "warn", detail: sitemapProbe.ok ? "sitemap.xml reachable" : "sitemap.xml not reachable" });

  return {
    url: input,
    host: finalUrl.hostname,
    generatedAt: new Date().toISOString(),
    mode: "live",
    note: "Fetched live from the submitted URL. A single request was made; robots.txt and sitemap.xml were probed.",
    score: scoreChecks(checks),
    checks
  };
}

async function analyzePage(input) {
  const page = await safeFetch(input);
  const html = page.body;
  const head = html.split("</head>")[0] || html;
  const finalUrl = new URL(page.url);

  const title = decodeEntities(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, head) || "");
  const description = metaByName(head, "description");
  const canonical = pick(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i, head);
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = images.filter((img) => !/\balt\s*=/i.test(img)).length;
  const links = html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["']/gi) || [];
  const internalLinks = links.filter((link) => {
    const href = pick(/href\s*=\s*["']([^"']+)["']/i, link) || "";
    return href.startsWith("/") || href.startsWith(finalUrl.origin) || (!/^[a-z]+:|^\/\//i.test(href) && !href.startsWith("#"));
  }).length;
  const text = textFromHtml(html);
  const wordCount = countWords(text);

  const items = [];
  items.push({
    element: "Title tag",
    status: title ? (title.length >= 15 && title.length <= 60 ? "Good" : "Improve") : "Missing",
    ok: Boolean(title) && title.length >= 15 && title.length <= 60,
    detail: title ? `"${title}" (${title.length} chars)` : "Add a title between 45 and 60 characters."
  });
  items.push({
    element: "Meta description",
    status: description ? (description.length >= 50 && description.length <= 160 ? "Good" : "Improve") : "Missing",
    ok: Boolean(description) && description.length >= 50 && description.length <= 160,
    detail: description ? `${description.length} characters` : "Add a meta description between 50 and 160 characters."
  });
  items.push({
    element: "H1 heading",
    status: h1Count === 1 ? "Good" : h1Count === 0 ? "Missing" : "Improve",
    ok: h1Count === 1,
    detail: h1Count === 1 ? "Exactly one H1 found." : `${h1Count} H1 headings found. Use exactly one.`
  });
  items.push({
    element: "Canonical URL",
    status: canonical ? "Good" : "Missing",
    ok: Boolean(canonical),
    detail: canonical ? "Self-referencing canonical found." : "Add a self-referencing canonical URL."
  });
  items.push({
    element: "Word count",
    status: `${wordCount} words`,
    ok: wordCount >= 800,
    detail: wordCount >= 800 ? "Healthy content length." : "Aim for 800+ words on competitive pages."
  });
  items.push({
    element: "Image alt text",
    status: imagesMissingAlt === 0 ? "Good" : "Improve",
    ok: imagesMissingAlt === 0,
    detail: images.length === 0 ? "No images found on the page." : `${images.length} images, ${imagesMissingAlt} missing alt text.`
  });
  items.push({
    element: "Internal links",
    status: `${internalLinks} links`,
    ok: internalLinks >= 3,
    detail: internalLinks >= 3 ? "Good internal linking." : "Add 2-3 internal links to related pages."
  });
  items.push({
    element: "Page load",
    status: `${page.elapsed}ms`,
    ok: page.elapsed < 2500,
    detail: page.elapsed < 2500 ? "Fast server response." : "Target under 2.5s on mobile."
  });

  const rows = items.map((item) => [item.element, item.status, item.detail]);
  const score = scoreChecks(items.map((item) => ({ status: item.ok ? "pass" : "fail" })));

  return {
    tool: "on-page-checker",
    title: "On-page score",
    summary: `On-page score ${score}/100 for ${finalUrl.hostname} (live).`,
    columns: ["Element", "Status", "Detail"],
    rows,
    note: "Fetched live from the submitted URL. A single request was made."
  };
}

module.exports = { analyzeSite, analyzePage };
