const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8000);
const ENDPOINTS = require("./endpoints.json");

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

function buildInstantAudit(target) {
  let host = target;
  try { host = new URL(target.startsWith("http") ? target : `https://${target}`).hostname; } catch { host = String(target); }
  return {
    url: target,
    host,
    generatedAt: new Date().toISOString(),
    mode: "instant-preview",
    note: "Demo dataset generated locally. No outbound requests are made to the submitted host.",
    score: 82,
    checks: [
      { id: "canonical", label: "Canonical URL", status: "pass", detail: `Canonical tag present and self-referencing on ${host}` },
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
    if (!body.url) return sendJson(res, 400, { error: "A url field is required" });
    return sendJson(res, 200, buildInstantAudit(String(body.url)));
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
