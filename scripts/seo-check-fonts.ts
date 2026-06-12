#!/usr/bin/env bun
/**
 * seo-check-fonts: walk public/fonts/** and ensure no Apple-proprietary
 * font binaries (or anything claiming to be from Apple/Helvetica/Sangam MN/
 * New York) sneak back into the repo. Exit 1 on any hit.
 *
 * Runs against bytes (latin1-ish) so name-table strings inside TTC/TTF/WOFF
 * containers are detected even though the binary container itself is opaque.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/fonts';
const FORBIDDEN_SUBSTRINGS = ['Apple Inc', 'Helvetica', 'Sangam MN', 'New York'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function bytesContain(buf: Buffer, needle: string): boolean {
  // Compare as latin1 — name-table strings in TTF/TTC/WOFF are ASCII or
  // UTF-16BE; latin1 catches the ASCII variants which is what we care about.
  // For UTF-16BE we also scan a sparse-byte form ("A\0p\0p\0l\0e\0...").
  if (buf.includes(needle, 0, 'latin1')) return true;
  const utf16 = Buffer.alloc(needle.length * 2);
  for (let i = 0; i < needle.length; i++) {
    utf16[i * 2] = 0;
    utf16[i * 2 + 1] = needle.charCodeAt(i);
  }
  return buf.includes(utf16);
}

function main(): number {
  let files: string[];
  try {
    files = walk(ROOT);
  } catch (err) {
    console.error(`seo-check-fonts: cannot read ${ROOT}: ${(err as Error).message}`);
    return 1;
  }

  if (files.length === 0) {
    console.error(`seo-check-fonts: no font files found under ${ROOT}`);
    return 1;
  }

  let violations = 0;
  for (const file of files) {
    if (!file.endsWith('.woff2')) {
      console.error(`VIOLATION non-woff2 asset: ${file}`);
      violations++;
      continue;
    }
    const buf = readFileSync(file);
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      if (bytesContain(buf, needle)) {
        console.error(`VIOLATION forbidden substring "${needle}" in: ${file}`);
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.error(
      `seo-check-fonts: FAIL (${violations} violation(s) across ${files.length} file(s))`,
    );
    return 1;
  }
  console.log(`seo-check-fonts: OK (${files.length} woff2 files clean)`);
  return 0;
}

process.exit(main());
