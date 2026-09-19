const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = "https://www.optirank.io";
const SKIP_DIRS = new Set([".git", "node_modules", "backend", "scripts", "partials"]);

const errors = [];
const warnings = [];
const info = [];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function walk(dir, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

function loadPartial(name) {
  const file = path.join(ROOT, "partials", `${name}.html`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function withIncludes(html) {
  return html.replace(/<!--#include\s+([a-zA-Z0-9_-]+)\s*-->/g, (m, name) => loadPartial(name));
}

function match(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

function decode(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/&rarr;/g, "→")
    .replace(/&ndash;/g, "–")
    .replace(/&copy;/g, "©")
    .replace(/\s+/g, " ")
    .trim();
}

function collectLinks(html) {
  const links = [];
  const regex = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html))) links.push(m[1].trim());
  return links;
}

function isExternal(href) {
  return /^(https?:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("data:");
}

function resolveTarget(pageFile, href) {
  if (isExternal(href)) return null;
  if (href.startsWith("#")) return null;
  let clean = href.split("#")[0].split("?")[0];
  if (!clean) return null;
  if (clean.startsWith("/")) {
    return path.join(ROOT, clean);
  }
  return path.join(path.dirname(pageFile), clean);
}

function targetExists(target) {
  if (!target) return true;
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      return fs.existsSync(path.join(target, "index.html"));
    }
    return true;
  }
  if (!path.extname(target) && fs.existsSync(`${target}.html`)) return true;
  return false;
}

function extractContent(match) {
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3];
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*content=("([^"]*)"|'([^']*)')`, "i"),
    new RegExp(`<meta\\s+[^>]*content=("([^"]*)"|'([^']*)')[^>]*name=["']${name}["']`, "i")
  ];
  for (const regex of patterns) {
    const value = extractContent(html.match(regex));
    if (value !== null) return decode(value);
  }
  return null;
}

function extractProperty(html, property) {
  const patterns = [
    new RegExp(`<meta\\s+[^>]*property=["']${property}["'][^>]*content=("([^"]*)"|'([^']*)')`, "i"),
    new RegExp(`<meta\\s+[^>]*content=("([^"]*)"|'([^']*)')[^>]*property=["']${property}["']`, "i")
  ];
  for (const regex of patterns) {
    const value = extractContent(html.match(regex));
    if (value !== null) return decode(value);
  }
  return null;
}

const pages = walk(ROOT).sort();
const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();

info.push(`Pages discovered: ${pages.length}`);

for (const file of pages) {
  const relative = rel(file);
  const raw = fs.readFileSync(file, "utf8");
  const html = withIncludes(raw);
  const head = html.split("</head>")[0] || html;

  const lang = match(html, /<html[^>]*lang=["']([^"']+)["']/i);
  if (!lang) errors.push(`${relative}: missing lang attribute on <html>`);

  const title = match(head, /<title>([\s\S]*?)<\/title>/i);
  if (!title) {
    errors.push(`${relative}: missing <title>`);
  } else {
    const t = decode(title);
    if (t.length < 15) warnings.push(`${relative}: title too short (${t.length} chars)`);
    if (t.length > 70) warnings.push(`${relative}: title too long (${t.length} chars)`);
    const key = t.toLowerCase();
    if (titles.has(key)) errors.push(`${relative}: duplicate title also used by ${titles.get(key)}`);
    else titles.set(key, relative);
  }

  const desc = extractMeta(head, "description");
  if (!desc) {
    errors.push(`${relative}: missing meta description`);
  } else {
    if (desc.length < 50) warnings.push(`${relative}: meta description too short (${desc.length} chars)`);
    if (desc.length > 165) warnings.push(`${relative}: meta description too long (${desc.length} chars)`);
    const key = desc.toLowerCase();
    if (descriptions.has(key)) errors.push(`${relative}: duplicate meta description also used by ${descriptions.get(key)}`);
    else descriptions.set(key, relative);
  }

  const canonical = match(head, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const robots = extractMeta(head, "robots");
  const isNoIndex = robots && robots.includes("noindex");

  if (!canonical) {
    if (relative === "404.html") {
      info.push(`${relative}: no canonical (allowed for 404)`);
    } else {
      errors.push(`${relative}: missing canonical URL`);
    }
  } else {
    if (!canonical.startsWith("https://")) errors.push(`${relative}: canonical is not absolute HTTPS (${canonical})`);
    const key = canonical.toLowerCase();
    if (canonicals.has(key)) errors.push(`${relative}: duplicate canonical also used by ${canonicals.get(key)}`);
    else canonicals.set(key, relative);
    if (!isNoIndex && !canonical.startsWith(BASE)) warnings.push(`${relative}: canonical host differs from ${BASE} (${canonical})`);
  }

  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) errors.push(`${relative}: missing H1 heading`);
  if (h1s.length > 1) warnings.push(`${relative}: multiple H1 headings (${h1s.length})`);

  if (!extractProperty(head, "og:title")) warnings.push(`${relative}: missing og:title`);
  if (!extractProperty(head, "og:description")) warnings.push(`${relative}: missing og:description`);

  const links = collectLinks(html);
  let broken = 0;
  for (const href of links) {
    const target = resolveTarget(file, href);
    if (target === null) continue;
    if (!targetExists(target)) {
      broken += 1;
      errors.push(`${relative}: broken internal link -> ${href}`);
    }
  }

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  imgs.forEach((img) => {
    if (!/\balt\s*=/.test(img)) errors.push(`${relative}: image without alt attribute`);
  });

  if (relative !== "404.html" && !isNoIndex) {
    const footer = loadPartial("footer");
    if (!footer.includes('href="/privacy.html"')) errors.push(`${relative}: footer missing link to privacy.html`);
    if (!footer.includes('href="/terms.html"')) errors.push(`${relative}: footer missing link to terms.html`);
  }

  if (relative !== "404.html" && !isNoIndex && !canonical) {
    errors.push(`${relative}: indexable page without canonical`);
  }
}

function parseRedirects() {
  const file = path.join(ROOT, "_redirects");
  if (!fs.existsSync(file)) {
    errors.push("_redirects: file missing");
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to, code] = line.split(/\s+/);
      return { from, to, code: Number(code || 301) };
    });
}

const redirects = parseRedirects();
const redirectSources = new Set();
redirects.forEach((rule) => {
  if (redirectSources.has(rule.from)) errors.push(`_redirects: duplicate rule for ${rule.from}`);
  redirectSources.add(rule.from);
  if (rule.to.includes("*")) return;
  const isCatchAll404 = rule.code === 404;
  const target = path.join(ROOT, rule.to);
  if (isCatchAll404) {
    if (!targetExists(target)) errors.push(`_redirects: 404 target missing ${rule.to}`);
  } else if (!targetExists(target)) {
    errors.push(`_redirects: redirect target missing ${rule.to} (from ${rule.from})`);
  }
});
info.push(`Redirect rules validated: ${redirects.length}`);

const robotsFile = path.join(ROOT, "robots.txt");
if (!fs.existsSync(robotsFile)) {
  errors.push("robots.txt: missing");
} else {
  const robots = fs.readFileSync(robotsFile, "utf8");
  if (!/Sitemap:\s*https?:\/\//i.test(robots)) errors.push("robots.txt: missing absolute Sitemap directive");
  if (!/User-agent:\s*\*/i.test(robots)) warnings.push("robots.txt: no wildcard User-agent group");
}

const sitemapFile = path.join(ROOT, "sitemap.xml");
const sitemapLocs = [];
if (!fs.existsSync(sitemapFile)) {
  errors.push("sitemap.xml: missing");
} else {
  const sitemap = fs.readFileSync(sitemapFile, "utf8");
  const locRegex = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRegex.exec(sitemap))) sitemapLocs.push(m[1].trim());
  if (!sitemapLocs.length) errors.push("sitemap.xml: no <loc> entries");
  sitemapLocs.forEach((loc) => {
    if (!loc.startsWith(BASE)) {
      warnings.push(`sitemap.xml: entry host differs from ${BASE} (${loc})`);
    }
    const urlPath = loc.replace(/^https?:\/\/[^/]+/, "");
    const target = path.join(ROOT, decodeURIComponent(urlPath));
    if (!targetExists(target)) errors.push(`sitemap.xml: entry does not map to a file -> ${loc}`);
  });
}

const sitemapPaths = new Set(sitemapLocs.map((loc) => loc.replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "")));
pages.forEach((file) => {
  const relative = rel(file);
  if (relative === "404.html" || relative === "index.html") return;
  const raw = fs.readFileSync(file, "utf8");
  const head = raw.split("</head>")[0] || raw;
  const robots = extractMeta(head, "robots");
  if (robots && robots.includes("noindex")) return;
  if (!sitemapPaths.has(relative)) {
    errors.push(`sitemap.xml: missing indexable page ${relative}`);
  }
});
info.push(`Sitemap URLs validated: ${sitemapLocs.length}`);

const endpointsFile = path.join(ROOT, "backend", "endpoints.json");
const serverFile = path.join(ROOT, "backend", "server.js");
if (!fs.existsSync(endpointsFile)) {
  errors.push("backend/endpoints.json: missing");
}
if (!fs.existsSync(serverFile)) errors.push("backend/server.js: missing");

const declaredEndpoints = new Set();
if (fs.existsSync(endpointsFile)) {
  JSON.parse(fs.readFileSync(endpointsFile, "utf8")).endpoints.forEach((endpoint) => {
    declaredEndpoints.add(endpoint.path);
  });
}

const serverSource = fs.existsSync(serverFile) ? fs.readFileSync(serverFile, "utf8") : "";
declaredEndpoints.forEach((endpoint) => {
  if (!serverSource.includes(`"${endpoint}"`)) {
    errors.push(`backend: endpoint declared but not implemented -> ${endpoint}`);
  }
});

const referencedEndpoints = new Set();
const filesToScan = pages.concat(
  walkPublicJs()
);
function walkPublicJs() {
  const jsDir = path.join(ROOT, "js");
  if (!fs.existsSync(jsDir)) return [];
  return fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).map((f) => path.join(jsDir, f));
}
filesToScan.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  const regex = /["'`](\/api\/[a-zA-Z0-9_/-]+)["'`]/g;
  let m;
  while ((m = regex.exec(source))) referencedEndpoints.add(m[1]);
});
referencedEndpoints.forEach((endpoint) => {
  if (!declaredEndpoints.has(endpoint)) {
    errors.push(`backend: frontend references undeclared endpoint ${endpoint}`);
  }
});
info.push(`Backend endpoints declared: ${declaredEndpoints.size}, referenced by frontend: ${referencedEndpoints.size}`);

const report = [];
report.push("# SEO and Backend Audit Report");
report.push("");
report.push(`Base URL: ${BASE}`);
report.push(`Generated: ${new Date().toISOString()}`);
report.push("");
report.push("## Summary");
report.push("");
report.push(`- Pages checked: ${pages.length}`);
report.push(`- Redirect rules: ${redirects.length}`);
report.push(`- Sitemap URLs: ${sitemapLocs.length}`);
report.push(`- Backend endpoints: ${declaredEndpoints.size}`);
report.push(`- Errors: ${errors.length}`);
report.push(`- Warnings: ${warnings.length}`);
report.push("");
report.push("## Checked items");
report.push("");
report.push("- Canonical URLs: presence, absolute HTTPS, uniqueness, host");
report.push("- Meta titles: presence, length, uniqueness");
report.push("- Meta descriptions: presence, length, uniqueness");
report.push("- Redirects: sources, duplicate rules, valid targets");
report.push("- Internal links (frontend and backend pages): resolution");
report.push("- Privacy policy page and Terms page: existence and footer linking on every indexable page");
report.push("- robots.txt: presence and sitemap directive");
report.push("- sitemap.xml: presence, valid entries, coverage of indexable pages");
report.push("- Backend endpoints: declared vs implemented vs referenced");
report.push("");

if (errors.length) {
  report.push("## Errors");
  report.push("");
  errors.forEach((e) => report.push(`- ${e}`));
  report.push("");
}
if (warnings.length) {
  report.push("## Warnings");
  report.push("");
  warnings.forEach((w) => report.push(`- ${w}`));
  report.push("");
}
report.push("## Info");
report.push("");
info.forEach((i) => report.push(`- ${i}`));
report.push("");

fs.writeFileSync(path.join(ROOT, "seo-audit-report.md"), report.join("\n"), "utf8");

console.log("");
console.log("OptiRank SEO audit complete");
console.log(`  Pages checked:        ${pages.length}`);
console.log(`  Redirect rules:       ${redirects.length}`);
console.log(`  Sitemap URLs:         ${sitemapLocs.length}`);
console.log(`  Backend endpoints:    ${declaredEndpoints.size}`);
console.log(`  Errors:               ${errors.length}`);
console.log(`  Warnings:             ${warnings.length}`);
console.log("  Report:               seo-audit-report.md");
if (errors.length) {
  console.log("");
  console.log("Errors:");
  errors.slice(0, 40).forEach((e) => console.log(`  - ${e}`));
}
process.exit(errors.length ? 1 : 0);
