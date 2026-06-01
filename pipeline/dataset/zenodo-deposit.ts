#!/usr/bin/env bun
/**
 * sohamhamso — Zenodo deposit (V1 stub / scaffold)
 *
 * Per the V1 DX Spec (plan check-online-websites-aim-sparkling-pearl.md §
 * "V1 DX Spec → 1. Dataset schema"), each tagged release auto-deposits the
 * dataset bundle to Zenodo via API and receives a DOI.
 *
 * This is a V1 scaffold — wired against Zenodo's real REST API shape but with
 * the deposit/publish HTTP calls behind an --execute flag. Default behavior
 * is dry-run: builds the metadata payload, lists files that would upload,
 * writes a provenance JSON (`zenodo-deposit.json`) — does NOT publish.
 *
 * Run:
 *   bun pipeline/dataset/zenodo-deposit.ts --dir dataset/build/sohamhamso-dataset-v2026.05.31/
 *   bun pipeline/dataset/zenodo-deposit.ts --dir <dir> --sandbox       # use sandbox.zenodo.org
 *   bun pipeline/dataset/zenodo-deposit.ts --dir <dir> --execute       # actually publish
 *
 * Env:
 *   ZENODO_API_KEY    — required. Skip with warning if missing.
 *   GITHUB_REPO       — optional; default "sohamhamso/sohamhamso".
 *   GITHUB_RELEASE_URL — optional; threaded into related_identifiers.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

interface Args {
  dir: string;
  sandbox: boolean;
  execute: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };
  const dir = get("--dir");
  if (!dir) {
    console.error(
      "usage: bun pipeline/dataset/zenodo-deposit.ts --dir <bundle-dir> [--sandbox] [--execute]",
    );
    process.exit(2);
  }
  return {
    dir,
    sandbox: argv.includes("--sandbox"),
    execute: argv.includes("--execute"),
  };
}

// ---------------------------------------------------------------
// Metadata construction — Zenodo deposit JSON shape
// https://developers.zenodo.org/#representation
// ---------------------------------------------------------------

interface ZenodoMeta {
  title: string;
  upload_type: "dataset";
  description: string;
  creators: Array<{ name: string; affiliation?: string; orcid?: string }>;
  license: string; // "CC-BY-SA-4.0" matches Zenodo's id list
  access_right: "open";
  keywords: string[];
  related_identifiers: Array<{
    identifier: string;
    relation: string;
    resource_type?: string;
  }>;
  version: string;
  language: string;
  notes: string;
}

function extractVersion(dir: string): string {
  const m = basename(dir).match(/sohamhamso-dataset-(v\d{4}\.\d{2}\.\d{2})/);
  if (!m) {
    throw new Error(
      `Cannot infer version from --dir basename: expected sohamhamso-dataset-vYYYY.MM.DD/, got ${basename(dir)}`,
    );
  }
  return m[1];
}

function buildMetadata(dir: string, version: string): ZenodoMeta {
  const githubRepo = process.env.GITHUB_REPO ?? "sohamhamso/sohamhamso";
  const releaseUrl =
    process.env.GITHUB_RELEASE_URL ??
    `https://github.com/${githubRepo}/releases/tag/${version}`;

  return {
    title: `sohamhamso — Tantric / Kashmir Shaivism corpus (${version})`,
    upload_type: "dataset",
    description: [
      "<p>Original Sanskrit (Devanāgarī + IAST + SLP1), word-by-word glosses, ",
      "and translations across English plus ten Indic languages for the Tantric / ",
      "Kashmir Shaivism / Trika / Kaula scriptural corpus. Released as CSV + JSON + ",
      "TEI under CC-BY-SA 4.0.</p>",
      "<p>Schema, integrity verification, and per-source attribution included in the ",
      "bundle. See <code>README.md</code> for a five-line pandas load snippet and ",
      "<code>checksums.sha256</code> for integrity. Per-source upstream licenses ",
      "(GRETIL, Muktabodha, sanskritdocuments, SARIT, Wikisource) listed in ",
      "<code>ATTRIBUTION.md</code>.</p>",
    ].join(""),
    creators: [
      {
        name: "sohamhamso contributors",
        affiliation: "sohamhamso (https://sohamhamso.org)",
      },
    ],
    license: "CC-BY-SA-4.0",
    access_right: "open",
    keywords: [
      "Sanskrit",
      "Tantra",
      "Kashmir Shaivism",
      "Trika",
      "Kaula",
      "Indology",
      "Digital Humanities",
      "TEI",
      "machine-readable corpus",
    ],
    related_identifiers: [
      {
        identifier: releaseUrl,
        relation: "isSupplementTo",
        resource_type: "software",
      },
      {
        identifier: `https://github.com/${githubRepo}`,
        relation: "isDerivedFrom",
        resource_type: "software",
      },
    ],
    version,
    language: "san", // ISO 639-3 for Sanskrit; translations cover multiple Indic langs
    notes:
      "Translations marked ai_assisted=true are AI-generated and may not have human review. " +
      "See STATUS-CONTRACT.md in the source repo for the badge-rendering contract.",
  };
}

// ---------------------------------------------------------------
// File inventory
// ---------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

interface FileInfo {
  path: string;
  rel: string;
  bytes: number;
}

function inventory(dir: string): FileInfo[] {
  return walk(dir)
    .map((p) => ({ path: p, rel: relative(dir, p), bytes: statSync(p).size }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

// ---------------------------------------------------------------
// Zenodo HTTP (live only when --execute)
// ---------------------------------------------------------------

interface DepositResult {
  deposit_id: string | null;
  doi: string | null;
  doi_url: string | null;
  bucket_url: string | null;
  uploaded: string[];
  published: boolean;
  dry_run: boolean;
  api_base: string;
  notes: string[];
}

async function deposit(
  args: Args,
  meta: ZenodoMeta,
  files: FileInfo[],
  apiKey: string | null,
): Promise<DepositResult> {
  const apiBase = args.sandbox
    ? "https://sandbox.zenodo.org/api"
    : "https://zenodo.org/api";

  const result: DepositResult = {
    deposit_id: null,
    doi: null,
    doi_url: null,
    bucket_url: null,
    uploaded: [],
    published: false,
    dry_run: !args.execute,
    api_base: apiBase,
    notes: [],
  };

  if (!args.execute) {
    result.notes.push("dry-run: no HTTP calls made (pass --execute to publish)");
    return result;
  }

  if (!apiKey) {
    result.notes.push("ZENODO_API_KEY missing — cannot --execute");
    return result;
  }

  // 1. Create deposition.
  const createRes = await fetch(`${apiBase}/deposit/depositions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ metadata: meta }),
  });
  if (!createRes.ok) {
    throw new Error(`Zenodo create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as {
    id: number;
    links: { bucket?: string; self: string; publish: string };
    metadata: { prereserve_doi?: { doi?: string } };
  };
  result.deposit_id = String(created.id);
  result.bucket_url = created.links.bucket ?? null;
  result.doi = created.metadata?.prereserve_doi?.doi ?? null;
  if (result.doi) result.doi_url = `https://doi.org/${result.doi}`;

  // 2. Upload each file via bucket (new Zenodo files API).
  if (!result.bucket_url) {
    throw new Error("Zenodo did not return a bucket URL — cannot upload files");
  }
  for (const f of files) {
    const buf = readFileSync(f.path);
    const up = await fetch(`${result.bucket_url}/${encodeURIComponent(f.rel)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buf,
    });
    if (!up.ok) {
      throw new Error(
        `Zenodo upload failed for ${f.rel}: ${up.status} ${await up.text()}`,
      );
    }
    result.uploaded.push(f.rel);
  }

  // 3. Publish.
  const pub = await fetch(`${apiBase}/deposit/depositions/${created.id}/actions/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pub.ok) {
    throw new Error(`Zenodo publish failed: ${pub.status} ${await pub.text()}`);
  }
  const published = (await pub.json()) as { doi?: string; doi_url?: string };
  if (published.doi) {
    result.doi = published.doi;
    result.doi_url = published.doi_url ?? `https://doi.org/${published.doi}`;
  }
  result.published = true;
  return result;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  if (!existsSync(args.dir)) {
    console.error(`bundle dir not found: ${args.dir}`);
    process.exit(2);
  }

  const apiKey = process.env.ZENODO_API_KEY ?? null;
  if (!apiKey) {
    console.warn(
      "warn: ZENODO_API_KEY is not set — running dry-run only. " +
        "Set the env var and pass --execute to publish.",
    );
  }

  const version = extractVersion(args.dir);
  const meta = buildMetadata(args.dir, version);
  const files = inventory(args.dir);

  const result = await deposit(args, meta, files, apiKey);

  const provenance = {
    tool: "pipeline/dataset/zenodo-deposit.ts",
    generated_at: new Date().toISOString(),
    version,
    bundle_dir: args.dir,
    sandbox: args.sandbox,
    execute: args.execute,
    metadata: meta,
    files: files.map((f) => ({ path: f.rel, bytes: f.bytes })),
    result,
  };

  const outPath = join(args.dir, "zenodo-deposit.json");
  writeFileSync(outPath, JSON.stringify(provenance, null, 2) + "\n", "utf8");

  console.log("zenodo-deposit complete:");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nprovenance: ${outPath}`);
  if (result.doi_url) console.log(`DOI: ${result.doi_url}`);
}

main().catch((err) => {
  console.error("zenodo-deposit failed:", err);
  process.exit(1);
});
