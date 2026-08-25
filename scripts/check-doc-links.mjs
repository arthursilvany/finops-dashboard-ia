#!/usr/bin/env node
/**
 * Verifies that every relative link in the repository's Markdown files points at
 * something that exists.
 *
 * Consolidating the documentation tree turned a large number of links into
 * mechanical rewrites, which is exactly the kind of change where a bad
 * find-and-replace hides. This check is the safety net for that.
 *
 * Usage: node scripts/check-doc-links.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// `--others --exclude-standard` includes new files that are not staged yet.
// Without them a freshly written document's links go unchecked locally, which is
// precisely when they are most likely to be wrong.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

// [text](target), excluding image embeds.
const LINK_RE = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;

const problems = [];

for (const file of files) {
  const abs = join(repoRoot, file);
  const body = readFileSync(abs, "utf8");

  for (const match of body.matchAll(LINK_RE)) {
    const raw = match[1].trim();

    // Skip absolute URLs, bare anchors, mailto, and template placeholders.
    if (/^(https?:|mailto:|#|<)/i.test(raw) || raw.startsWith("{") || raw === "") {
      continue;
    }

    // Drop any anchor fragment; only the file's existence is verified.
    const targetPath = raw.split("#")[0];
    if (!targetPath) continue;

    const resolved = targetPath.startsWith("/")
      ? resolve(repoRoot, `.${targetPath}`)
      : resolve(dirname(abs), targetPath);

    if (!existsSync(resolved)) {
      problems.push({ file, target: raw, expected: relative(repoRoot, resolved) });
    }
  }
}

if (problems.length === 0) {
  console.log(`OK: checked ${files.length} Markdown files, no broken relative links.`);
  process.exit(0);
}

console.error(`Found ${problems.length} broken relative link(s):\n`);
for (const p of problems) {
  console.error(`  ${p.file}`);
  console.error(`    -> ${p.target}   (resolves to ${p.expected})`);
}
process.exit(1);
