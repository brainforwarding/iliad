#!/usr/bin/env node
// Weekly usage report: site visits (Cloudflare Web Analytics), downloads and
// update checks (GitHub releases), and built-in AI use (the Iliad AI proxy's
// aggregate stats). Nothing here sees documents or identifies anyone.
//
// Usage: npm run metrics [-- --days 7]
// Reads optional settings from .env.local:
//   ILIAD_PROXY_ADMIN_TOKEN           proxy admin stats (already used by relay/ai-proxy)
//   ILIAD_PROXY_URL                   default https://iliad-ai.quiet-bush-25b1.workers.dev
//   CLOUDFLARE_ANALYTICS_API_TOKEN    API token with Account › Account Analytics › Read
//   CLOUDFLARE_ACCOUNT_ID             default: the account in relay/ai-proxy/wrangler.toml
//   CLOUDFLARE_WEB_ANALYTICS_SITE_TAG optional, only needed if the account has several sites
// GitHub download counts are cumulative, so each run saves a snapshot in
// .metrics/ and reports the change since the snapshot closest to --days ago.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotDir = path.join(root, ".metrics");
const snapshotPath = path.join(snapshotDir, "github-snapshots.json");
const repo = "brainforwarding/iliad";

const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? Math.max(1, Number(process.argv[daysArg + 1]) || 7) : 7;

function readEnvLocal() {
  const file = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = { ...readEnvLocal(), ...process.env };

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function dayRange(count) {
  const out = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(isoDay(new Date(today.getTime() - i * 86_400_000)));
  }
  return out;
}

function pad(value, width) {
  return String(value).padStart(width);
}

// --- GitHub releases -------------------------------------------------------

async function githubReleases() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "iliad-metrics" };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const releases = await response.json();
  return releases.map((release) => ({
    tag: release.tag_name,
    published: release.published_at?.slice(0, 10) ?? "",
    dmg: release.assets.filter((a) => a.name.endsWith(".dmg")).reduce((sum, a) => sum + a.download_count, 0),
    updateChecks: release.assets.filter((a) => a.name.endsWith(".yml")).reduce((sum, a) => sum + a.download_count, 0)
  }));
}

function loadSnapshots() {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch {
    return [];
  }
}

function saveSnapshot(releases) {
  const snapshots = loadSnapshots();
  const totals = { at: new Date().toISOString(), dmg: 0, updateChecks: 0 };
  for (const release of releases) {
    totals.dmg += release.dmg;
    totals.updateChecks += release.updateChecks;
  }
  snapshots.push(totals);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshots.slice(-400), null, 2)}\n`);
  return { totals, snapshots };
}

function baselineFor(snapshots, targetMs) {
  let best = null;
  for (const snapshot of snapshots.slice(0, -1)) {
    const distance = Math.abs(Date.parse(snapshot.at) - targetMs);
    if (!best || distance < best.distance) best = { snapshot, distance };
  }
  return best?.snapshot ?? null;
}

async function githubSection() {
  const releases = await githubReleases();
  const { totals, snapshots } = saveSnapshot(releases);
  const baseline = baselineFor(snapshots, Date.now() - days * 86_400_000);
  const lines = ["DOWNLOADS AND UPDATES (GitHub releases)"];
  lines.push(`  All time: ${totals.dmg} DMG downloads, ${totals.updateChecks} update checks`);
  if (baseline) {
    const since = baseline.at.slice(0, 10);
    lines.push(`  Since ${since}: +${totals.dmg - baseline.dmg} DMG downloads, +${totals.updateChecks - baseline.updateChecks} update checks`);
  } else {
    lines.push("  First run: weekly change appears from the next run on (snapshot saved in .metrics/).");
  }
  lines.push("  Latest releases (DMG / update checks):");
  for (const release of releases.slice(0, 5)) {
    lines.push(`    ${release.tag.padEnd(8)} ${release.published}  ${pad(release.dmg, 4)} / ${pad(release.updateChecks, 4)}`);
  }
  return lines;
}

// --- Iliad AI proxy --------------------------------------------------------

async function proxySection() {
  const token = env.ILIAD_PROXY_ADMIN_TOKEN;
  if (!token) return ["BUILT-IN AI (proxy)", "  Skipped: ILIAD_PROXY_ADMIN_TOKEN is not in .env.local."];
  const base = env.ILIAD_PROXY_URL || "https://iliad-ai.quiet-bush-25b1.workers.dev";
  const lines = ["BUILT-IN AI (proxy, free tier only; own-key users don't show here)"];
  lines.push("  Day         requests  active installs  new installs  networks   cost USD");
  let requests = 0;
  let newInstalls = 0;
  let spent = 0;
  let peak = 0;
  for (const day of dayRange(days)) {
    const response = await fetch(`${base}/v1/admin/stats?day=${day}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      // The proxy answers 400 for days it keeps no quota record for (for
      // example before it went live), which reads as "no data", not a failure.
      lines.push(`  ${day}  ${response.status === 400 ? "no data" : `error ${response.status}`}`);
      continue;
    }
    const stats = (await response.json()).stats ?? {};
    const cost = (stats.spentNano ?? 0) / 1e9;
    requests += stats.requests ?? 0;
    newInstalls += stats.installsIssued ?? 0;
    spent += cost;
    peak = Math.max(peak, stats.distinctSubjects ?? 0);
    lines.push(`  ${day}  ${pad(stats.requests ?? 0, 8)}  ${pad(stats.distinctSubjects ?? 0, 15)}  ${pad(stats.installsIssued ?? 0, 12)}  ${pad(stats.distinctNetworks ?? 0, 8)}  ${pad(cost.toFixed(4), 9)}`);
  }
  lines.push(`  ${days}-day total: ${requests} requests, ${newInstalls} new installs, peak ${peak} active installs in a day, $${spent.toFixed(4)}`);
  return lines;
}

// --- Cloudflare Web Analytics ----------------------------------------------

function defaultAccountId() {
  try {
    const toml = fs.readFileSync(path.join(root, "relay/ai-proxy/wrangler.toml"), "utf8");
    return /account_id\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? "";
  } catch {
    return "";
  }
}

async function siteSection() {
  const token = env.CLOUDFLARE_ANALYTICS_API_TOKEN;
  if (!token) return ["WEBSITE (Cloudflare Web Analytics)", "  Skipped: CLOUDFLARE_ANALYTICS_API_TOKEN is not in .env.local."];
  const accountTag = env.CLOUDFLARE_ACCOUNT_ID || defaultAccountId();
  const start = new Date(Date.now() - days * 86_400_000).toISOString();
  const end = new Date().toISOString();
  const conditions = [{ datetime_geq: start }, { datetime_leq: end }, { bot: 0 }];
  if (env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG) conditions.push({ siteTag: env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG });
  const group = (alias, dimension) =>
    `${alias}: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 8, orderBy: [sum_visits_DESC]) { count sum { visits } dimensions { metric: ${dimension} } }`;
  const query = `query ($accountTag: string, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) { count sum { visits } }
      ${group("referers", "refererHost")}
      ${group("paths", "requestPath")}
      ${group("countries", "countryName")}
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag, filter: { AND: conditions } } })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    return ["WEBSITE (Cloudflare Web Analytics)", `  Error: ${body.errors?.map((e) => e.message).join("; ") || response.status}`];
  }
  const account = body.data?.viewer?.accounts?.[0] ?? {};
  const total = account.total?.[0];
  const lines = ["WEBSITE (Cloudflare Web Analytics, bots excluded)"];
  lines.push(`  Last ${days} days: ${total?.sum?.visits ?? 0} visits, ${total?.count ?? 0} page views`);
  for (const [label, rows] of [["Top sources", account.referers], ["Top pages", account.paths], ["Top countries", account.countries]]) {
    lines.push(`  ${label}:`);
    if (!rows?.length) lines.push("    (none)");
    for (const row of rows ?? []) lines.push(`    ${pad(row.sum.visits, 5)}  ${row.dimensions.metric || "(direct)"}`);
  }
  return lines;
}

// --- Report ----------------------------------------------------------------

const sections = await Promise.all(
  [siteSection, githubSection, proxySection].map((section) =>
    section().catch((error) => [`${section.name}: failed (${error.message})`])
  )
);
console.log(`Iliad metrics · last ${days} days · ${isoDay(new Date())}\n`);
console.log(sections.map((lines) => lines.join("\n")).join("\n\n"));
