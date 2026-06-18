#!/usr/bin/env bun
/**
 * cf-pages-deploy-wait — poll Cloudflare Pages deployment status until success or failure.
 *
 * Uses `wrangler pages deployment list --project-name <project> --json` in a loop.
 * Inspects the latest (first) deployment in the returned array.
 *
 * Success:  deployment.status == "success"
 *           AND (no --commit arg OR deployment.deployment_trigger.metadata.commit_hash
 *               starts with the provided --commit value)
 * Failure:  deployment.status == "failure"
 * Pending:  any other status → sleep 10s and retry
 *
 * Times out after --timeout seconds (default 600).
 * Exits 0 on success, 1 on failure or timeout.
 */

import { execSync } from 'node:child_process';

interface ParsedArgs {
  commit: string | null;
  project: string;
  timeout: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  let project = 'sohamhamso';
  let commit: string | null = null;
  let timeout = 600;

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length) || project;
    } else if (arg.startsWith('--commit=')) {
      commit = arg.slice('--commit='.length) || null;
    } else if (arg.startsWith('--timeout=')) {
      const v = Number.parseInt(arg.slice('--timeout='.length), 10);
      if (Number.isInteger(v) && v > 0) timeout = v;
    }
  }

  return { project, commit, timeout };
}

interface WranglerDeployment {
  aliases?: string[];
  created_on?: string;
  deployment_trigger?: {
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
    type?: string;
  };
  id?: string;
  latest_stage?: {
    name?: string;
    status?: string;
  };
  modified_on?: string;
  project_name?: string;
  short_id?: string;
  /** "success" | "failure" | "canceled" | "idle" | "active" | "building" | "queued" */
  status?: string;
  url?: string;
}

function getLatestDeployment(project: string): WranglerDeployment | null {
  let stdout: string;
  try {
    stdout = execSync(`wrangler pages deployment list --project-name ${project} --json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // wrangler exits non-zero if auth fails; still capture stdout
    stdout = (err as { stdout?: string }).stdout ?? '';
  }

  // wrangler may emit warnings/logs mixed with JSON; extract the JSON array portion
  const jsonMatch = stdout.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;

  let deployments: WranglerDeployment[];
  try {
    deployments = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  return deployments[0] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`CF Pages deploy wait`);
  console.log(`- Project: ${args.project}`);
  if (args.commit) console.log(`- Commit:  ${args.commit}`);
  console.log(`- Timeout: ${args.timeout}s`);
  console.log('');

  const deadline = Date.now() + args.timeout * 1000;
  const POLL_INTERVAL_MS = 10_000;

  while (Date.now() < deadline) {
    const deployment = getLatestDeployment(args.project);

    if (!deployment) {
      console.log(`[${new Date().toISOString()}] No deployments found, retrying…`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const status = deployment.status ?? 'unknown';
    const commitHash = deployment.deployment_trigger?.metadata?.commit_hash ?? null;
    const deployUrl = deployment.url ?? deployment.aliases?.[0] ?? '(no URL)';
    const shortId = deployment.short_id ?? deployment.id ?? '?';

    console.log(
      `[${new Date().toISOString()}] id=${shortId} status=${status} commit=${commitHash ?? '?'}`,
    );

    if (status === 'failure') {
      console.error(`\nDeployment FAILED: ${deployUrl}`);
      process.exit(1);
    }

    if (status === 'success') {
      // If a commit SHA was specified, verify it matches
      if (args.commit) {
        if (!commitHash || !commitHash.startsWith(args.commit)) {
          console.log(
            `Deployment succeeded but commit mismatch: expected starts-with "${args.commit}", got "${commitHash ?? 'null'}". Retrying…`,
          );
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
      }

      console.log(`\nDeployment SUCCESS`);
      console.log(`- URL:    ${deployUrl}`);
      console.log(`- Commit: ${commitHash ?? '?'}`);
      if (deployment.deployment_trigger?.metadata?.commit_message) {
        console.log(`- Msg:    ${deployment.deployment_trigger.metadata.commit_message}`);
      }
      process.exit(0);
    }

    // Pending states: "idle", "active", "building", "queued", "canceled", unknown
    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`\nTimeout after ${args.timeout}s waiting for deployment to complete.`);
  process.exit(1);
}

await main();
