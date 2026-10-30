/**
 * 新建一篇文章：node new-post.mjs "标题"
 * 会生成 content/posts/<slug>.md 并预填 frontmatter。
 */
import { writeFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(ROOT, 'content', 'posts');

const title = process.argv.slice(2).join(' ').trim() || '无题';
const today = new Date();

const pad = (n) => String(n).padStart(2, '0');
const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

// 中文标题没法直接当文件名，用日期 + 序号兜底
const asciiSlug = title
  .toLowerCase()
  .replace(/[^\p{ASCII}]/gu, ' ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const slug = asciiSlug || `post-${date}-${pad(today.getHours())}${pad(today.getMinutes())}`;
const file = path.join(POSTS_DIR, `${slug}.md`);

await mkdir(POSTS_DIR, { recursive: true });

try {
  await access(file);
  console.error(`已存在同名文件，换个标题或手动改名：${path.relative(ROOT, file)}`);
  process.exit(1);
} catch {
  // 文件不存在，继续
}

const template = `---
title: ${title}
date: ${date}
summary: 一句话说清这篇要写什么（会显示在首页和 RSS 里）。
tags: [自我]
draft: true
---

正文从这里开始。按住 Shift+Enter 换行不产生新段落，直接空一行才是新段落。

## 小标题

写吧。
`;

await writeFile(file, template, 'utf8');
console.log(`✓ 已创建 ${path.relative(ROOT, file)}`);
console.log('  写好之后把 frontmatter 里的 draft: true 删掉（或改成 false），它才会进构建。');
