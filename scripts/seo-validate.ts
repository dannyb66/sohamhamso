#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { CANONICAL_TRADITIONS } from '../src/lib/aliases';
import { ALL_LANGS } from '../src/lib/seo/i18n-routes';

export const DEFAULT_TITLE_RANGE = { min: 1, max: 80 } as const;
export const DEFAULT_DESCRIPTION_RANGE = { min: 1, max: 220 } as const;
const DEFAULT_SAMPLE_LIMIT = 5;
const DYNAMIC_OG_PREFIXES = ['/og/'] as const;
const RUNTIME_ROUTE_PREFIXES = ['/search'] as const;
// Canonical (live-URL) traditions only — sourced from src/lib/aliases.ts so
// the route-shape checks can't drift from the alias/redirect surface.
const KNOWN_TRADITIONS = new Set<string>(CANONICAL_TRADITIONS);

export type ValidationRule =
  | 'title-length'
  | 'description-length'
  | 'canonical'
  | 'og-image'
  | 'hreflang'
  | 'jsonld'
  | 'internal-links'
  | 'redirect';

export interface ValidationIssue {
  rule: ValidationRule;
  file: string;
  message: string;
  fixApplied?: boolean;
}

export interface ValidationFileReport {
  filePath: string;
  routePath: string;
  pageUrl: string;
  htmlLang: string | null;
  title: string | null;
  description: string | null;
  canonicalHref: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  ogImageHref: string | null;
  ogImageUrl: string | null;
  hreflangEntries: HreflangEntry[];
  jsonLd: JsonLdBlock[];
  internalLinks: string[];
  isRedirect: boolean;
  redirectTargetHref: string | null;
  issues: ValidationIssue[];
  fixedHtml?: string;
}

export interface ValidationSummary {
  ok: boolean;
  scannedFiles: number;
  issueCount: number;
  fixedCount: number;
  skippedFiles: number;
  grouped: Array<{
    rule: ValidationRule;
    count: number;
    sample: ValidationIssue[];
  }>;
  issues: ValidationIssue[];
  files: ValidationFileReport[];
}

export interface ValidateBuildOptions {
  distDir: string;
  siteOrigin: string;
  fix?: boolean;
  sampleLimit?: number;
  redirectSourcePatterns?: string[];
}

export interface ValidateCliOptions extends ValidateBuildOptions {
  json?: boolean;
}

export interface HreflangEntry {
  hrefLang: string;
  href: string;
  url: string | null;
}

export interface JsonLdBlock {
  raw: string;
  parsed: unknown | null;
  error: string | null;
}

interface HtmlMeta {
  htmlLang: string | null;
  title: string | null;
  description: string | null;
  canonicalHref: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  ogImageHref: string | null;
  ogImageUrl: string | null;
  hreflangEntries: HreflangEntry[];
  jsonLd: JsonLdBlock[];
  internalLinks: string[];
  isRedirect: boolean;
  redirectTargetHref: string | null;
}

interface ParsedCliArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export async function resolveSiteOrigin(explicit?: string): Promise<string> {
  const raw =
    explicit ??
    (typeof process !== 'undefined' ? process.env.SOHAMHAMSO_SITE_ORIGIN : undefined) ??
    (await loadAstroSiteOrigin()) ??
    'https://sohamhamso.org';
  return normalizeOrigin(raw);
}

async function loadAstroSiteOrigin(): Promise<string | undefined> {
  try {
    const mod = await import('../astro.config.mjs');
    const site = mod?.default?.site;
    return typeof site === 'string' ? site : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const trimmed = arg.slice(2);
    if (trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      flags[key] = rest.join('=');
      continue;
    }
    flags[trimmed] = true;
  }
  return { flags, positionals };
}

export async function collectHtmlFiles(distDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(fullPath);
      }
    }
  }
  await walk(distDir);
  return files.sort();
}

export function inferRoutePath(distDir: string, filePath: string): string {
  const rel = relative(distDir, filePath).replaceAll('\\', '/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) {
    return `/${rel.slice(0, -'/index.html'.length)}`;
  }
  if (rel.endsWith('.html')) {
    return `/${rel.slice(0, -'.html'.length)}`;
  }
  return `/${rel}`;
}

export function toPageUrl(routePath: string, siteOrigin: string): string {
  return new URL(routePath === '/' ? '/' : routePath, `${normalizeOrigin(siteOrigin)}/`).toString();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function collapseWhitespace(input: string | null | undefined): string | null {
  if (!input) return null;
  return input.replace(/\s+/g, ' ').trim();
}

function parseAttributes(tagSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>"'`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s=/>"'`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tagSource))) {
    const [, key, dq, sq, bare] = match;
    const value = dq ?? sq ?? bare ?? '';
    attrs[key.toLowerCase()] = decodeHtmlEntities(value);
  }
  return attrs;
}

function extractHtmlMeta(html: string, pageUrl: string, siteOrigin: string): HtmlMeta {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const htmlMatch = html.match(/<html\b[^>]*\blang=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const title = collapseWhitespace(decodeHtmlEntities(titleMatch?.[1] ?? ''));
  const htmlLang = collapseWhitespace(htmlMatch?.[1] ?? htmlMatch?.[2] ?? htmlMatch?.[3] ?? '');

  let description: string | null = null;
  let canonicalHref: string | null = null;
  let canonicalUrl: string | null = null;
  let robots: string | null = null;
  let ogImageHref: string | null = null;
  let ogImageUrl: string | null = null;
  const hreflangEntries: HreflangEntry[] = [];
  const internalLinks: string[] = [];

  const metaTagRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaTagRe) ?? []) {
    const attrs = parseAttributes(tag);
    const name = attrs.name?.toLowerCase();
    const property = attrs.property?.toLowerCase();
    const content = collapseWhitespace(attrs.content);
    if (name === 'description') description = content;
    if (name === 'robots') robots = content?.toLowerCase() ?? null;
    if (property === 'og:image') {
      ogImageHref = attrs.content ?? null;
      ogImageUrl = toAbsoluteUrl(ogImageHref, pageUrl, siteOrigin);
    }
  }

  const linkTagRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkTagRe) ?? []) {
    const attrs = parseAttributes(tag);
    const rel = attrs.rel?.toLowerCase() ?? '';
    const href = attrs.href ?? '';
    if (!href) continue;
    if (rel === 'canonical') {
      canonicalHref = href;
      canonicalUrl = toAbsoluteUrl(href, pageUrl, siteOrigin);
      continue;
    }
    if (rel.includes('alternate') && attrs.hreflang) {
      hreflangEntries.push({
        hrefLang: attrs.hreflang.toLowerCase(),
        href,
        url: toAbsoluteUrl(href, pageUrl, siteOrigin),
      });
    }
  }

  const anchorTagRe = /<a\b[^>]*>/gi;
  for (const tag of html.match(anchorTagRe) ?? []) {
    const attrs = parseAttributes(tag);
    if (attrs.href) internalLinks.push(attrs.href);
  }

  const jsonLd: JsonLdBlock[] = [];
  const scriptTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptTagRe.exec(html))) {
    const attrs = parseAttributes(scriptMatch[1] ?? '');
    if (attrs.type?.toLowerCase() !== 'application/ld+json') continue;
    const raw = (scriptMatch[2] ?? '').trim();
    if (raw.length === 0) {
      jsonLd.push({ raw, parsed: null, error: 'Empty JSON-LD block.' });
      continue;
    }
    try {
      jsonLd.push({ raw, parsed: JSON.parse(raw), error: null });
    } catch (error) {
      jsonLd.push({
        raw,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const redirectMatch = html.match(
    /<meta\b[^>]*http-equiv=(?:"refresh"|'refresh'|refresh)[^>]*content=(?:"[^"]*url=([^"]+)"|'[^']*url=([^']+)'|[^\s>]*url=([^\s>]+))/i,
  );
  const redirectTargetHref =
    collapseWhitespace(redirectMatch?.[1] ?? redirectMatch?.[2] ?? redirectMatch?.[3] ?? '') ??
    null;

  return {
    htmlLang,
    title,
    description,
    canonicalHref,
    canonicalUrl,
    robots,
    ogImageHref,
    ogImageUrl,
    hreflangEntries,
    jsonLd,
    internalLinks,
    isRedirect: redirectTargetHref !== null,
    redirectTargetHref,
  };
}

function toAbsoluteUrl(
  href: string | null | undefined,
  pageUrl: string,
  siteOrigin: string,
): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    if (url.origin !== normalizeOrigin(siteOrigin)) return url.toString();
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function pathFromInternalHref(href: string, pageUrl: string, siteOrigin: string): string | null {
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:') ||
    href.startsWith('data:')
  ) {
    return null;
  }

  try {
    const url = new URL(href, pageUrl);
    if (url.origin !== normalizeOrigin(siteOrigin)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function distCandidatePaths(distDir: string, pathname: string): string[] {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  if (normalized === '/') {
    return [resolve(distDir, 'index.html')];
  }

  const rel = normalized.replace(/^\//, '');
  if (extname(rel)) {
    return [resolve(distDir, rel)];
  }

  return [
    resolve(distDir, rel, 'index.html'),
    resolve(distDir, `${rel}.html`),
    resolve(distDir, rel),
  ];
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function fileExistsAny(candidates: string[]): boolean {
  return candidates.some((candidate) => existsSync(candidate));
}

function isNoindex(robots: string | null): boolean {
  return (
    robots
      ?.split(',')
      .map((part) => part.trim())
      .includes('noindex') ?? false
  );
}

function requiresHreflang(routePath: string): boolean {
  const parts = normalizePathname(routePath).split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1) {
    return (
      ALL_LANGS.includes(parts[0] as (typeof ALL_LANGS)[number]) || KNOWN_TRADITIONS.has(parts[0])
    );
  }
  if (parts.length === 2) {
    return KNOWN_TRADITIONS.has(parts[0]);
  }
  if (parts.length === 3) {
    return (
      ALL_LANGS.includes(parts[0] as (typeof ALL_LANGS)[number]) && KNOWN_TRADITIONS.has(parts[1])
    );
  }
  if (parts.length === 4) {
    return KNOWN_TRADITIONS.has(parts[0]) && /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3]);
  }
  if (parts.length === 5) {
    return (
      ALL_LANGS.includes(parts[0] as (typeof ALL_LANGS)[number]) &&
      KNOWN_TRADITIONS.has(parts[1]) &&
      /^\d+$/.test(parts[3]) &&
      /^\d+$/.test(parts[4])
    );
  }
  return false;
}

function isRuntimeRoute(pathname: string): boolean {
  return RUNTIME_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function matchesRedirectSource(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePathname(pattern);
    if (normalizedPattern.endsWith('/*')) {
      const base = normalizedPattern.slice(0, -2);
      return pathname === base || pathname.startsWith(`${base}/`);
    }
    return pathname === normalizedPattern;
  });
}

async function loadRedirectSourcePatterns(distDir: string): Promise<string[]> {
  const redirectsPath = resolve(distDir, '..', 'public', '_redirects');
  if (!existsSync(redirectsPath)) return [];
  const contents = await readFile(redirectsPath, 'utf8');
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

function truncateForTitle(input: string, max = DEFAULT_TITLE_RANGE.max): string {
  const clean = collapseWhitespace(input) ?? '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function ensureTerminalPunctuation(input: string): string {
  if (/[.!?।॥]$/.test(input)) return input;
  return `${input}.`;
}

function applySafeFixes(html: string): { html: string; fixedCount: number } {
  let next = html;
  let fixedCount = 0;

  next = next.replace(/<title[^>]*>([\s\S]*?)<\/title>/i, (full, titleRaw: string) => {
    const clean = collapseWhitespace(decodeHtmlEntities(titleRaw)) ?? '';
    if (clean.length <= DEFAULT_TITLE_RANGE.max) return full;
    fixedCount += 1;
    return full.replace(titleRaw, escapeHtml(truncateForTitle(clean)));
  });

  next = next.replace(
    /<meta\b([^>]*name=(?:"description"|'description'|description)[^>]*)>/i,
    (full) => {
      const attrs = parseAttributes(full);
      const description = collapseWhitespace(attrs.content);
      if (!description) return full;
      const punctuated = ensureTerminalPunctuation(description);
      if (punctuated === description) return full;
      fixedCount += 1;
      return full.replace(attrs.content, escapeHtml(punctuated));
    },
  );

  return { html: next, fixedCount };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pushIssue(
  issues: ValidationIssue[],
  rule: ValidationRule,
  filePath: string,
  message: string,
  fixApplied = false,
): void {
  issues.push({ rule, file: filePath, message, fixApplied });
}

export async function inspectHtmlFile(
  filePath: string,
  options: ValidateBuildOptions,
): Promise<ValidationFileReport> {
  const routePath = inferRoutePath(options.distDir, filePath);
  const pageUrl = toPageUrl(routePath, options.siteOrigin);
  let html = await readFile(filePath, 'utf8');
  let fixedHtml: string | undefined;
  let fixedCount = 0;

  if (options.fix) {
    const fixed = applySafeFixes(html);
    fixedHtml = fixed.html;
    fixedCount = fixed.fixedCount;
    html = fixed.html;
    if (fixedCount > 0) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, fixed.html, 'utf8');
    }
  }

  const meta = extractHtmlMeta(html, pageUrl, options.siteOrigin);
  const issues: ValidationIssue[] = [];
  const expectedCanonical = pageUrl;
  const noindex = isNoindex(meta.robots);

  if (meta.isRedirect) {
    if (!noindex) {
      pushIssue(issues, 'redirect', filePath, 'Redirect page must be marked noindex.');
    }
    if (!meta.redirectTargetHref) {
      pushIssue(issues, 'redirect', filePath, 'Redirect page is missing a refresh target.');
    }
    if (!meta.canonicalUrl) {
      pushIssue(issues, 'canonical', filePath, 'Redirect page is missing canonical href.');
    } else if (meta.redirectTargetHref) {
      const redirectUrl = toAbsoluteUrl(meta.redirectTargetHref, pageUrl, options.siteOrigin);
      if (redirectUrl !== meta.canonicalUrl) {
        pushIssue(
          issues,
          'redirect',
          filePath,
          `Redirect target ${meta.redirectTargetHref} does not match canonical ${meta.canonicalHref}.`,
        );
      }
    }
  } else {
    if (!meta.title) {
      pushIssue(issues, 'title-length', filePath, 'Missing <title>.');
    } else if (
      meta.title.length < DEFAULT_TITLE_RANGE.min ||
      meta.title.length > DEFAULT_TITLE_RANGE.max
    ) {
      pushIssue(
        issues,
        'title-length',
        filePath,
        `Title length ${meta.title.length} is outside ${DEFAULT_TITLE_RANGE.min}-${DEFAULT_TITLE_RANGE.max}.`,
      );
    }

    if (!meta.description) {
      pushIssue(issues, 'description-length', filePath, 'Missing meta description.');
    } else if (
      meta.description.length < DEFAULT_DESCRIPTION_RANGE.min ||
      meta.description.length > DEFAULT_DESCRIPTION_RANGE.max
    ) {
      pushIssue(
        issues,
        'description-length',
        filePath,
        `Description length ${meta.description.length} is outside ${DEFAULT_DESCRIPTION_RANGE.min}-${DEFAULT_DESCRIPTION_RANGE.max}.`,
      );
    }

    if (!meta.ogImageHref) {
      pushIssue(issues, 'og-image', filePath, 'Missing `og:image` meta tag.');
    } else if (!meta.ogImageUrl) {
      pushIssue(issues, 'og-image', filePath, `Invalid og:image URL: ${meta.ogImageHref}`);
    } else {
      const ogPath = pathFromInternalHref(meta.ogImageHref, pageUrl, options.siteOrigin);
      if (
        ogPath &&
        !DYNAMIC_OG_PREFIXES.some((prefix) => ogPath.startsWith(prefix)) &&
        !fileExistsAny(distCandidatePaths(options.distDir, ogPath))
      ) {
        pushIssue(issues, 'og-image', filePath, `og:image target is missing from dist: ${ogPath}`);
      }
    }

    if (meta.jsonLd.length === 0) {
      pushIssue(issues, 'jsonld', filePath, 'Missing JSON-LD block.');
    } else {
      for (const block of meta.jsonLd) {
        if (block.error) {
          pushIssue(issues, 'jsonld', filePath, `Invalid JSON-LD: ${block.error}`);
        }
      }
    }

    if (noindex) {
      if (meta.hreflangEntries.length > 0) {
        pushIssue(issues, 'hreflang', filePath, 'Noindex page must not emit hreflang entries.');
      }
    } else if (meta.hreflangEntries.length === 0) {
      if (!requiresHreflang(routePath)) {
        // Single-locale chrome pages are allowed to omit hreflang.
      } else {
        pushIssue(issues, 'hreflang', filePath, 'Missing hreflang cluster.');
      }
    } else {
      if (!meta.hreflangEntries.some((entry) => entry.hrefLang === 'x-default')) {
        pushIssue(issues, 'hreflang', filePath, 'Missing x-default hreflang entry.');
      }
      if (!meta.canonicalUrl) {
        pushIssue(issues, 'hreflang', filePath, 'Cannot validate hreflang without canonical URL.');
      } else if (
        !meta.hreflangEntries.some(
          (entry) => entry.url === meta.canonicalUrl && entry.hrefLang === (meta.htmlLang ?? 'en'),
        )
      ) {
        pushIssue(
          issues,
          'hreflang',
          filePath,
          `Missing self hreflang entry for ${meta.htmlLang ?? 'en'} → ${meta.canonicalUrl}.`,
        );
      }
    }
  }

  if (!meta.canonicalHref) {
    pushIssue(issues, 'canonical', filePath, 'Missing canonical href.');
  } else if (!meta.canonicalUrl) {
    pushIssue(issues, 'canonical', filePath, `Invalid canonical href: ${meta.canonicalHref}`);
  } else if (!meta.isRedirect && meta.canonicalUrl !== expectedCanonical) {
    pushIssue(
      issues,
      'canonical',
      filePath,
      `Canonical mismatch. Expected ${expectedCanonical}, found ${meta.canonicalUrl}.`,
    );
  }

  if (!meta.isRedirect) {
    for (const href of meta.internalLinks) {
      const targetPath = pathFromInternalHref(href, pageUrl, options.siteOrigin);
      if (!targetPath) continue;
      if (
        !fileExistsAny(distCandidatePaths(options.distDir, targetPath)) &&
        !isRuntimeRoute(targetPath) &&
        !matchesRedirectSource(targetPath, options.redirectSourcePatterns ?? [])
      ) {
        pushIssue(issues, 'internal-links', filePath, `Broken internal link: ${href}`);
      }
    }
  }

  return {
    filePath,
    routePath,
    pageUrl,
    htmlLang: meta.htmlLang,
    title: meta.title,
    description: meta.description,
    canonicalHref: meta.canonicalHref,
    canonicalUrl: meta.canonicalUrl,
    robots: meta.robots,
    ogImageHref: meta.ogImageHref,
    ogImageUrl: meta.ogImageUrl,
    hreflangEntries: meta.hreflangEntries,
    jsonLd: meta.jsonLd,
    internalLinks: meta.internalLinks,
    isRedirect: meta.isRedirect,
    redirectTargetHref: meta.redirectTargetHref,
    issues: issues.map((issue) => ({
      ...issue,
      fixApplied: issue.fixApplied || fixedCount > 0,
    })),
    fixedHtml,
  };
}

function sameHreflangSet(a: HreflangEntry[], b: HreflangEntry[]): boolean {
  const normalize = (entries: HreflangEntry[]) =>
    entries
      .map((entry) => `${entry.hrefLang}|${entry.url ?? entry.href}`)
      .sort()
      .join('\n');
  return normalize(a) === normalize(b);
}

function validateCrossDocumentRules(
  files: ValidationFileReport[],
  siteOrigin: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const docsByCanonical = new Map<string, ValidationFileReport>();

  for (const file of files) {
    // Skip redirect stubs: they point their canonical at the real page but are
    // themselves noindex, so they must not overwrite the real page in this map.
    if (file.canonicalUrl && !file.isRedirect) docsByCanonical.set(file.canonicalUrl, file);
  }

  for (const file of files) {
    if (file.isRedirect || file.hreflangEntries.length === 0) continue;

    if (isNoindex(file.robots) && file.hreflangEntries.length > 0) {
      pushIssue(issues, 'hreflang', file.filePath, 'Noindex page must not emit hreflang entries.');
    }

    for (const entry of file.hreflangEntries) {
      if (!entry.url) {
        pushIssue(issues, 'hreflang', file.filePath, `Invalid hreflang URL: ${entry.href}`);
        continue;
      }
      const targetUrl = new URL(entry.url);
      if (targetUrl.origin !== normalizeOrigin(siteOrigin)) continue;
      const target = docsByCanonical.get(entry.url);
      if (!target) {
        pushIssue(
          issues,
          'hreflang',
          file.filePath,
          `Hreflang target does not resolve to a built page: ${entry.href}`,
        );
        continue;
      }
      if (isNoindex(target.robots)) {
        pushIssue(
          issues,
          'hreflang',
          file.filePath,
          `Hreflang entry points at noindex page: ${entry.url}`,
        );
      }
      if (!target.hreflangEntries.some((targetEntry) => targetEntry.url === file.canonicalUrl)) {
        pushIssue(
          issues,
          'hreflang',
          file.filePath,
          `Hreflang target ${entry.url} is missing a reciprocal link back to ${file.canonicalUrl}.`,
        );
      }
      if (!sameHreflangSet(file.hreflangEntries, target.hreflangEntries)) {
        pushIssue(
          issues,
          'hreflang',
          file.filePath,
          `Hreflang cluster differs between ${file.routePath} and ${target.routePath}.`,
        );
      }
    }
  }

  return issues;
}

function groupIssues(
  issues: ValidationIssue[],
  sampleLimit: number,
): Array<{ rule: ValidationRule; count: number; sample: ValidationIssue[] }> {
  const grouped = new Map<ValidationRule, ValidationIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.rule) ?? [];
    list.push(issue);
    grouped.set(issue.rule, list);
  }

  return [...grouped.entries()]
    .map(([rule, list]) => ({
      rule,
      count: list.length,
      sample: list.slice(0, sampleLimit),
    }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export async function validateBuild(options: ValidateBuildOptions): Promise<ValidationSummary> {
  const distDir = resolve(options.distDir);
  const files = await collectHtmlFiles(distDir);
  const redirectSourcePatterns =
    options.redirectSourcePatterns ?? (await loadRedirectSourcePatterns(distDir));
  const fileReports: ValidationFileReport[] = [];

  for (const group of chunk(files, 100)) {
    const inspected = await Promise.all(
      group.map((filePath) =>
        inspectHtmlFile(filePath, { ...options, distDir, redirectSourcePatterns }),
      ),
    );
    fileReports.push(...inspected);
  }

  const crossDocIssues = validateCrossDocumentRules(fileReports, options.siteOrigin);
  for (const issue of crossDocIssues) {
    const report = fileReports.find((candidate) => candidate.filePath === issue.file);
    report?.issues.push(issue);
  }

  const allIssues = fileReports.flatMap((file) => file.issues);
  const grouped = groupIssues(allIssues, options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
  const fixedCount = allIssues.filter((issue) => issue.fixApplied).length;

  return {
    ok: allIssues.length === 0,
    scannedFiles: fileReports.length,
    issueCount: allIssues.length,
    fixedCount,
    skippedFiles: fileReports.filter((file) => file.isRedirect).length,
    grouped,
    issues: allIssues,
    files: fileReports,
  };
}

function formatHumanSummary(summary: ValidationSummary): string {
  if (summary.ok) {
    return [
      `SEO validation passed.`,
      `Scanned ${summary.scannedFiles} HTML files.`,
      summary.skippedFiles > 0 ? `Redirect stubs detected: ${summary.skippedFiles}.` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines = [
    `SEO validation failed.`,
    `Scanned ${summary.scannedFiles} HTML files.`,
    `Found ${summary.issueCount} issues across ${summary.grouped.length} rules.`,
  ];

  for (const group of summary.grouped) {
    lines.push('');
    lines.push(`${group.rule} (${group.count})`);
    for (const issue of group.sample) {
      lines.push(`- ${issue.file}: ${issue.message}`);
    }
  }

  return lines.join('\n');
}

export async function runSeoValidateCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);
  const distDir = String(
    parsed.flags.dist ?? parsed.flags['dist-dir'] ?? parsed.positionals[0] ?? 'dist',
  );
  const siteOrigin = await resolveSiteOrigin(
    typeof parsed.flags.site === 'string' ? parsed.flags.site : undefined,
  );
  const summary = await validateBuild({
    distDir,
    siteOrigin,
    fix: Boolean(parsed.flags.fix),
    sampleLimit:
      typeof parsed.flags.sample === 'string' ? Number(parsed.flags.sample) : DEFAULT_SAMPLE_LIMIT,
  });

  if (parsed.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatHumanSummary(summary));
  }

  return summary.ok ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await runSeoValidateCli();
  process.exit(exitCode);
}
