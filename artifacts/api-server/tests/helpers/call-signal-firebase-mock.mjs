/*
 * Test-only Firestore adapter for call-signal-store regression coverage.
 * All imported store bundles share this module, which models Firestore's
 * transaction serialization while keeping documents in memory.
 */

let authoritativeDb;

const copy = (value) => structuredClone(value);

class Snapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.value = value;
    this.exists = value !== undefined;
    this.id = reference.path.split("/").at(-1);
  }

  data() {
    return this.value === undefined ? undefined : copy(this.value);
  }
}

class QuerySnapshot {
  constructor(documents, changes = []) {
    this.docs = documents;
    this.size = documents.length;
    this.changes = changes;
  }

  docChanges() {
    return this.changes;
  }
}

class DocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  collection(name) {
    return new CollectionReference(this.db, `${this.path}/${name}`);
  }

  async get() {
    return this.db.snapshot(this);
  }
}

class CollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.order = undefined;
    this.take = undefined;
    this.condition = undefined;
  }

  doc(id) {
    return new DocumentReference(this.db, `${this.path}/${id}`);
  }

  orderBy(field, direction = "asc") {
    const query = new CollectionReference(this.db, this.path);
    query.order = { field, direction };
    query.take = this.take;
    query.condition = this.condition;
    return query;
  }

  limit(count) {
    const query = new CollectionReference(this.db, this.path);
    query.order = this.order;
    query.take = count;
    query.condition = this.condition;
    return query;
  }

  where(field, operator, value) {
    const query = new CollectionReference(this.db, this.path);
    query.order = this.order;
    query.take = this.take;
    query.condition = { field, operator, value };
    return query;
  }

  matches(value) {
    if (!this.condition) return true;
    const { field, operator, value: expected } = this.condition;
    return operator === "array-contains" && Array.isArray(value?.[field]) && value[field].includes(expected);
  }

  async get() {
    const prefix = `${this.path}/`;
    let docs = [...this.db.documents.entries()]
      .filter(([path, value]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && this.matches(value))
      .map(([path, value]) => new Snapshot(new DocumentReference(this.db, path), value));
    if (this.order) {
      const multiplier = this.order.direction === "desc" ? -1 : 1;
      docs.sort((left, right) => {
        const a = left.data()?.[this.order.field];
        const b = right.data()?.[this.order.field];
        return (a < b ? -1 : a > b ? 1 : 0) * multiplier;
      });
    }
    if (this.take !== undefined) docs = docs.slice(0, this.take);
    return new QuerySnapshot(docs);
  }

  onSnapshot(callback, errorCallback) {
    return this.db.addSnapshotListener(this, callback, errorCallback);
  }
}

class Transaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(reference) {
    return this.db.snapshot(reference);
  }

  create(reference, value) {
    if (this.db.documents.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
    this.operations.push({ kind: "create", reference, value });
  }

  set(reference, value, options) {
    this.operations.push({ kind: "set", reference, value, options });
  }

  update(reference, value) {
    if (!this.db.documents.has(reference.path)) throw new Error(`missing document: ${reference.path}`);
    this.operations.push({ kind: "update", reference, value });
  }

  delete(reference) {
    this.operations.push({ kind: "delete", reference });
  }

  commit() {
    const changedPaths = [];
    for (const operation of this.operations) {
      const existing = this.db.documents.get(operation.reference.path);
      if (operation.kind === "create") {
        if (existing !== undefined) throw new Error(`already exists: ${operation.reference.path}`);
        this.db.documents.set(operation.reference.path, copy(operation.value));
      } else if (operation.kind === "set") {
        this.db.documents.set(operation.reference.path,
          operation.options?.merge ? { ...(existing ?? {}), ...copy(operation.value) } : copy(operation.value));
      } else if (operation.kind === "update") {
        if (existing === undefined) throw new Error(`missing document: ${operation.reference.path}`);
        this.db.documents.set(operation.reference.path, { ...existing, ...copy(operation.value) });
      } else {
        this.db.documents.delete(operation.reference.path);
      }
      changedPaths.push(operation.reference.path);
    }
    this.db.notifySnapshotListeners(changedPaths);
  }
}

export class SharedFirestore {
  constructor() {
    this.documents = new Map();
    this.transactionTail = Promise.resolve();
    this.abortBeforeNextCommit = undefined;
    this.snapshotListeners = new Set();
  }

  collection(name) {
    return new CollectionReference(this, name);
  }

  snapshot(reference) {
    return new Snapshot(reference, this.documents.get(reference.path));
  }

  async runTransaction(callback) {
    const run = this.transactionTail.then(async () => {
      const attempt = async () => {
        const transaction = new Transaction(this);
        const result = await callback(transaction);
        return { transaction, result };
      };
      let completed = await attempt();
      if (this.abortBeforeNextCommit) {
        const conflict = this.abortBeforeNextCommit;
        this.abortBeforeNextCommit = undefined;
        // Discard staged writes exactly as Firestore does on a conflict, apply
        // the competing canonical write, then invoke the callback again.
        await conflict(this);
        completed = await attempt();
      }
      completed.transaction.commit();
      return completed.result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }

  batch() {
    const transaction = new Transaction(this);
    return {
      delete: (reference) => transaction.delete(reference),
      commit: async () => transaction.commit(),
    };
  }

  addSnapshotListener(query, callback, errorCallback) {
    const listener = { query, callback, errorCallback };
    this.snapshotListeners.add(listener);
    queueMicrotask(() => {
      if (!this.snapshotListeners.has(listener)) return;
      query.get().then(snapshot => {
        callback(new QuerySnapshot(snapshot.docs, snapshot.docs.map(doc => ({ type: "added", doc }))));
      }).catch(error => errorCallback?.(error));
    });
    return () => this.snapshotListeners.delete(listener);
  }

  notifySnapshotListeners(changedPaths) {
    for (const listener of this.snapshotListeners) {
      const prefix = `${listener.query.path}/`;
      const changes = changedPaths
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(path => new Snapshot(new DocumentReference(this, path), this.documents.get(path)))
        .filter(snapshot => !snapshot.exists || listener.query.matches(snapshot.data()))
        .map(doc => ({ type: doc.exists ? "modified" : "removed", doc }));
      if (changes.length) queueMicrotask(() => {
        if (this.snapshotListeners.has(listener)) listener.callback(new QuerySnapshot(changes.map(change => change.doc), changes));
      });
    }
  }

  document(path) {
    const value = this.documents.get(path);
    return value === undefined ? undefined : copy(value);
  }

  replaceDocument(path, value) {
    this.documents.set(path, copy(value));
  }

  abortNextTransactionBeforeCommit(conflict) {
    this.abortBeforeNextCommit = conflict;
  }
}

export function setAuthoritativeFirestore(db) {
  authoritativeDb = db;
}

export async function getAuthoritativeCallFirestore() {
  if (!authoritativeDb) throw new Error("Test Firestore was not configured");
  return authoritativeDb;
}

export class CallPushError extends Error {
  constructor(message) {
    super(message);
    this.name = "CallPushError";
  }
}

export function callSessionBinding(sessionId) {
  return `test-session:${sessionId}`;
}

export function isValidCallId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export async function sendAuthoritativeIncomingCallPush() {
  // Push delivery is outside the store's persistence contract.
}

export async function declineDeferredCallInvitation() {
  throw new Error("Not used by subscribeCalls regression coverage");
}