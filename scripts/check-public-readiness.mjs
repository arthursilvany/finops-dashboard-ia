import { execFileSync } from "node:child_process";
import { extname, normalize, sep } from "node:path";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const forbiddenExtensions = new Set([
  ".7z",
  ".cer",
  ".crt",
  ".csv",
  ".doc",
  ".docx",
  ".gz",
  ".jsonl",
  ".key",
  ".parquet",
  ".p12",
  ".pem",
  ".pfx",
  ".ppt",
  ".pptx",
  ".tar",
  ".xls",
  ".xlsx",
  ".zip",
]);

const forbiddenText = [
  {
    name: "retired live Azure resource identifier",
    value: ["ars", "ilvan-4196-resource"].join(""),
  },
  {
    name: "retired staging registry identifier",
    value: ["acrfinopsdashboard", "staging"].join(""),
  },
  {
    name: "internal organization terminology",
    value: ["MC", "APS"].join(""),
  },
  {
    name: "private-repository publication note",
    value: ["repository is ", "private"].join(""),
  },
  {
    name: "private-repository publication note",
    value: ["private repo", "sitory"].join(""),
  },
  {
    name: "employee email address",
    value: ["@micro", "soft.com"].join(""),
  },
];

const allowedCustomerFiles = new Set([
  "input/customer/.gitkeep",
  "input/customer/README.md",
]);

const findings = [];

for (const gitPath of tracked) {
  const path = gitPath.replaceAll("\\", "/");
  const extension = extname(path).toLowerCase();

  if (forbiddenExtensions.has(extension)) {
    findings.push(`${path}: tracked artifact type ${extension}`);
    continue;
  }

  if (path.startsWith("input/customer/") && !allowedCustomerFiles.has(path)) {
    findings.push(`${path}: customer data must not be tracked`);
    continue;
  }

  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (
    filename.startsWith(".env") &&
    !filename.endsWith(".example") &&
    !filename.endsWith(".example.local")
  ) {
    findings.push(`${path}: environment file must not be tracked`);
    continue;
  }

  const nativePath = normalize(path.split("/").join(sep));
  let content;
  try {
    content = readFileSync(nativePath, "utf8");
  } catch {
    continue;
  }

  for (const pattern of forbiddenText) {
    if (content.toLowerCase().includes(pattern.value.toLowerCase())) {
      findings.push(`${path}: ${pattern.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Public-readiness check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`OK: ${tracked.length} tracked files passed public-readiness checks.`);
