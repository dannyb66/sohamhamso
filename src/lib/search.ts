/**
 * src/lib/search.ts
 *
 * Search helpers for sohamhamso reader.
 *
 * Exports three entrypoints used by Astro routes / API handlers:
 *   - lexicalSearch(query, lang, limit) — FTS5 if available, LIKE fallback
 *   - semanticSearch(query, lang)     — OpenAI embed + cosine scan
 *   - blendedSearch(query, lang)      — parallel lex+sem, RRF fusion (default)
 *
 * Production architecture (per plan check-online-websites-aim-sparkling-pearl.md):
 *   - 3 Turso DBs (corpus / vectors / pii)
 *   - vectors DB uses libSQL F32_BLOB(3072) + `vector_top_k()` index → <50ms p95
 *   - query-embedding cache: Cloudflare KV, 1k entries, 7-day TTL,
 *     key = `embed:${sha256(query)}`
 *
 * Local dev approximation:
 *   - one SQLite file with all tables
 *   - cosine similarity = full scan (fine to ~100k rows; <50ms with PRAGMA tuning)
 *   - query-embedding cache = in-memory LRU (lru-cache npm package)
 *
 * Graceful degradation: if OPENAI_API_KEY is missing, semantic + blended fall
 * back to lexical-only with `source: 'lexical'` so the UI never explodes.
 */

// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import type { Database } from 'bun:sqlite';
import { LRUCache } from 'lru-cache';
import OpenAI from 'openai';
import { getDb } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VerseHit {
  verse_id: number;
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  score: number;
  source: 'lexical' | 'semantic' | 'blended';
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMS = 3072;
const RRF_K = 60; // standard reciprocal-rank-fusion constant

// ─────────────────────────────────────────────────────────────────────────────
// Transliteration synonyms
//
// Tiny normalization layer so a user typing "krsna" or "krishna" or "कृष्ण"
// reaches the same verses. We expand the query into all forms and OR them
// together at the LIKE/FTS layer. (Full Sanscript transliteration is overkill
// for the lexical path — a hand-curated map covers the 90% case.)
// ─────────────────────────────────────────────────────────────────────────────

const SYNONYMS: Record<string, string[]> = {
  // Devanagari ↔ IAST ↔ ASCII
  krsna: ['kṛṣṇa', 'krishna', 'कृष्ण'],
  kṛṣṇa: ['krsna', 'krishna', 'कृष्ण'],
  krishna: ['krsna', 'kṛṣṇa', 'कृष्ण'],
  shiva: ['śiva', 'siva', 'शिव'],
  śiva: ['shiva', 'siva', 'शिव'],
  siva: ['shiva', 'śiva', 'शिव'],
  shakti: ['śakti', 'sakti', 'शक्ति'],
  śakti: ['shakti', 'sakti', 'शक्ति'],
  spanda: ['स्पन्द'],
  pratyabhijna: ['pratyabhijñā', 'प्रत्यभिज्ञा'],
  pratyabhijñā: ['pratyabhijna', 'प्रत्यभिज्ञा'],
  // common diacritic-stripping
  ā: ['a'],
  ī: ['i'],
  ū: ['u'],
  ṛ: ['r', 'ri'],
};

function expandSynonyms(query: string): string[] {
  const lower = query.trim().toLowerCase();
  const out = new Set<string>([lower]);
  const direct = SYNONYMS[lower];
  if (direct) for (const v of direct) out.add(v.toLowerCase());
  // token-level expansion: split + look up each token
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    for (const tok of tokens) {
      const variants = SYNONYMS[tok];
      if (variants) for (const v of variants) out.add(v.toLowerCase());
    }
  }
  return [...out];
}

// ─────────────────────────────────────────────────────────────────────────────
// Query-embedding LRU cache
//
// Production: Cloudflare KV, 1000 entries, 7-day TTL.
// Local dev: in-memory LRU mirrors same size/ttl so behaviour is identical.
// ─────────────────────────────────────────────────────────────────────────────

const queryEmbedCache = new LRUCache<string, Float32Array>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7, // 7 days
});

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

async function embedQuery(query: string): Promise<Float32Array | null> {
  const norm = query.trim().toLowerCase();
  const cached = queryEmbedCache.get(norm);
  if (cached) return cached;

  const client = getOpenAI();
  if (!client) return null;

  const resp = await client.embeddings.create({
    model: EMBED_MODEL,
    input: norm,
  });
  const arr = resp.data[0]?.embedding;
  if (!arr || arr.length !== EMBED_DIMS) return null;

  const f32 = new Float32Array(arr);
  queryEmbedCache.set(norm, f32);
  return f32;
}

// ─────────────────────────────────────────────────────────────────────────────
// FTS5 availability check (cached)
//
// `bun:sqlite` ships with FTS5 in recent Bun versions but it's build-dependent.
// We probe once at module load and fall back to LIKE if missing.
// We also require an FTS table named `verses_fts` to exist (created by an
// optional migration); absent that table, LIKE fallback is used.
// ─────────────────────────────────────────────────────────────────────────────

let _ftsAvailable: boolean | null = null;
function ftsAvailable(db: Database): boolean {
  if (_ftsAvailable !== null) return _ftsAvailable;
  try {
    const row = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='verses_fts' LIMIT 1",
      )
      .get();
    _ftsAvailable = !!row;
  } catch {
    _ftsAvailable = false;
  }
  return _ftsAvailable;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lexical search
// ─────────────────────────────────────────────────────────────────────────────

interface LexicalRow {
  verse_id: number;
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  score: number;
}

export async function lexicalSearch(query: string, lang = 'en', limit = 10): Promise<VerseHit[]> {
  if (!query.trim()) return [];
  const db = getDb();
  const variants = expandSynonyms(query);
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));

  let rows: LexicalRow[];

  if (ftsAvailable(db)) {
    // FTS5 path — assumes `verses_fts(verse_id UNINDEXED, iast, devanagari, translation_text)`
    // exists with content from verses + translations. Score = bm25.
    const ftsQuery = variants.map((v) => `"${v.replace(/"/g, '""')}"`).join(' OR ');
    rows = db
      .query<LexicalRow, [string, string, number]>(
        `
        SELECT
          v.id        AS verse_id,
          t.id        AS text_id,
          t.slug      AS text_slug,
          t.title_en  AS text_title,
          t.tradition AS tradition,
          v.chapter   AS chapter,
          v.verse_num AS verse_num,
          v.devanagari,
          v.iast,
          (SELECT substr(tr.translation_text, 1, 140) FROM translations tr
           WHERE tr.verse_id = v.id AND tr.lang = ? LIMIT 1) AS translation_excerpt,
          bm25(verses_fts) AS score
        FROM verses_fts
        JOIN verses v ON v.id = verses_fts.verse_id
        JOIN texts  t ON t.id = v.text_id
        WHERE verses_fts MATCH ?
        ORDER BY score ASC
        LIMIT ?
`,
      )
      .all(lang, ftsQuery, safeLimit);
  } else {
    // LIKE fallback — slower, but works on any SQLite build.
    const ors = variants
      .map(() => '(v.iast LIKE ? OR v.devanagari LIKE ? OR tr.translation_text LIKE ?)')
      .join(' OR ');
    const params: (string | number)[] = [lang];
    for (const v of variants) {
      const wild = `%${v}%`;
      params.push(wild, wild, wild);
    }
    params.push(safeLimit);

    rows = db
      .query<LexicalRow, (string | number)[]>(
        `
        SELECT
          v.id        AS verse_id,
          t.id        AS text_id,
          t.slug      AS text_slug,
          t.title_en  AS text_title,
          t.tradition AS tradition,
          v.chapter   AS chapter,
          v.verse_num AS verse_num,
          v.devanagari,
          v.iast,
          substr(tr.translation_text, 1, 140) AS translation_excerpt,
          1.0 AS score
        FROM verses v
        JOIN texts t ON t.id = v.text_id
        LEFT JOIN translations tr
          ON tr.verse_id = v.id AND tr.lang = ?
        WHERE ${ors}
        LIMIT ?
`,
      )
      .all(...params);
  }

  return rows.map((r) => ({ ...r, source: 'lexical' as const }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic search
// ─────────────────────────────────────────────────────────────────────────────

interface EmbedRow {
  verse_id: number;
  embedding: Buffer;
}

interface VerseMetaRow {
  verse_id: number;
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
}

function bufferToFloat32(buf: Buffer): Float32Array {
  // BLOB is little-endian Float32 (matches libSQL F32_BLOB layout).
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosine(a: Float32Array, b: Float32Array): number {
  // Embeddings from text-embedding-3-* are L2-normalised by the API,
  // so cosine == dot product. We still divide to be defensive in case
  // someone embedded with `dimensions=` truncation (which renormalises
  // differently on the client side).
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function semanticSearch(query: string, lang = 'en', limit = 10): Promise<VerseHit[]> {
  if (!query.trim()) return [];
  const qvec = await embedQuery(query);
  if (!qvec) {
    // No API key (or embed failed) — caller should fall back to lexical.
    return [];
  }

  const db = getDb();

  // V1: full scan. Acceptable to ~100k rows under PRAGMA defaults.
  // Production (libSQL): swap for `SELECT verse_id FROM vector_top_k(...)`.
  const embedRows = db
    .query<EmbedRow, [string, string]>(
      `
      SELECT verse_id, embedding
      FROM verse_embeddings
      WHERE lang = ? AND model = ?
      `,
    )
    .all(lang, EMBED_MODEL);

  if (embedRows.length === 0) return [];

  // Score everything; keep top-`limit`.
  const scored: { verse_id: number; score: number }[] = new Array(embedRows.length);
  for (let i = 0; i < embedRows.length; i++) {
    const row = embedRows[i];
    const vec = bufferToFloat32(row.embedding);
    scored[i] = { verse_id: row.verse_id, score: cosine(qvec, vec) };
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  if (top.length === 0) return [];

  // Hydrate verse metadata + translation in one query.
  const ids = top.map((t) => t.verse_id);
  const placeholders = ids.map(() => '?').join(',');
  const meta = db
    .query<VerseMetaRow, (string | number)[]>(
      `
      SELECT
        v.id        AS verse_id,
        t.id        AS text_id,
        t.slug      AS text_slug,
        t.title_en  AS text_title,
        t.tradition AS tradition,
        v.chapter   AS chapter,
        v.verse_num AS verse_num,
        v.devanagari,
        v.iast,
        (SELECT substr(tr.translation_text, 1, 140) FROM translations tr
         WHERE tr.verse_id = v.id AND tr.lang = ? LIMIT 1) AS translation_excerpt
      FROM verses v
      JOIN texts t ON t.id = v.text_id
      WHERE v.id IN (${placeholders})
      `,
    )
    .all(lang, ...ids);

  const metaById = new Map<number, VerseMetaRow>();
  for (const m of meta) metaById.set(m.verse_id, m);

  const out: VerseHit[] = [];
  for (const { verse_id, score } of top) {
    const m = metaById.get(verse_id);
    if (!m) continue;
    out.push({ ...m, score, source: 'semantic' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blended search — Reciprocal Rank Fusion
//
// RRF score = Σ 1 / (k + rank_i)   where k = 60 (standard, Cormack 2009)
// Run lexical + semantic in parallel, combine, sort, return top-N.
// ─────────────────────────────────────────────────────────────────────────────

export async function blendedSearch(query: string, lang = 'en', limit = 10): Promise<VerseHit[]> {
  if (!query.trim()) return [];

  // Pull more from each leg than we plan to return so the fusion has
  // room to promote/demote on the overlap.
  const fetchPer = Math.max(limit * 2, 20);

  const [lex, sem] = await Promise.all([
    lexicalSearch(query, lang, fetchPer).catch((e) => {
      console.error('[search] lexical failed:', e);
      return [] as VerseHit[];
    }),
    semanticSearch(query, lang, fetchPer).catch((e) => {
      console.error('[search] semantic failed:', e);
      return [] as VerseHit[];
    }),
  ]);

  // No semantic results (no API key, no embeddings yet, etc.) → lexical-only.
  if (sem.length === 0) return lex.slice(0, limit);
  if (lex.length === 0) return sem.slice(0, limit);

  // RRF: build map verse_id → { hit, score }
  const fused = new Map<number, { hit: VerseHit; score: number }>();

  const addRanked = (hits: VerseHit[]) => {
    for (let rank = 0; rank < hits.length; rank++) {
      const hit = hits[rank];
      const contrib = 1 / (RRF_K + rank + 1); // rank is 1-indexed in RRF
      const existing = fused.get(hit.verse_id);
      if (existing) {
        existing.score += contrib;
      } else {
        // Clone so we can rewrite `source` + `score` without mutating callers.
        fused.set(hit.verse_id, {
          hit: { ...hit },
          score: contrib,
        });
      }
    }
  };

  addRanked(lex);
  addRanked(sem);

  const out: VerseHit[] = [];
  for (const { hit, score } of fused.values()) {
    out.push({ ...hit, score, source: 'blended' });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-only exports (vitest reaches into these for unit coverage)
// ─────────────────────────────────────────────────────────────────────────────

export const __test__ = {
  cosine,
  expandSynonyms,
  bufferToFloat32,
  RRF_K,
  EMBED_MODEL,
  EMBED_DIMS,
};
