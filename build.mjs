/**
 * 极简静态博客生成器 —— 零运行时依赖，构建时只需要 vendor/ 里的 marked。
 *
 *   node build.mjs        → 生成 dist/
 *
 * 输入：content/posts/*.md（带 frontmatter）、content/about.md、site.config.mjs、static/
 * 输出：dist/ 下的 HTML、RSS、sitemap —— 直接丢给任何静态托管即可。
 */
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from './vendor/marked.esm.js';
import site from './site.config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const DIST = path.join(ROOT, 'dist');
const STATIC_DIR = path.join(ROOT, 'static');
const INCLUDE_DRAFTS = process.env.INCLUDE_DRAFTS === '1';

const THEME_BOOT =
  "(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

/* ---------- 小工具 ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function slugifyHeading(text) {
  return (
    stripTags(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'section'
  );
}

function parseDate(value) {
  const m = String(value ?? '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function zhDate(d) {
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/* ---------- frontmatter ---------- */

function splitFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };

  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);

    if (key === 'tags' || key === 'keywords') {
      data.tags = value
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^(['"])(.*)\1$/, '$2'))
        .filter(Boolean);
    } else {
      data[key] = value;
    }
  }
  return { data, body: text.slice(m[0].length) };
}

/* ---------- Markdown ---------- */

function renderMarkdown(md) {
  let html = marked.parse(md, { gfm: true, breaks: false, async: false });
  // 给二三级标题加锚点 id（每次渲染独立去重，避免跨文章串号）
  const seen = new Map();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
    let id = slugifyHeading(inner);
    const count = (seen.get(id) || 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;
    return `<h${level} id="${esc(id)}">${inner}</h${level}>`;
  });
  return html;
}

function readingMinutes(markdown) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[>#\-*+\d.\s]+/gm, ' ');
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / site.charsPerMinute + words / 220));
}

/* ---------- 版式 ---------- */

function layout({ title, description = site.description, base = '', body, isHome = false, canonical }) {
  const fullTitle = isHome ? `${site.title} · ${site.tagline}` : `${title} · ${site.title}`;
  return `<!doctype html>
<html lang="${esc(site.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="${esc(site.author)}">
<meta property="og:title" content="${esc(isHome ? site.title : title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${isHome ? 'website' : 'article'}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="stylesheet" href="${base}style.css">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${base}rss.xml">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#f8f5ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131211" media="(prefers-color-scheme: dark)">
<script>${THEME_BOOT}</script>
</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-header">
  <a class="brand" href="${base}index.html">${esc(site.title)}</a>
  <nav class="site-nav" aria-label="站点导航">
    <a href="${base}archive.html">归档</a>
    <a href="${base}tags.html">标签</a>
    <a href="${base}about.html">关于</a>
    <a href="${base}rss.xml">订阅</a>
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="切换主题">☾</button>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <p>© ${new Date().getFullYear()} ${esc(site.author)} · 用 Markdown 写的静态站 · <a href="${base}rss.xml">RSS</a></p>
</footer>
<script src="${base}theme.js"></script>
</body>
</html>`;
}

function postListItem(post, base) {
  return `      <article class="post-item">
        <h2 class="post-title"><a href="${base}posts/${esc(post.slug)}.html">${esc(post.title)}</a></h2>
        <p class="post-meta"><time datetime="${isoDate(post.date)}">${zhDate(post.date)}</time><span class="dot">·</span>约 ${post.minutes} 分钟</p>
        ${post.summary ? `<p class="post-summary">${esc(post.summary)}</p>` : ''}
      </article>`;
}

function tagLinks(post, base) {
  return post.tags
    .map((t) => `<a class="tag" href="${base}tags/${encodeURIComponent(t)}.html">${esc(t)}</a>`)
    .join('');
}

/* ---------- 页面 ---------- */

function homePage(posts) {
  const shown = posts.slice(0, site.pageSize);
  const body = `  <section class="hero">
    <h1 class="hero-title">${esc(site.title)}</h1>
    <p class="hero-tagline">${esc(site.tagline)}</p>
  </section>

  <section class="post-list" aria-label="文章列表">
${shown.map((p) => postListItem(p, '')).join('\n')}
  </section>
${
  posts.length > shown.length
    ? `\n  <p class="more"><a href="archive.html">全部 ${posts.length} 篇 →</a></p>`
    : ''
}`;
  return layout({ isHome: true, base: '', body, canonical: `${site.url}/index.html` });
}

function postPage(post, all) {
  const index = all.findIndex((p) => p.slug === post.slug);
  const newer = index > 0 ? all[index - 1] : null; // 列表按时间倒序
  const older = index < all.length - 1 ? all[index + 1] : null;

  const related = all
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, score: p.tags.filter((t) => post.tags.includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.p);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished: isoDate(post.date),
    author: { '@type': 'Person', name: site.author },
    description: post.summary || site.description,
    url: `${site.url}/posts/${post.slug}.html`,
    inLanguage: site.lang,
  };

  const body = `  <article class="post">
    <header class="post-header">
      <h1 class="post-title">${esc(post.title)}</h1>
      <p class="post-meta"><time datetime="${isoDate(post.date)}">${zhDate(post.date)}</time><span class="dot">·</span>约 ${post.minutes} 分钟阅读${
        post.tags.length ? `<span class="dot">·</span>${tagLinks(post, '../')}` : ''
      }</p>
    </header>

    <div class="post-body">
${post.html}
    </div>

    <footer class="post-footer">
${
  newer || older
    ? `      <nav class="pager" aria-label="上一篇 / 下一篇">
${older ? `        <a class="pager-prev" href="../posts/${esc(older.slug)}.html"><span>← 更早</span>${esc(older.title)}</a>` : '        <span></span>'}
${newer ? `        <a class="pager-next" href="../posts/${esc(newer.slug)}.html"><span>更晚 →</span>${esc(newer.title)}</a>` : '        <span></span>'}
      </nav>`
    : ''
}
${
  related.length
    ? `      <section class="related">
        <h2>相关</h2>
        <ul>
${related.map((p) => `          <li><a href="../posts/${esc(p.slug)}.html">${esc(p.title)}</a></li>`).join('\n')}
        </ul>
      </section>`
    : ''
}
      <p class="back"><a href="../index.html">← 回到首页</a></p>
    </footer>
  </article>

  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>`;

  return layout({
    title: post.title,
    description: post.summary || site.description,
    base: '../',
    body,
    canonical: `${site.url}/posts/${post.slug}.html`,
  });
}

function archivePage(posts) {
  const years = new Map();
  for (const p of posts) {
    const y = String(p.date.getUTCFullYear());
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(p);
  }
  const sections = [...years.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(
      ([year, list]) => `    <section class="archive-year">
      <h2>${year}</h2>
      <ul class="archive-list">
${list
  .map(
    (p) =>
      `        <li><time datetime="${isoDate(p.date)}">${String(p.date.getUTCMonth() + 1).padStart(2, '0')}-${String(
        p.date.getUTCDate()
      ).padStart(2, '0')}</time><a href="posts/${esc(p.slug)}.html">${esc(p.title)}</a></li>`
  )
  .join('\n')}
      </ul>
    </section>`
    )
    .join('\n');

  const body = `  <header class="page-header">
    <h1>归档</h1>
    <p class="page-sub">共 ${posts.length} 篇</p>
  </header>
${sections}`;
  return layout({ title: '归档', base: '', body, canonical: `${site.url}/archive.html` });
}

function tagsPage(posts) {
  const count = new Map();
  for (const p of posts) for (const t of p.tags) count.set(t, (count.get(t) || 0) + 1);
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));

  const body = `  <header class="page-header">
    <h1>标签</h1>
    <p class="page-sub">共 ${sorted.length} 个主题</p>
  </header>
  <ul class="tag-cloud">
${sorted
  .map(
    ([t, n]) =>
      `    <li><a class="tag" href="tags/${encodeURIComponent(t)}.html">${esc(t)}<sup>${n}</sup></a></li>`
  )
  .join('\n')}
  </ul>`;
  return layout({ title: '标签', base: '', body, canonical: `${site.url}/tags.html` });
}

function tagPage(tag, posts) {
  const body = `  <header class="page-header">
    <h1>#${esc(tag)}</h1>
    <p class="page-sub">共 ${posts.length} 篇 · <a href="../tags.html">全部标签</a></p>
  </header>

  <section class="post-list">
${posts.map((p) => postListItem(p, '../')).join('\n')}
  </section>`;
  return layout({ title: `#${tag}`, base: '../', body, canonical: `${site.url}/tags/${encodeURIComponent(tag)}.html` });
}

function aboutPage(page) {
  const body = `  <article class="post">
    <header class="post-header">
      <h1 class="post-title">${esc(page.title)}</h1>
    </header>
    <div class="post-body">
${page.html}
    </div>
  </article>`;
  return layout({ title: page.title, base: '', body, canonical: `${site.url}/about.html` });
}

function notFoundPage() {
  const body = `  <header class="page-header">
    <h1>404</h1>
    <p class="page-sub">这一页没有被写下来。</p>
  </header>
  <p><a href="index.html">← 回到首页</a></p>`;
  return layout({ title: '找不到页面', base: '', body });
}

function rssFeed(posts) {
  const items = posts
    .slice(0, 30)
    .map((p) => {
      const link = `${site.url}/posts/${p.slug}.html`;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${p.date.toUTCString()}</pubDate>
      <description>${esc(p.summary || '')}</description>
      <content:encoded><![CDATA[${p.html}]]></content:encoded>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(site.title)}</title>
    <link>${esc(site.url)}/</link>
    <description>${esc(site.description)}</description>
    <language>${esc(site.lang)}</language>
    <lastBuildDate>${(posts[0]?.date || new Date()).toUTCString()}</lastBuildDate>
    <atom:link href="${esc(site.url)}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function sitemap(posts, tags) {
  const urls = [
    { loc: `${site.url}/`, lastmod: isoDate(posts[0]?.date || new Date()) },
    { loc: `${site.url}/archive.html`, lastmod: isoDate(new Date()) },
    { loc: `${site.url}/tags.html`, lastmod: isoDate(new Date()) },
    { loc: `${site.url}/about.html`, lastmod: isoDate(new Date()) },
    ...posts.map((p) => ({ loc: `${site.url}/posts/${p.slug}.html`, lastmod: isoDate(p.date) })),
    ...tags.map((t) => ({
      loc: `${site.url}/tags/${encodeURIComponent(t)}.html`,
      lastmod: isoDate(posts.find((p) => p.tags.includes(t))?.date || new Date()),
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

/* ---------- 主流程 ---------- */

async function main() {
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  const posts = [];

  for (const file of files) {
    const raw = await readFile(path.join(POSTS_DIR, file), 'utf8');
    const { data, body } = splitFrontmatter(raw);

    if (String(data.draft).toLowerCase() === 'true' && !INCLUDE_DRAFTS) continue;

    const slug = (data.slug || file.replace(/\.md$/, '')).replace(/\s+/g, '-');
    const title = data.title || slug;
    posts.push({
      slug,
      title,
      summary: data.summary || '',
      date: parseDate(data.date) || new Date(0),
      tags: data.tags || [],
      markdown: body,
      html: renderMarkdown(body),
      minutes: readingMinutes(body),
    });
  }

  posts.sort((a, b) => b.date - a.date || a.slug.localeCompare(b.slug));

  const aboutRaw = await readFile(path.join(ROOT, 'content', 'about.md'), 'utf8');
  const about = splitFrontmatter(aboutRaw);
  const aboutPageData = {
    title: about.data.title || '关于',
    html: renderMarkdown(about.body),
  };

  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'posts'), { recursive: true });
  await mkdir(path.join(DIST, 'tags'), { recursive: true });
  await cp(STATIC_DIR, DIST, { recursive: true });

  const write = async (rel, content) => {
    const target = path.join(DIST, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  };

  await write('index.html', homePage(posts));
  await write('archive.html', archivePage(posts));
  await write('tags.html', tagsPage(posts));
  await write('about.html', aboutPage(aboutPageData));
  await write('404.html', notFoundPage());
  await write('rss.xml', rssFeed(posts));
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);

  for (const post of posts) {
    await write(`posts/${post.slug}.html`, postPage(post, posts));
  }

  const tagNames = [...new Set(posts.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'zh'));
  for (const tag of tagNames) {
    await write(`tags/${tag}.html`, tagPage(tag, posts.filter((p) => p.tags.includes(tag))));
  }

  await write('sitemap.xml', sitemap(posts, tagNames));

  console.log(`✓ 构建完成：${posts.length} 篇文章，${tagNames.length} 个标签 → dist/`);
  for (const p of posts) console.log(`  · ${isoDate(p.date)}  ${p.title}  (${p.minutes} 分钟)`);
}

main().catch((err) => {
  console.error('构建失败：', err);
  process.exit(1);
});
