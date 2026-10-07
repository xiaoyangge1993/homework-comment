import "server-only";

import fs from "fs";
import path from "path";
import type BetterSqlite3 from "better-sqlite3";
import type { Client, InValue, ResultSet, Value } from "@libsql/client/http";
import { resolveDataDir } from "./data-dir";
import { AppError } from "./errors";
import { readEnv } from "./env";
import { hashPassword } from "./password";
import { createSql, type Executor, type RunResult, type Sql } from "./sql";
import { tursoConfig } from "./turso-config";

const globalForDb = globalThis as unknown as { homeworkDb?: Promise<Sql>; homeworkDataDir?: string };
let videoColumnsReady = false;

type RemoteSession = {
  execute(stmt: { sql: string; args?: InValue[] }): Promise<ResultSet>;
  executeMultiple(sql: string): Promise<void>;
};

export function dataDir(): string {
  if (!globalForDb.homeworkDataDir) {
    globalForDb.homeworkDataDir = resolveDataDir(process.cwd(), readEnv("DATA_DIR"));
  }
  return globalForDb.homeworkDataDir;
}

function loadSchema(): string {
  const schemaPath = path.join(process.cwd(), "lib", "schema.sql");
  try {
    return fs.readFileSync(schemaPath, "utf8");
  } catch {
    throw new AppError("服务器找不到数据库结构文件");
  }
}

export function getDb(): Promise<Sql> {
  if (!globalForDb.homeworkDb) {
    globalForDb.homeworkDb = openDatabase().catch((error: unknown) => {
      globalForDb.homeworkDb = undefined;
      throw error;
    });
  }
  return globalForDb.homeworkDb;
}

async function openDatabase(): Promise<Sql> {
  const remote = tursoConfig();
  const db = remote ? await openRemote(remote.url, remote.authToken) : await openLocal();
  await ensureVideoColumns(db);
  await ensureIntonationColumns(db);
  await ensureTeacher(db);
  return db;
}

async function loadBetterSqlite3(): Promise<typeof BetterSqlite3> {
  const imported = await import("better-sqlite3");
  const ctor = imported.default;
  if (typeof ctor !== "function") throw new AppError("本地数据库模块加载失败");
  return ctor;
}

async function openLocal(): Promise<Sql> {
  const dir = dataDir();
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  const Database = await loadBetterSqlite3();
  const raw = new Database(path.join(dir, "app.db"));
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  raw.exec(loadSchema());
  return createSql({ root: sqliteExecutor(raw), queued: true });
}

async function openRemote(url: string, authToken: string): Promise<Sql> {
  const { createClient } = await import("@libsql/client/http");
  const client = createClient({ url, authToken, intMode: "number" });
  await client.executeMultiple(loadSchema());
  await client.execute("PRAGMA foreign_keys = ON");
  return createSql({
    root: libsqlExecutor(client),
    queued: false,
    transact(fn, bind) {
      return runLibsqlTransaction(client, fn, bind);
    },
  });
}

async function runLibsqlTransaction(
  client: Client,
  fn: () => Promise<unknown>,
  bind: (executor: Executor, fn: () => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
  const tx = await client.transaction("write");
  try {
    const result = await bind(libsqlExecutor(tx), fn);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // The transaction is already closed.
    }
    throw error;
  } finally {
    tx.close();
  }
}

function sqliteExecutor(raw: BetterSqlite3.Database): Executor {
  return {
    get: (sql, args) => Promise.resolve(raw.prepare(sql).get(...args)),
    all: (sql, args) => Promise.resolve(raw.prepare(sql).all(...args) as unknown[]),
    run: (sql, args) => {
      const info = raw.prepare(sql).run(...args);
      return Promise.resolve(runResult(info.changes, info.lastInsertRowid));
    },
    exec: (sql) => {
      raw.exec(sql);
      return Promise.resolve();
    },
  };
}

function libsqlExecutor(session: RemoteSession): Executor {
  return {
    get: async (sql, args) => {
      const result = await session.execute({ sql, args: sqlArgs(args) });
      return plainRows(result)[0];
    },
    all: async (sql, args) => {
      const result = await session.execute({ sql, args: sqlArgs(args) });
      return plainRows(result);
    },
    run: async (sql, args) => {
      const result = await session.execute({ sql, args: sqlArgs(args) });
      return runResult(result.rowsAffected, result.lastInsertRowid);
    },
    exec: async (sql) => {
      await session.executeMultiple(sql);
    },
  };
}

function sqlArgs(args: unknown[]): InValue[] {
  return args.map((value) => (value === undefined ? null : (value as InValue)));
}

function plainRows(result: ResultSet): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i += 1) {
      record[result.columns[i]] = cell(row[i]);
    }
    return record;
  });
}

function cell(value: Value): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

function runResult(changes: number | undefined, lastInsertRowid: number | bigint | null | undefined): RunResult {
  return { changes: Number(changes ?? 0), lastInsertRowid: Number(lastInsertRowid ?? 0) };
}

async function ensureVideoColumns(db: Sql) {
  if (videoColumnsReady) return;
  await addColumn(db, "assignment", "demo_video_path", "TEXT");
  await addColumn(db, "assignment", "demo_audio_path", "TEXT");
  const cols = (await db.prepare("PRAGMA table_info(sentence_attempt)").all()) as { name: string; notnull: number }[];
  const audio = cols.find((col) => col.name === "audio_path");
  const hasVideo = cols.some((col) => col.name === "video_path");
  if (audio && Number(audio.notnull) === 0 && hasVideo) {
    videoColumnsReady = true;
    return;
  }
  await db.exec("PRAGMA foreign_keys = OFF");
  try {
    await db.exec("DROP TABLE IF EXISTS sentence_attempt_new");
    await db.transaction(async () => {
      await db.exec(`
        CREATE TABLE sentence_attempt_new (
          id INTEGER PRIMARY KEY,
          submission_id INTEGER NOT NULL REFERENCES submission(id),
          sentence_id INTEGER NOT NULL REFERENCES sentence(id),
          audio_path TEXT,
          video_path TEXT,
          accuracy REAL,
          fluency REAL,
          completion REAL,
          rhythm TEXT,
          raw_json TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO sentence_attempt_new
          (id, submission_id, sentence_id, audio_path, video_path, accuracy, fluency, completion, rhythm, raw_json, created_at)
        SELECT id, submission_id, sentence_id, audio_path, NULL, accuracy, fluency, completion, rhythm, raw_json, created_at
        FROM sentence_attempt;
        DROP TABLE sentence_attempt;
        ALTER TABLE sentence_attempt_new RENAME TO sentence_attempt;
        CREATE INDEX IF NOT EXISTS idx_attempt_submission ON sentence_attempt(submission_id, sentence_id, id);
      `);
    });
  } finally {
    await db.exec("PRAGMA foreign_keys = ON");
  }
  videoColumnsReady = true;
}

async function ensureIntonationColumns(db: Sql) {
  await addColumn(db, "sentence_attempt", "intonation_status", "TEXT");
  await addColumn(db, "sentence_attempt", "teacher_final", "TEXT");
  await addColumn(db, "sentence_attempt", "student_final", "TEXT");
  await addColumn(db, "sentence_attempt", "contour_agreement", "REAL");
  await addColumn(db, "sentence_attempt", "intonation_json", "TEXT");
}

async function addColumn(db: Sql, table: string, column: string, type: string) {
  const cols = (await db.prepare(`PRAGMA table_info(${table})`).all()) as { name: string }[];
  if (cols.some((col) => col.name === column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

async function ensureTeacher(db: Sql) {
  const existing = await db.prepare("SELECT id FROM teacher LIMIT 1").get();
  if (existing) return;
  const password = readEnv("TEACHER_PASSWORD");
  if (!password) return;
  await db.prepare("INSERT INTO teacher (password_hash) VALUES (?)").run(hashPassword(password));
  const classRow = await db.prepare("SELECT id FROM class LIMIT 1").get();
  if (!classRow) {
    await db.prepare("INSERT INTO class (name, join_code) VALUES (?, NULL)").run("默认班级");
  }
}
