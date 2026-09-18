import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const exec = promisify(execFile);

/**
 * Never consumes DATABASE_URL or PG* connection settings. A private cluster and
 * Unix socket keep advisory locks (which are not schema-scoped) isolated too.
 * Requires initdb/pg_ctl on PATH and an unprivileged OS user.
 */
export async function isolatedPostgres() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clip-pg-"));
  const data = path.join(root, "data");
  const socket = path.join(root, "socket");
  let started = false;
  let admin;
  const close = async () => {
    await admin?.end();
    if (started) {
      await exec("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      started = false;
    }
    await rm(root, { recursive: true, force: true });
  };
  try {
    await mkdir(socket, { mode: 0o700 });
    await exec("initdb", ["-D", data, "-U", "clip_test", "--auth=trust", "--no-locale", "-E", "UTF8"]);
    await exec("pg_ctl", [
      "-D", data, "-l", path.join(root, "postgres.log"), "-w",
      "-o", `-F -k ${socket} -c listen_addresses='' -c max_connections=20`, "start",
    ]);
    started = true;
    const config = {
      host: socket, port: 5432, database: "postgres", user: "clip_test",
      password: "", ssl: false, connectionTimeoutMillis: 3000,
    };
    admin = new pg.Pool({ ...config, max: 1 });
    await admin.query("SELECT 1");
    return { config, admin, close };
  } catch (error) {
    await close();
    throw error;
  }
}