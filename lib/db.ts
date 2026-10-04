import "server-only";

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDataDir } from "./data-dir";
import { AppError } from "./errors";
import { readEnv } from "./env";
import { hashPassword } from "./password";

const globalForDb = globalThis as unknown as { homeworkDb?: Database.Database; homeworkDataDir?: string };
let videoColumnsReady = false;

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

export function getDb(): Database.Database {
  if (!globalForDb.homeworkDb) {
    const dir = dataDir();
    fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
    const db = new Database(path.join(dir, "app.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(loadSchema());
    globalForDb.homeworkDb = db;
  }
  ensureVideoColumns(globalForDb.homeworkDb);
  ensureTeacher(globalForDb.homeworkDb);
  return globalForDb.homeworkDb;
}

function ensureVideoColumns(db: Database.Database) {
  if (videoColumnsReady) return;
  addColumn(db, "assignment", "demo_video_path", "TEXT");
  addColumn(db, "assignment", "demo_audio_path", "TEXT");
  const cols = db.prepare("PRAGMA table_info(sentence_attempt)").all() as { name: string; notnull: number }[];
  const audio = cols.find((col) => col.name === "audio_path");
  const hasVideo = cols.some((col) => col.name === "video_path");
  if (audio && audio.notnull === 0 && hasVideo) {
    videoColumnsReady = true;
    return;
  }
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("DROP TABLE IF EXISTS sentence_attempt_new");
    const rebuild = db.transaction(() => {
      db.exec(`
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
    rebuild();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  videoColumnsReady = true;
}

function addColumn(db: Database.Database, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((col) => col.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function ensureTeacher(db: Database.Database) {
  const existing = db.prepare("SELECT id FROM teacher LIMIT 1").get();
  if (existing) return;
  const password = readEnv("TEACHER_PASSWORD");
  if (!password) return;
  db.prepare("INSERT INTO teacher (password_hash) VALUES (?)").run(hashPassword(password));
  const classRow = db.prepare("SELECT id FROM class LIMIT 1").get();
  if (!classRow) {
    db.prepare("INSERT INTO class (name, join_code) VALUES (?, NULL)").run("默认班级");
  }
}
