import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to push the clips schema.");
}

const client = new Client({ connectionString: databaseUrl });

async function relationCounts() {
  const result = await client.query(`
    SELECT
      count(*) FILTER (WHERE relkind IN ('r', 'p'))::integer AS table_count,
      count(*) FILTER (WHERE relkind = 'S')::integer AS sequence_count
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
  `);
  return result.rows[0];
}

async function tableExists(name) {
  const result = await client.query(
    `SELECT to_regclass(format('public.%I', $1::text)) IS NOT NULL AS exists`,
    [name],
  );
  return result.rows[0].exists;
}

async function columnsFor(table) {
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  return new Map(result.rows.map((row) => [row.column_name, row]));
}

async function definitionFor(kind, name) {
  if (kind === "constraint") {
    const result = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.clips'::regclass AND conname = $1
    `, [name]);
    return result.rows[0]?.definition;
  }
  const result = await client.query(`
    SELECT indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'clip_original_registrations'
      AND indexname = $1
  `, [name]);
  return result.rows[0]?.definition;
}

function assertColumn(columns, table, name, { type, nullable }) {
  const column = columns.get(name);
  if (!column) throw new Error(`Unexpected ${table} structure: required column ${name} is missing.`);
  if (column.data_type !== type || column.is_nullable !== nullable) {
    throw new Error(
      `Unexpected ${table}.${name} structure: expected ${type} nullable=${nullable}, got ${column.data_type} nullable=${column.is_nullable}.`,
    );
  }
  return column;
}

function assertAdditiveBoolean(columns, table, name) {
  const column = columns.get(name);
  if (!column) return false;
  assertColumn(columns, table, name, { type: "boolean", nullable: "NO" });
  if (!column.column_default || !/true/i.test(column.column_default)) {
    throw new Error(`Unexpected ${table}.${name} default: expected true.`);
  }
  return true;
}

function assertAdditiveJsonb(columns, table, name) {
  if (!columns.has(name)) return false;
  assertColumn(columns, table, name, { type: "jsonb", nullable: "YES" });
  return true;
}

await client.connect();
let committed = false;
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('gdna_clips_additive_push'))");
  const before = await relationCounts();
  const clipsExisted = await tableExists("clips");
  const registrationsExisted = await tableExists("clip_original_registrations");
  if (!clipsExisted) {
    throw new Error("Refusing push: clips table is missing; this repair never replaces it.");
  }

  const clipsColumns = await columnsFor("clips");
  for (const [name, type, nullable] of [
    ["id", "integer", "NO"],
    ["user_id", "integer", "NO"],
    ["object_name", "text", "NO"],
    ["is_frozen", "boolean", "NO"],
    ["created_at", "timestamp with time zone", "NO"],
  ]) {
    assertColumn(clipsColumns, "clips", name, { type, nullable });
  }
  const clipsForeignKey = await definitionFor("constraint", "clips_user_id_fkey");
  if (
    !clipsForeignKey
    || !/FOREIGN KEY \(user_id\) REFERENCES users\(id\)/.test(clipsForeignKey)
  ) {
    throw new Error("Unexpected clips structure: clips_user_id_fkey is missing or changed.");
  }
  const footageAlreadyPresent = assertAdditiveBoolean(
    clipsColumns,
    "clips",
    "is_original_footage",
  );

  let audioAlreadyPresent = false;
  if (registrationsExisted) {
    const registrationColumns = await columnsFor("clip_original_registrations");
    for (const [name, type, nullable] of [
      ["id", "integer", "NO"],
      ["clip_id", "integer", "NO"],
      ["user_id", "integer", "NO"],
      ["original_reference", "text", "NO"],
      ["rights_holder_name", "text", "NO"],
      ["rights_holder_role", "text", "NO"],
      ["duration_seconds", "numeric", "NO"],
      ["visual_signature", "jsonb", "YES"],
      ["created_at", "timestamp with time zone", "NO"],
    ]) {
      assertColumn(registrationColumns, "clip_original_registrations", name, { type, nullable });
    }
    audioAlreadyPresent = assertAdditiveJsonb(
      registrationColumns,
      "clip_original_registrations",
      "audio_signature",
    );
    const clipUnique = await definitionFor(
      "index",
      "clip_original_registrations_clip_id_uniq",
    );
    if (!clipUnique || !/CREATE UNIQUE INDEX .+ USING btree \(clip_id\)/i.test(clipUnique)) {
      throw new Error(
        "Unexpected clip_original_registrations structure: clip_id unique index is missing or changed.",
      );
    }
  }

  if (!footageAlreadyPresent) {
    await client.query(
      `ALTER TABLE "clips" ADD COLUMN "is_original_footage" boolean DEFAULT true NOT NULL`,
    );
  }
  if (!registrationsExisted) {
    await client.query(`
      CREATE TABLE "clip_original_registrations" (
        "id" serial PRIMARY KEY NOT NULL,
        "clip_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "original_reference" text NOT NULL,
        "rights_holder_name" text NOT NULL,
        "rights_holder_role" text NOT NULL,
        "duration_seconds" numeric(12, 3) NOT NULL,
        "visual_signature" jsonb,
        "audio_signature" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX "clip_original_registrations_clip_id_uniq"
      ON "clip_original_registrations" USING btree ("clip_id")
    `);
  } else if (!audioAlreadyPresent) {
    await client.query(
      `ALTER TABLE "clip_original_registrations" ADD COLUMN "audio_signature" jsonb`,
    );
  }

  const verifiedClips = await columnsFor("clips");
  if (!assertAdditiveBoolean(verifiedClips, "clips", "is_original_footage")) {
    throw new Error("Post-push verification failed for clips.is_original_footage.");
  }
  const verifiedRegistrations = await columnsFor("clip_original_registrations");
  if (!assertAdditiveJsonb(verifiedRegistrations, "clip_original_registrations", "audio_signature")) {
    throw new Error("Post-push verification failed for clip_original_registrations.audio_signature.");
  }

  const expectedTableDelta = registrationsExisted ? 0 : 1;
  const expectedSequenceDelta = registrationsExisted ? 0 : 1;
  const transactionCounts = await relationCounts();
  if (
    transactionCounts.table_count !== before.table_count + expectedTableDelta
    || transactionCounts.sequence_count !== before.sequence_count + expectedSequenceDelta
  ) {
    throw new Error(
      `Pre-commit relation-count verification failed: tables ${before.table_count}->${transactionCounts.table_count}, sequences ${before.sequence_count}->${transactionCounts.sequence_count}.`,
    );
  }

  await client.query("COMMIT");
  committed = true;
  const after = await relationCounts();
  if (
    after.table_count !== transactionCounts.table_count
    || after.sequence_count !== transactionCounts.sequence_count
  ) {
    throw new Error(
      `Post-commit relation-count verification failed: tables ${transactionCounts.table_count}->${after.table_count}, sequences ${transactionCounts.sequence_count}->${after.sequence_count}.`,
    );
  }

  console.log(
    "Ignored all unrelated Drizzle suggestions by design: no DROP SEQUENCE, DROP CONSTRAINT, rename, truncation, or unallowlisted SQL was executed.",
  );
  console.log(
    `Verified public relation counts: tables ${before.table_count}->${after.table_count}; sequences ${before.sequence_count}->${after.sequence_count}.`,
  );
  console.log("Push completed after verified transaction commit.");
} catch (error) {
  if (!committed) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}