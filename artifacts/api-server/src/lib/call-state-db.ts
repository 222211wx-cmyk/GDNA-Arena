import { pool } from "@workspace/db";
import { createHash } from "node:crypto";
type QueryResponse<T> = { rows: T[]; rowCount: number | null };
type PoolClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResponse<T>>;
  release(): void;
  on?: (event: "notification" | "error", listener: (...args: any[]) => void) => void;
};

export class CallPushError extends Error {
  constructor(message: string, readonly diagnosticCode?: string) { super(message); this.name = "CallPushError"; }
}

/** Diagnostics must never include driver messages, queries, parameters or call secrets. */
export function callFailureDiagnosticCode(error: unknown): string {
  if (error instanceof CallPushError && error.diagnosticCode) return error.diagnosticCode;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
    ? `POSTGRES_${code}` : "CALL_OFFER_FAILED";
}

export function callSessionBinding(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

/**
 * A deliberately small Firestore-shaped API backed by PostgreSQL.  Call state
 * is stored under a fully qualified document path; this keeps the call
 * stores' existing state machine readable while making PostgreSQL the only
 * authority.
 */
export type CallStateValue = Record<string, unknown>;
export type WhereOperator = "==" | "array-contains" | "<=" | "<" | ">=" | ">";

function encode(value: unknown): unknown {
  if (value instanceof Date) return { __callStateDate: value.toISOString() };
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return encode((value as { toDate(): Date }).toDate());
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

export function reviveCallState<T = unknown>(value: T): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(item => reviveCallState(item)) as T;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.toDate === "function") return (object.toDate as () => Date)() as T;
    if (typeof object.__callStateDate === "string" && Object.keys(object).length === 1) {
      return new Date(object.__callStateDate) as T;
    }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, reviveCallState(item)])) as T;
  }
  return value;
}

function pathParts(path: string) { return path.split("/").filter(Boolean); }
function childPath(parent: string, id: string) {
  if (!id || id.includes("/")) throw new Error("Invalid call state document ID");
  return `${parent.replace(/\/+$/, "")}/${id}`;
}
function fieldValue(data: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, data);
}
function compare(actual: unknown, expected: unknown, op: WhereOperator): boolean {
  if (op === "==") return JSON.stringify(encode(actual)) === JSON.stringify(encode(expected));
  if (op === "array-contains") return Array.isArray(actual) && actual.some(item => compare(item, expected, "=="));
  if (actual instanceof Date && expected instanceof Date) {
    actual = actual.getTime(); expected = expected.getTime();
  }
  if (typeof actual !== "number" && typeof actual !== "string") return false;
  if (op === "<=") return actual <= (expected as typeof actual);
  if (op === "<") return actual < (expected as typeof actual);
  if (op === ">=") return actual >= (expected as typeof actual);
  return actual > (expected as typeof actual);
}

export class CallStateDocumentSnapshot {
  constructor(
    readonly id: string,
    readonly ref: CallStateDocumentReference,
    private readonly value: CallStateValue | null,
  ) {}
  get exists() { return this.value !== null; }
  data(): CallStateValue | undefined { return this.value ? reviveCallState(this.value) : undefined; }
}

export class CallStateQuerySnapshot {
  constructor(readonly docs: CallStateDocumentSnapshot[], private readonly changes: CallStateDocumentChange[]) {}
  docChanges(): CallStateDocumentChange[] { return this.changes; }
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
}

export interface CallStateDocumentChange {
  type: "added" | "modified" | "removed";
  doc: CallStateDocumentSnapshot;
}

type QueryConstraint = { field: string; op: WhereOperator; value: unknown };
type QueryOptions = {
  constraints?: QueryConstraint[];
  order?: { field: string; direction: "asc" | "desc" };
  max?: number;
  startAfter?: string;
};

async function rowsFor(client: PoolClient, collectionPath: string): Promise<Array<{ path: string; data: CallStateValue }>> {
  // The segment count prevents a collection query from accidentally including
  // descendants in another subcollection.
  const depth = pathParts(collectionPath).length + 1;
  const result = await client.query<{ path: string; data: CallStateValue }>(
    `SELECT path, data FROM call_state_documents
       WHERE path LIKE $1 AND array_length(string_to_array(path, '/'), 1) = $2`,
    [`${collectionPath.replace(/\/+$/, "")}/%`, depth],
  );
  return result.rows;
}

class StateReader {
  constructor(protected readonly client: PoolClient) {}
  async read(ref: CallStateDocumentReference): Promise<CallStateDocumentSnapshot> {
    const result = await this.client.query<{ data: CallStateValue }>(
      "SELECT data FROM call_state_documents WHERE path=$1", [ref.path],
    );
    return new CallStateDocumentSnapshot(ref.id, ref, result.rows[0] ? reviveCallState(result.rows[0].data) : null);
  }
}

export class CallStateDocumentReference {
  constructor(readonly db: CallStateDb, readonly path: string) {}
  get id() { return pathParts(this.path).at(-1)!; }
  collection(name: string) { return new CallStateCollectionReference(this.db, `${this.path}/${name}`); }
  async get() {
    const client = await this.db.connect();
    try { return await new StateReader(client).read(this); } finally { client.release(); }
  }
  async set(data: CallStateValue, options?: { merge?: boolean }) {
    return this.db.write(async client => {
      const value = options?.merge ? { ...(await new StateReader(client).read(this)).data(), ...data } : data;
      await client.query(
        `INSERT INTO call_state_documents(path, data) VALUES ($1,$2)
         ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
        [this.path, encode(value)],
      );
    }, [this.path]);
  }
  async update(data: CallStateValue) {
    return this.db.write(async client => {
      const current = await new StateReader(client).read(this);
      if (!current.exists) throw new Error(`Call state document does not exist: ${this.path}`);
      await client.query("UPDATE call_state_documents SET data=$2, updated_at=NOW() WHERE path=$1",
        [this.path, encode({ ...current.data(), ...data })]);
    }, [this.path]);
  }
  async delete() {
    return this.db.write(async client => { await client.query("DELETE FROM call_state_documents WHERE path=$1", [this.path]); }, [this.path]);
  }
}

export class CallStateCollectionReference {
  constructor(readonly db: CallStateDb, readonly path: string, readonly options: QueryOptions = {}) {}
  doc(id: string) { return new CallStateDocumentReference(this.db, childPath(this.path, id)); }
  where(field: string, op: WhereOperator, value: unknown) {
    return new CallStateCollectionReference(this.db, this.path,
      { ...this.options, constraints: [...(this.options.constraints ?? []), { field, op, value }] });
  }
  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new CallStateCollectionReference(this.db, this.path, { ...this.options, order: { field, direction } });
  }
  limit(max: number) { return new CallStateCollectionReference(this.db, this.path, { ...this.options, max }); }
  startAfter(snapshot: CallStateDocumentSnapshot) {
    return new CallStateCollectionReference(this.db, this.path, { ...this.options, startAfter: snapshot.ref.path });
  }
  async get(): Promise<CallStateQuerySnapshot> {
    const client = await this.db.connect();
    try { return (await this.readWith(client)).snapshot; } finally { client.release(); }
  }
  async readWith(client: PoolClient, previous?: Map<string, string>) {
    const rows = await rowsFor(client, this.path);
    let filtered = rows.filter(row => {
      const data = reviveCallState(row.data);
      return (this.options.constraints ?? []).every(item => compare(fieldValue(data, item.field), item.value, item.op));
    });
    const order = this.options.order;
    if (order) filtered.sort((a, b) => {
      const av = fieldValue(reviveCallState(a.data), order.field);
      const bv = fieldValue(reviveCallState(b.data), order.field);
      const result = av === bv ? a.path.localeCompare(b.path) : av == null ? -1 : bv == null ? 1 : av < (bv as any) ? -1 : 1;
      return order.direction === "desc" ? -result : result;
    });
    if (this.options.startAfter) {
      const index = filtered.findIndex(row => row.path === this.options.startAfter);
      if (index >= 0) filtered = filtered.slice(index + 1);
    }
    if (this.options.max !== undefined) filtered = filtered.slice(0, this.options.max);
    const docs = filtered.map(row => {
      const ref = new CallStateDocumentReference(this.db, row.path);
      return new CallStateDocumentSnapshot(ref.id, ref, reviveCallState(row.data));
    });
    const next = new Map(docs.map(doc => [doc.ref.path, JSON.stringify(encode(doc.data()))]));
    const changes: CallStateDocumentChange[] = [];
    for (const doc of docs) {
      if (!previous?.has(doc.ref.path)) changes.push({ type: "added", doc });
      else if (previous.get(doc.ref.path) !== next.get(doc.ref.path)) changes.push({ type: "modified", doc });
    }
    if (previous) for (const [path] of previous) if (!next.has(path)) {
      const ref = new CallStateDocumentReference(this.db, path);
      changes.push({ type: "removed", doc: new CallStateDocumentSnapshot(ref.id, ref, null) });
    }
    return { snapshot: new CallStateQuerySnapshot(docs, changes), state: next };
  }
  onSnapshot(next: (snapshot: CallStateQuerySnapshot) => void, error?: (reason: unknown) => void) {
    let stopped = false;
    let previous: Map<string, string> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let running = false;
    let dirty = true;
    const unsubscribeNotifications = this.db.subscribe(() => { dirty = true; void run(); });
    const run = async () => {
      if (stopped || running) { dirty = true; return; }
      dirty = false;
      running = true;
      try {
        const { snapshot, state } = await this.getWithState(previous);
        if (!stopped && (snapshot.docChanges().length || !previous)) next(snapshot);
        previous = state;
      } catch (reason) { if (!stopped) error?.(reason); }
      finally {
        running = false;
        if (!stopped && dirty) void run();
      }
    };
    void run();
    timer = setInterval(() => { dirty = true; void run(); }, 2000);
    timer.unref?.();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      unsubscribeNotifications();
    };
  }
  private async getWithState(previous?: Map<string, string>) {
    const client = await this.db.connect();
    try { return await this.readWith(client, previous); } finally { client.release(); }
  }
}

export class CallStateTransaction extends StateReader {
  private writes: Array<() => Promise<void>> = [];
  private touched = new Set<string>();
  constructor(client: PoolClient) { super(client); }
  get(ref: CallStateDocumentReference) { return this.read(ref); }
  /** Only a well-formed recorded binding can prove revocation. Session IDs
   * stay inside PostgreSQL; query errors abort the enclosing transaction. */
  async isRecordedSessionRevoked(userId: unknown, binding: unknown): Promise<boolean> {
    if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0 ||
      typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)) return false;
    const result = await this.client.query<{ live: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM user_sessions
         WHERE sess->>'userId' = $1 AND expire > NOW()
           AND encode(sha256(convert_to(sid, 'UTF8')), 'hex') = $2
       ) AS live`,
      [String(userId), binding],
    );
    return result.rows[0]?.live === false;
  }
  create(ref: CallStateDocumentReference, data: CallStateValue) {
    this.writes.push(async () => {
      const result = await this.client.query("INSERT INTO call_state_documents(path,data) VALUES ($1,$2) ON CONFLICT(path) DO NOTHING", [ref.path, encode(data)]);
      if (!result.rowCount) throw new Error(`Call state document already exists: ${ref.path}`);
    }); this.touched.add(ref.path);
  }
  set(ref: CallStateDocumentReference, data: CallStateValue, options?: { merge?: boolean }) {
    this.writes.push(async () => {
      const current = options?.merge ? await this.read(ref) : null;
      const value = options?.merge ? { ...(current?.data() ?? {}), ...data } : data;
      await this.client.query(`INSERT INTO call_state_documents(path,data) VALUES ($1,$2)
        ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [ref.path, encode(value)]);
    }); this.touched.add(ref.path);
  }
  update(ref: CallStateDocumentReference, data: CallStateValue) {
    this.writes.push(async () => {
      const current = await this.read(ref);
      if (!current.exists) throw new Error(`Call state document does not exist: ${ref.path}`);
      await this.client.query("UPDATE call_state_documents SET data=$2,updated_at=NOW() WHERE path=$1",
        [ref.path, encode({ ...current.data(), ...data })]);
    }); this.touched.add(ref.path);
  }
  delete(ref: CallStateDocumentReference) {
    this.writes.push(async () => { await this.client.query("DELETE FROM call_state_documents WHERE path=$1", [ref.path]); });
    this.touched.add(ref.path);
  }
  async commit() { for (const write of this.writes) await write(); }
  paths() { return [...this.touched]; }
}

export class CallStateDb {
  private readonly subscriptions = new Set<() => void>();
  private listenerClient: PoolClient | undefined;
  private listenerStarting: Promise<void> | undefined;
  collection(name: string) { return new CallStateCollectionReference(this, name); }
  doc(path: string) { return new CallStateDocumentReference(this, path); }
  async connect(): Promise<PoolClient> { return pool.connect() as unknown as Promise<PoolClient>; }
  subscribe(listener: () => void) {
    this.subscriptions.add(listener);
    void this.ensureListener();
    return () => {
      this.subscriptions.delete(listener);
      if (!this.subscriptions.size) this.closeListener();
    };
  }
  private async ensureListener() {
    if (this.listenerClient || this.listenerStarting || !this.subscriptions.size) return this.listenerStarting;
    this.listenerStarting = (async () => {
      try {
        const client = await this.connect();
        if (!this.subscriptions.size) { client.release(); return; }
        await client.query("LISTEN call_state_documents");
        this.listenerClient = client;
        client.on?.("notification", () => {
          for (const subscriber of this.subscriptions) subscriber();
        });
        client.on?.("error", () => {
          if (this.listenerClient === client) {
            this.listenerClient = undefined;
            client.release();
            void this.ensureListener();
          }
        });
      } catch {
        // LISTEN is only an optimization. Every subscriber retains bounded
        // polling, including after a connection or replica restart.
      } finally {
        this.listenerStarting = undefined;
      }
    })();
    return this.listenerStarting;
  }
  private closeListener() {
    const client = this.listenerClient;
    this.listenerClient = undefined;
    if (client) void client.query("UNLISTEN call_state_documents").catch(() => undefined).finally(() => client.release());
  }
  async write(work: (client: PoolClient) => Promise<void>, paths: string[] = []) {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('call-state', 0))");
      await work(client);
      await client.query("COMMIT");
      // Notification is optional (subscribers also poll). A failed pg_notify
      // must not abort the transaction that saved the invitation.
      await notifyOnClient(client, paths);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async runTransaction<T>(work: (transaction: CallStateTransaction) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('call-state', 0))");
      const transaction = new CallStateTransaction(client);
      const result = await work(transaction);
      await transaction.commit();
      await client.query("COMMIT");
      await notifyOnClient(client, transaction.paths());
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  batch() {
    const operations: Array<(transaction: CallStateTransaction) => void> = [];
    return {
      create: (ref: CallStateDocumentReference, data: CallStateValue) => operations.push(transaction => transaction.create(ref, data)),
      set: (ref: CallStateDocumentReference, data: CallStateValue, options?: { merge?: boolean }) =>
        operations.push(transaction => transaction.set(ref, data, options)),
      update: (ref: CallStateDocumentReference, data: CallStateValue) => operations.push(transaction => transaction.update(ref, data)),
      delete: (ref: CallStateDocumentReference) => operations.push(transaction => transaction.delete(ref)),
      commit: () => this.runTransaction(async transaction => { for (const operation of operations) operation(transaction); }),
    };
  }
}

/** Structural name retained for optional push/device workers. */
export type CallDatabase = CallStateDb;

async function notifyOnClient(client: PoolClient, paths: string[]) {
  if (!paths.length) return;
  await client.query("SELECT pg_notify('call_state_documents', $1)", [JSON.stringify(paths)]).catch(() => undefined);
}

let instance: CallStateDb | undefined;
export function getCallStateDb(): CallStateDb {
  return instance ??= new CallStateDb();
}