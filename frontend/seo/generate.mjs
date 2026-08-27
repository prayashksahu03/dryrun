// Emits static, fully-crawlable HTML for the marketing/content pages.
//
// Why static instead of React routes: the SPA renders nothing without JS, so a
// crawler saw an empty page. These pages are prose + code + links — they don't
// need the runtime, and serving real HTML means Google, Bing, social scrapers
// and AI answer engines all get the content on the first byte.
//
// Runs AFTER `vite build`, writing into dist/ so nothing generated lands in git.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL, SITE_NAME, DESCRIPTION, OG_IMAGE } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const DATA = join(HERE, 'algorithms.json');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── shared chrome ─────────────────────────────────────────────────────────
const CSS = `
:root{--bg:#09090b;--panel:#0d0d0f;--raised:#111113;--bd:rgba(39,39,42,.8);
--tx:#f4f4f5;--tx2:#a1a1aa;--tx3:#71717a;--vi:#8b5cf6;--vi2:#a78bfa;--gr:#4ade80;--am:#fbbf24}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--tx);font:16px/1.7 Inter,-apple-system,system-ui,sans-serif;
-webkit-font-smoothing:antialiased}
a{color:var(--vi2);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header.nav{border-bottom:1px solid var(--bd);position:sticky;top:0;background:rgba(9,9,11,.9);
backdrop-filter:blur(8px);z-index:10}
.nav .wrap{display:flex;align-items:center;gap:20px;height:56px}
.brand{font-weight:800;letter-spacing:-.02em;color:var(--tx);font-size:17px}
.brand span{color:var(--vi)}
.nav nav{margin-left:auto;display:flex;gap:18px;font-size:14px}
.nav nav a{color:var(--tx2)}
h1{font-size:clamp(28px,5vw,40px);font-weight:800;letter-spacing:-.03em;line-height:1.15;margin:40px 0 14px}
h2{font-size:23px;font-weight:700;letter-spacing:-.02em;margin:40px 0 12px}
h3{font-size:17px;font-weight:600;margin:22px 0 6px}
p{color:var(--tx2);margin:0 0 14px}
.lede{font-size:18px;color:var(--tx)}
.crumb{font:12px/1 JetBrains Mono,ui-monospace,monospace;color:var(--tx3);margin-top:26px;
text-transform:uppercase;letter-spacing:.14em}
pre{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:16px 18px;
overflow-x:auto;margin:16px 0}
code{font:13.5px/1.75 JetBrains Mono,ui-monospace,monospace;color:#e4e4e7}
.cta{display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;
font-weight:600;padding:13px 24px;border-radius:10px;margin:8px 0 4px;
box-shadow:0 8px 26px rgba(124,58,237,.32)}
.cta:hover{text-decoration:none;filter:brightness(1.08)}
.step{border-left:2px solid rgba(139,92,246,.4);padding:2px 0 2px 16px;margin:0 0 18px}
.step h3{margin:0 0 4px;color:var(--tx)}
.gotcha{background:var(--panel);border:1px solid var(--bd);border-left:3px solid var(--am);
border-radius:8px;padding:14px 16px;margin:0 0 12px}
.gotcha h3{margin:0 0 5px;color:var(--am);font-size:15px}
.gotcha p{margin:0;font-size:15px}
.cx{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.chip{background:var(--raised);border:1px solid var(--bd);border-radius:8px;padding:9px 14px;
font:13px/1 JetBrains Mono,monospace;color:var(--tx)}
.chip b{color:var(--vi2);font-weight:500}
details{border-bottom:1px solid var(--bd);padding:14px 0}
summary{cursor:pointer;font-weight:600;color:var(--tx);list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'+ ';color:var(--vi)}
details[open] summary::before{content:'\\2212 '}
details p{margin:10px 0 0}
.rel{display:flex;flex-wrap:wrap;gap:9px;margin:14px 0 0}
.rel a{background:var(--raised);border:1px solid var(--bd);border-radius:999px;
padding:7px 14px;font-size:13.5px;color:var(--tx2)}
.rel a:hover{border-color:var(--vi);color:var(--tx);text-decoration:none}
footer{border-top:1px solid var(--bd);margin-top:60px;padding:26px 0 44px;
color:var(--tx3);font-size:13.5px}
.pitch{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:20px 22px;margin:26px 0}
.pitch p{margin:0;color:var(--tx2)}.pitch strong{color:var(--tx)}
`;

const nav = `<header class="nav"><div class="wrap">
<a class="brand" href="/"><span>&#9672;</span> DryRun</a>
<nav><a href="/visualize">Visualizations</a><a href="/learn">Learn</a><a href="/app">Open the tool</a></nav>
</div></header>`;

const footer = `<footer><div class="wrap">
<p><strong style="color:var(--tx2)">DryRun</strong> runs your real code and shows you every step —
memory, stack frames and data structures — with an AI tutor grounded in the actual execution.</p>
<p style="margin-top:8px"><a href="/app">Open the tool</a> &middot;
<a href="/visualize">All visualizations</a> &middot; <a href="/learn">Learn</a></p>
</div></footer>`;

function page({ head, body, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="canonical" href="${canonical}">
${head}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='8' y='8' width='16' height='16' rx='3' transform='rotate(45 16 16)' fill='%237c3aed'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>${nav}<main class="wrap">${body}</main>${footer}</body>
</html>`;
}

function socialTags({ title, desc, url }) {
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${OG_IMAGE}">`;
}

// ── per-algorithm page ────────────────────────────────────────────────────
function algoPage(a, bySlug) {
  const url  = `${SITE_URL}/visualize/${a.slug}`;
  const code = (a.code || []).join('\n');
  const runHref = `/app?code=${encodeURIComponent(code)}&from=${encodeURIComponent(a.slug)}`;

  const ld = [
    { '@context':'https://schema.org','@type':'TechArticle',
      headline:a.h1, description:a.metaDescription, url,
      about:a.primaryKeyword, inLanguage:'en',
      publisher:{'@type':'Organization',name:SITE_NAME,url:SITE_URL},
      mainEntityOfPage:{'@type':'WebPage','@id':url} },
    { '@context':'https://schema.org','@type':'BreadcrumbList', itemListElement:[
      {'@type':'ListItem',position:1,name:'Home',item:SITE_URL},
      {'@type':'ListItem',position:2,name:'Visualizations',item:`${SITE_URL}/visualize`},
      {'@type':'ListItem',position:3,name:a.h1,item:url}] },
  ];
  if ((a.faq || []).length) ld.push({
    '@context':'https://schema.org','@type':'FAQPage',
    mainEntity:a.faq.map(f => ({'@type':'Question',name:f.q,
      acceptedAnswer:{'@type':'Answer',text:f.a}})) });

  const rel = (a.related || []).filter(s => bySlug[s])
    .map(s => `<a href="/visualize/${s}">${esc(bySlug[s].h1)}</a>`).join('');

  const body = `
<div class="crumb"><a href="/visualize" style="color:var(--tx3)">Visualizations</a> / ${esc(a.category||'')}</div>
<h1>${esc(a.h1)}</h1>
<p class="lede">${esc(a.intro)}</p>
<p><a class="cta" href="${runHref}">&#9654; Run this code in DryRun</a></p>
<div class="pitch"><p><strong>This isn't a canned animation.</strong> DryRun compiles and executes
the code below, then draws every step from the real trace — the same values your machine would produce.</p></div>
<h2>The code</h2>
<pre><code>${esc(code)}</code></pre>
${a.codeNote ? `<p>${esc(a.codeNote)}</p>` : ''}
<h2>How it works, step by step</h2>
${(a.howItWorks||[]).map(s => `<div class="step"><h3>${esc(s.heading)}</h3><p>${esc(s.body)}</p></div>`).join('')}
${a.complexity ? `<h2>Complexity</h2><div class="cx">
<span class="chip"><b>time</b> ${esc(a.complexity.time)}</span>
<span class="chip"><b>space</b> ${esc(a.complexity.space)}</span></div>
<p>${esc(a.complexity.note)}</p>` : ''}
${(a.gotchas||[]).length ? `<h2>Common bugs</h2>
${a.gotchas.map(g => `<div class="gotcha"><h3>${esc(g.title)}</h3><p>${esc(g.body)}</p></div>`).join('')}
<p>Each of these is easier to see than to describe — step through it and watch the values change.
<a href="${runHref}">Run it in DryRun</a>.</p>` : ''}
${(a.faq||[]).length ? `<h2>Frequently asked</h2>
${a.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}` : ''}
${rel ? `<h2>Related</h2><div class="rel">${rel}</div>` : ''}
<p style="margin-top:34px"><a class="cta" href="${runHref}">&#9654; Run this code in DryRun</a></p>`;

  return page({ canonical: url, body,
    head: socialTags({ title:a.title, desc:a.metaDescription, url }) +
      ld.map(o => `\n<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('') });
}

// ── index of all visualizations ───────────────────────────────────────────
function indexPage(list) {
  const url = `${SITE_URL}/visualize`;
  const cats = {};
  for (const a of list) (cats[a.category || 'other'] ||= []).push(a);
  const body = `
<h1>Algorithm Visualizations</h1>
<p class="lede">Every page here runs real C++ and animates the actual execution — not a pre-recorded
animation. Pick one, then run your own code the same way.</p>
<p><a class="cta" href="/app">&#9654; Open DryRun</a></p>
${Object.entries(cats).map(([c, items]) => `<h2 style="text-transform:capitalize">${esc(c)}</h2>
<div class="rel">${items.map(a => `<a href="/visualize/${a.slug}">${esc(a.h1)}</a>`).join('')}</div>`).join('')}`;
  const ld = { '@context':'https://schema.org','@type':'CollectionPage',
    name:'Algorithm Visualizations', url, description:DESCRIPTION,
    hasPart:list.map(a => ({'@type':'TechArticle',name:a.h1,url:`${SITE_URL}/visualize/${a.slug}`})) };
  return page({ canonical:url, body,
    head: socialTags({ title:'Algorithm Visualizations — Watch Real Code Run | DryRun',
      desc:'Step-by-step visualizations of sorting, searching, graph, tree and DP algorithms — each one executed for real, not animated by hand.',
      url }) + `\n<script type="application/ld+json">${JSON.stringify(ld)}</script>` });
}

// ── write everything ──────────────────────────────────────────────────────
function out(rel, html) {
  const p = join(DIST, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
}

if (!existsSync(DATA)) {
  console.error(`seo: ${DATA} not found — run the content generator first. Skipping.`);
  process.exit(0);
}
const list = JSON.parse(readFileSync(DATA, 'utf8'));
const bySlug = Object.fromEntries(list.map(a => [a.slug, a]));

for (const a of list) out(`visualize/${a.slug}/index.html`, algoPage(a, bySlug));
out('visualize/index.html', indexPage(list));

const urls = [
  { loc: `${SITE_URL}/`,             pri: '1.0', freq: 'weekly'  },
  { loc: `${SITE_URL}/visualize`,   pri: '0.9', freq: 'weekly'  },
  { loc: `${SITE_URL}/learn`,        pri: '0.7', freq: 'monthly' },
  { loc: `${SITE_URL}/app`,          pri: '0.8', freq: 'monthly' },
  ...list.map(a => ({ loc: `${SITE_URL}/visualize/${a.slug}`, pri: '0.8', freq: 'monthly' })),
];
out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>`);

out('robots.txt', `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml`);

console.log(`seo: ${list.length} algorithm pages + index, sitemap (${urls.length} urls), robots.txt -> dist/`);
