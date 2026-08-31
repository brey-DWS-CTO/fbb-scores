#!/usr/bin/env node
// Renders the rulebook to plain text with numbers computed from tree position.
// Nothing in the JSON stores a number. Usage: node scripts/render-rulebook.mjs [articleId]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const book = JSON.parse(readFileSync(join(root, 'src/data/source/rulebook-2027.json'), 'utf8'));

/** Walk the tree once, assigning every clause its derived number. */
function number(book) {
  const byId = new Map();
  book.articles.forEach((article, i) => {
    const n = String(i + 1);
    byId.set(article.id, { number: n, title: article.title, node: article });
    const walk = (clauses, prefix) => {
      clauses.forEach((clause, j) => {
        const num = `${prefix}.${j + 1}`;
        byId.set(clause.id, { number: num, title: clause.title, node: clause });
        if (clause.children) walk(clause.children, num);
      });
    };
    walk(article.clauses, n);
  });
  book.appendices.forEach((a) => byId.set(a.id, { number: a.label, title: a.title, node: a }));
  return byId;
}

const refs = number(book);

/** Replace {{ref:id}} with the target's current number, resolved fresh every render. */
const resolve = (text) =>
  text.replace(/\{\{ref:([^}]+)\}\}/g, (_, id) => {
    const hit = refs.get(id);
    if (!hit) return `[BROKEN REF: ${id}]`;
    return hit.title ? `${hit.number} ${hit.title}` : hit.number;
  });

const only = process.argv[2];
const out = [];

for (const article of book.articles) {
  if (only && article.id !== only) continue;
  const n = refs.get(article.id).number;
  out.push(`\n${n}. ${article.title.toUpperCase()}`);
  const walk = (clauses) => {
    for (const clause of clauses) {
      const num = refs.get(clause.id).number;
      const indent = '  '.repeat(num.split('.').length - 1);
      const head = clause.title ? `${clause.title}${clause.text ? '. ' : ''}` : '';
      const body = clause.text ? resolve(clause.text) : '';
      if (clause.kind === 'table') {
        out.push(`${indent}${num} ${head}`);
        out.push(`${indent}   ${clause.table.columns.join(' | ')}`);
        clause.table.rows.forEach((r) => out.push(`${indent}   ${r.join(' | ')}`));
      } else {
        const tag = clause.kind === 'example' ? 'Example: ' : '';
        out.push(`${indent}${num} ${tag}${head}${body}`);
      }
      if (clause.children) walk(clause.children);
    }
  };
  walk(article.clauses);
}

console.log(out.join('\n'));
