import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dbRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = path.join(dbRoot, "drizzle");
const journalPath = path.join(drizzleDir, "meta", "_journal.json");
const journal = JSON.parse(await readFile(journalPath, "utf8"));
const sqlFiles = (await readdir(drizzleDir))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (!Array.isArray(journal.entries)) {
  throw new Error("Invalid Drizzle migration journal: entries must be an array.");
}

const expectedFiles = journal.entries.map((entry, position) => {
  if (entry.idx !== position) {
    throw new Error(`Invalid Drizzle migration journal: entry ${position} has idx ${entry.idx}.`);
  }
  if (typeof entry.tag !== "string" || !/^\d{4}_.+/.test(entry.tag)) {
    throw new Error(`Invalid Drizzle migration journal tag at entry ${position}.`);
  }
  return `${entry.tag}.sql`;
});

const duplicates = expectedFiles.filter((name, index) => expectedFiles.indexOf(name) !== index);
if (duplicates.length > 0) {
  throw new Error(`Duplicate Drizzle migration journal entries: ${[...new Set(duplicates)].join(", ")}`);
}

const missing = expectedFiles.filter((name) => !sqlFiles.includes(name));
const unjournaled = sqlFiles.filter((name) => !expectedFiles.includes(name));
if (missing.length > 0 || unjournaled.length > 0) {
  throw new Error([
    missing.length > 0 ? `missing SQL: ${missing.join(", ")}` : "",
    unjournaled.length > 0 ? `unjournaled SQL: ${unjournaled.join(", ")}` : "",
  ].filter(Boolean).join("; "));
}

console.log(`Validated ${expectedFiles.length} immutable Drizzle migration history entries.`);