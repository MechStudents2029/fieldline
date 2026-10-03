import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { splitSql, translateSqliteQuery } from "@/lib/db/sql";

type Mode = { mode: "pg"; url: string } | { mode: "pglite" };

type Stmt = {
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  raw: () => { all: (...params: unknown[]) => unknown[][]; get: (...params: unknown[]) => unknown[] | undefined };
};

export type SqliteCompat = {
  prepare: (sql: string) => Stmt;
  exec: (sql: string) => void;
  pragma: (value: string) => unknown;
  close: () => void;
  transaction: (fn: (...args: unknown[]) => unknown) => {
    deferred: (...args: unknown[]) => unknown;
    immediate: (...args: unknown[]) => unknown;
    exclusive: (...args: unknown[]) => unknown;
  };
};

type Packet = { ok: true; rows: Record<string, unknown>[]; arrays: unknown[][]; rowCount: number } | { ok: false; error: string };

const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");

function pack(result) {
  const fields = (result.fields || []).map((field) => field.name);
  const rows = result.rows || [];
  const arrays = rows.map((row) => fields.map((name) => row[name]));
  return { rows, arrays, rowCount: result.rowCount ?? rows.length };
}

let runQuery = async () => {
  throw new Error("Postgres worker is not ready.");
};
let shutdown = async () => {};

parentPort.on("message", async (msg) => {
  try {
    const flag = new Int32Array(msg.flagBuffer);
    if (msg.type === "close") {
      await shutdown();
      msg.port.postMessage({ ok: true, rows: [], arrays: [], rowCount: 0 });
    } else {
      const result = await runQuery(msg.sql, msg.params || []);
      msg.port.postMessage({ ok: true, ...pack(result) });
    }
  } catch (error) {
    msg.port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    const flag = new Int32Array(msg.flagBuffer);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  }
});

(async () => {
  try {
    if (workerData.mode === "pglite") {
      const { PGlite } = require("@electric-sql/pglite");
      const db = new PGlite();
      await db.waitReady;
      runQuery = (sql, params) => db.query(sql, params);
      shutdown = () => db.close();
    } else {
      const { Client } = require("pg");
      const client = new Client({ connectionString: workerData.url });
      await client.connect();
      runQuery = (sql, params) => client.query(sql, params);
      shutdown = () => client.end();
    }
    workerData.readyPort.postMessage({ ok: true });
  } catch (error) {
    workerData.readyPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    const readyFlag = new Int32Array(workerData.readyFlag);
    Atomics.store(readyFlag, 0, 1);
    Atomics.notify(readyFlag, 0);
  }
})();
`;

function call(worker: Worker, payload: { type: string; sql?: string; params?: unknown[] }): Packet {
  const { port1, port2 } = new MessageChannel();
  const flag = new Int32Array(new SharedArrayBuffer(4));
  worker.postMessage({ ...payload, port: port2, flagBuffer: flag.buffer }, [port2]);
  const waited = Atomics.wait(flag, 0, 0, 60_000);
  if (waited === "timed-out") throw new Error("Postgres query timed out.");
  const received = receiveMessageOnPort(port1);
  if (!received) throw new Error("Postgres worker returned no result.");
  return received.message as Packet;
}

function redact(message: string, secret: string | undefined) {
  if (!secret) return message;
  return message.split(secret).join("postgres://…");
}

export function createSqliteCompat(options: Mode): SqliteCompat {
  const { port1, port2 } = new MessageChannel();
  const readyFlag = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      mode: options.mode,
      url: options.mode === "pg" ? options.url : "",
      readyPort: port2,
      readyFlag: readyFlag.buffer,
    },
    transferList: [port2],
  });
  const waited = Atomics.wait(readyFlag, 0, 0, 60_000);
  if (waited === "timed-out") {
    worker.terminate();
    throw new Error("Postgres worker did not start.");
  }
  const ready = receiveMessageOnPort(port1);
  const readyMessage = ready?.message as { ok: boolean; error?: string } | undefined;
  if (!readyMessage?.ok) {
    worker.terminate();
    const url = options.mode === "pg" ? options.url : undefined;
    throw new Error(redact(readyMessage?.error || "Postgres worker failed to start.", url));
  }

  function query(sql: string, params: unknown[]) {
    const translated = translateSqliteQuery(sql);
    const packet = call(worker, {
      type: "query",
      sql: translated,
      params: params.map((value) => (value === undefined ? null : value)),
    });
    if (!packet.ok) throw new Error(`${packet.error}\n${translated.slice(0, 240)}`);
    return packet;
  }

  function statement(sql: string): Stmt {
    return {
      run(...params) {
        const result = query(sql, params);
        return { changes: result.rowCount, lastInsertRowid: 0 };
      },
      all(...params) {
        return query(sql, params).rows;
      },
      get(...params) {
        return query(sql, params).rows[0];
      },
      raw() {
        return {
          all(...params) {
            return query(sql, params).arrays as unknown[][];
          },
          get(...params) {
            return query(sql, params).arrays[0] as unknown[] | undefined;
          },
        };
      },
    };
  }

  let closed = false;
  function exec(sql: string) {
    for (const statementSql of splitSql(sql)) {
      query(statementSql, []);
    }
  }
  return {
    prepare: statement,
    exec,
    pragma() {
      return undefined;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        call(worker, { type: "close" });
      } catch {
        // The worker is going away either way.
      }
      worker.terminate();
    },
    transaction(fn) {
      const wrapped = (...args: unknown[]) => {
        exec("begin");
        try {
          const result = fn(...args);
          exec("commit");
          return result;
        } catch (error) {
          try {
            exec("rollback");
          } catch {
            // Keep the original error. The connection may already be aborted.
          }
          throw error;
        }
      };
      return { deferred: wrapped, immediate: wrapped, exclusive: wrapped };
    },
  };
}
