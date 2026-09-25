#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = (process.env.GH_PAGES_BASE || "/seorank").replace(/\/+$/, "");
const OUT = path.join(ROOT, "docs");
const COPY_DIRS = ["css", "js"];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function injectIncludes(html) {
  return html.replace(/<!--#include\s+([a-zA-Z0-9_-]+)\s*-->/g, (match, name) => {
    const partial = path.join(ROOT, "partials", `${name}.html`);
    if (!fs.existsSync(partial)) return match;
    return read(partial);
  });
}

function rewritePaths(html) {
  return html
    .replace(/(\b(?:href|src|action)=)"\/(?!\/)/g, `$1"${BASE}/`)
    .replace(/url\(\/(?!\/)/g, `url(${BASE}/`);
}

function injectDemoApi(html) {
  if (html.includes("demo-api.js")) return html;
  const tag = `<script src="/js/demo-api.js" defer></script>\n  `;
  if (html.includes("site.js")) {
    return html.replace(/(<script src="[^"]*site\.js"[^>]*><\/script>)/, tag + "$1");
  }
  return html.replace("</head>", `  ${tag}</head>`);
}

function collectPages(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "docs", "backend", "partials", "scripts"].includes(entry.name)) continue;
      collectPages(full, acc);
    } else if (entry.name.endsWith(".html")) {
      acc.push(full);
    }
  }
  return acc;
}

function copyDir(name) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) return;
  const dest = path.join(OUT, name);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(path.join(name, entry.name));
    else write(to, read(from));
  }
}

function build() {
  const pages = collectPages(ROOT, []);
  let count = 0;
  for (const page of pages) {
    const rel = path.relative(ROOT, page);
    const html = rewritePaths(injectDemoApi(injectIncludes(read(page))));
    write(path.join(OUT, rel), html);
    count += 1;
  }
  COPY_DIRS.forEach(copyDir);
  console.log(`Static build complete: ${count} pages, base path "${BASE}", output "docs/"`);
}

build();
