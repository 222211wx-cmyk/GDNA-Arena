import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Keep external package resolution inside this workspace; remove bundle on exit.
const directory = await mkdtemp(join(root, ".clip-reconcile-"));
try {
  const outfile = join(directory, "cli.mjs");
  await build({
    entryPoints: [join(root, "src/cli/clip-storage-reconcile.ts")],
    outfile, bundle: true, platform: "node", format: "esm", packages: "external",
  });
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const child = spawn(process.execPath, [outfile, ...args], { stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}