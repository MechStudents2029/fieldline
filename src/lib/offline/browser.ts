import type { OfflineEvent, OfflineKind } from "@/lib/offline/event";
import { backoffMs, keepAfterSync, pendingSyncCount, sameScope, type ShiftSnapshot } from "@/lib/offline/replay";

export type Scope = { orgId: string; userId: string };

export type Bootstrap = {
  scope: string;
  orgId: string;
  userId: string;
  timeZone: string;
  weekStartsOn: number;
  jobs: { id: string; name: string }[];
  codes: string[];
  open: ShiftSnapshot;
  savedAt: string;
};

export type StoredEvent = OfflineEvent & {
  scope: string;
  syncStatus: "pending" | "needs_review" | "wrong_user";
  detail: string;
};

export type OutboxView = {
  events: StoredEvent[];
  bootstrap: Bootstrap | null;
  signIn: boolean;
  pendingCount: number;
  reviewCount: number;
  loaded: boolean;
};

const DB_NAME = "fieldline-offline";
const empty: OutboxView = { events: [], bootstrap: null, signIn: false, pendingCount: 0, reviewCount: 0, loaded: false };
let view: OutboxView = empty;
let lastScope: Scope | null = null;
const listeners = new Set<() => void>();
let loopStarted = false;
let attempt = 0;
let flushing = false;

export function scopeKey(scope: Scope) {
  return `${scope.orgId}:${scope.userId}`;
}

export function subscribeOutbox(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function outboxSnapshot() {
  return view;
}

function emit(next: OutboxView) {
  view = next;
  for (const listener of listeners) listener();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("events")) {
        const store = db.createObjectStore("events", { keyPath: "clientEventId" });
        store.createIndex("scope", "scope");
      }
      if (!db.objectStoreNames.contains("bootstrap")) db.createObjectStore("bootstrap", { keyPath: "scope" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(name: "events" | "bootstrap", mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(name, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const result = await run(tx.objectStore(name));
    await done;
    return result;
  } finally {
    db.close();
  }
}

export async function saveBootstrap(input: Omit<Bootstrap, "scope" | "savedAt">) {
  const row: Bootstrap = { ...input, scope: scopeKey(input), savedAt: new Date().toISOString() };
  lastScope = { orgId: input.orgId, userId: input.userId };
  await withStore("bootstrap", "readwrite", (store) => requestToPromise(store.put(row)));
  await refresh();
}

export async function readLastBootstrap(): Promise<Bootstrap | null> {
  const rows = await withStore("bootstrap", "readonly", (store) => requestToPromise(store.getAll() as IDBRequest<Bootstrap[]>));
  return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}

export async function readBootstrap(scope: Scope): Promise<Bootstrap | null> {
  const row = await withStore("bootstrap", "readonly", (store) => requestToPromise(store.get(scopeKey(scope)) as IDBRequest<Bootstrap | undefined>));
  return row ?? null;
}

export async function listEvents(scope: Scope): Promise<StoredEvent[]> {
  const all = await withStore("events", "readonly", (store) => requestToPromise(store.index("scope").getAll(scopeKey(scope)) as IDBRequest<StoredEvent[]>));
  return all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.seq - b.seq);
}

export async function countUnsynced(scope: Scope) {
  const events = await listEvents(scope);
  return events.filter((event) => event.syncStatus !== "needs_review").length;
}

export async function clearScope(scope: Scope) {
  const events = await listEvents(scope);
  await withStore("events", "readwrite", async (store) => {
    await Promise.all(events.map((event) => requestToPromise(store.delete(event.clientEventId))));
  });
  await withStore("bootstrap", "readwrite", (store) => requestToPromise(store.delete(scopeKey(scope))));
  if (lastScope && sameScope(lastScope, scope)) lastScope = null;
  await refresh();
}

export async function enqueuePunch(
  scope: Scope,
  input: {
    kind: OfflineKind;
    projectId?: string | null;
    costCode?: string | null;
    note?: string | null;
    lat?: string | null;
    lng?: string | null;
    log?: OfflineEvent["log"];
    capturedAt?: string;
  },
) {
  const events = await listEvents(scope);
  const seq = events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
  const row: StoredEvent = {
    clientEventId: crypto.randomUUID(),
    seq,
    kind: input.kind,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    orgId: scope.orgId,
    userId: scope.userId,
    projectId: input.projectId ?? null,
    costCode: input.costCode ?? null,
    note: input.note ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    log: input.log ?? null,
    scope: scopeKey(scope),
    syncStatus: "pending",
    detail: "Saved on this phone, will sync",
  };
  await withStore("events", "readwrite", (store) => requestToPromise(store.put(row)));
  await refresh();
  void flushActive();
  return row;
}

/** One pending draft per job. A later edit keeps the id captured on the first save. */
export async function enqueueLogDraft(scope: Scope, projectId: string, log: NonNullable<OfflineEvent["log"]>) {
  const events = await listEvents(scope);
  const existing = events.find((event) => event.kind === "log_draft" && event.projectId === projectId && event.syncStatus === "pending");
  if (existing) {
    const next = { ...existing, log, detail: "Saved on this phone, will sync" };
    await withStore("events", "readwrite", (store) => requestToPromise(store.put(next)));
    await refresh();
    void flushActive();
    return next;
  }
  return enqueuePunch(scope, { kind: "log_draft", projectId, log });
}

async function refresh() {
  if (!lastScope) {
    emit({ ...empty, signIn: view.signIn, loaded: true });
    return;
  }
  const events = await listEvents(lastScope);
  const bootstrap = await readBootstrap(lastScope);
  emit({
    events,
    bootstrap,
    signIn: view.signIn,
    pendingCount: pendingSyncCount(events),
    reviewCount: events.filter((event) => event.syncStatus === "needs_review").length,
    loaded: true,
  });
}

export async function loadLastScope() {
  const boot = await readLastBootstrap();
  if (!boot) {
    lastScope = null;
    emit({ ...empty, loaded: true });
    return;
  }
  lastScope = { orgId: boot.orgId, userId: boot.userId };
  ensureSyncLoop();
  await refresh();
}

export async function probeOrigin(): Promise<boolean> {
  try {
    const response = await fetch(`/api/health?probe=${Date.now()}`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function flushActive() {
  if (flushing) return;
  flushing = true;
  try {
    const online = await probeOrigin();
    setOnline(online);
    if (!online || !lastScope) {
      attempt += online ? 0 : 1;
      schedule(online ? 30_000 : backoffMs(attempt));
      return;
    }
    const events = (await listEvents(lastScope)).filter(
      (event) => event.syncStatus === "pending" && sameScope(event, lastScope!),
    );
    if (events.length === 0) {
      attempt = 0;
      view = { ...view, signIn: false };
      emit(view);
      schedule(30_000);
      return;
    }
    const batch = events.slice(0, 50).map((event) => ({
      clientEventId: event.clientEventId,
      seq: event.seq,
      kind: event.kind,
      capturedAt: event.capturedAt,
      orgId: event.orgId,
      userId: event.userId,
      projectId: event.projectId,
      costCode: event.costCode,
      note: event.note,
      lat: event.lat,
      lng: event.lng,
      log: event.log,
    }));
    const response = await fetch("/api/sync/outbox", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({ events: batch }),
    });
    if (response.status === 401) {
      emit({ ...view, signIn: true });
      attempt += 1;
      schedule(backoffMs(attempt));
      return;
    }
    if (!response.ok) {
      attempt += 1;
      schedule(backoffMs(attempt));
      return;
    }
    const body = (await response.json()) as { results?: { clientEventId: string; status: string; detail?: string }[] };
    await withStore("events", "readwrite", async (store) => {
      for (const result of body.results ?? []) {
        const action = keepAfterSync({ status: result.status as "applied" });
        if (action === "drop") {
          await requestToPromise(store.delete(result.clientEventId));
        } else if (action === "review") {
          const current = await requestToPromise(store.get(result.clientEventId) as IDBRequest<StoredEvent | undefined>);
          if (current) {
            await requestToPromise(store.put({ ...current, syncStatus: "needs_review", detail: result.detail || "Needs office review" }));
          }
        } else if (action === "signin") {
          emit({ ...view, signIn: true });
        }
      }
    });
    const leftover = (await listEvents(lastScope)).some((event) => event.syncStatus === "pending");
    attempt = leftover ? attempt + 1 : 0;
    await refresh();
    schedule(leftover ? backoffMs(attempt) : 30_000);
  } catch {
    attempt += 1;
    schedule(backoffMs(attempt));
  } finally {
    flushing = false;
  }
}

let timer = 0;
function schedule(delay: number) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushActive(), delay);
}

let online = true;
const onlineListeners = new Set<() => void>();

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  for (const listener of onlineListeners) listener();
}

export function subscribeOnline(callback: () => void) {
  onlineListeners.add(callback);
  return () => onlineListeners.delete(callback);
}

export function onlineSnapshot() {
  return online;
}

export function ensureSyncLoop() {
  if (loopStarted || typeof window === "undefined") return;
  loopStarted = true;
  const kick = () => void flushActive();
  window.addEventListener("online", kick);
  window.addEventListener("offline", () => {
    setOnline(false);
    void flushActive();
  });
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  void flushActive();
}

export async function loadScope(scope: Scope) {
  lastScope = scope;
  ensureSyncLoop();
  await refresh();
}
