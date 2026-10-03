import "server-only";

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { hashPassword } from "./password";

const globalForDb = globalThis as unknown as { homeworkDb?: Database.Database };

export function dataDir(): string {
  return path.join(process.cwd(), "data");
}

export function getDb(): Database.Database {
  if (globalForDb.homeworkDb) return globalForDb.homeworkDb;
  const dir = dataDir();
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  const db = new Database(path.join(dir, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  db.exec(schema);
  ensureTeacher(db);
  globalForDb.homeworkDb = db;
  return db;
}

function ensureTeacher(db: Database.Database) {
  const existing = db.prepare("SELECT id FROM teacher LIMIT 1").get();
  if (existing) return;
  const password = process.env.TEACHER_PASSWORD;
  if (!password) return;
  db.prepare("INSERT INTO teacher (password_hash) VALUES (?)").run(hashPassword(password));
  const classRow = db.prepare("SELECT id FROM class LIMIT 1").get();
  if (!classRow) {
    db.prepare("INSERT INTO class (name, join_code) VALUES (?, NULL)").run("默认班级");
  }
}
