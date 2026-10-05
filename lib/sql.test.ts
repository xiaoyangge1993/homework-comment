import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { createSql, type Executor, type RunResult } from "./sql";

function localExecutor(raw: Database.Database): Executor {
  return {
    get: (sql, args) => Promise.resolve(raw.prepare(sql).get(...args)),
    all: (sql, args) => Promise.resolve(raw.prepare(sql).all(...args) as unknown[]),
    run: (sql, args) => {
      const info = raw.prepare(sql).run(...args);
      return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) } satisfies RunResult);
    },
    exec: (sql) => {
      raw.exec(sql);
      return Promise.resolve();
    },
  };
}

function memory() {
  const raw = new Database(":memory:");
  raw.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT)");
  return createSql({ root: localExecutor(raw), queued: true });
}

describe("createSql", () => {
  it("reads a committed row and rolls back a failed transaction", async () => {
    const db = memory();
    const id = await db.transaction(async () => {
      const info = await db.prepare("INSERT INTO item (name) VALUES (?)").run("panda");
      return Number(info.lastInsertRowid);
    });
    const saved = (await db.prepare("SELECT name FROM item WHERE id = ?").get(id)) as { name: string };
    assert.equal(saved.name, "panda");

    await assert.rejects(
      db.transaction(async () => {
        await db.prepare("INSERT INTO item (name) VALUES (?)").run("gone");
        throw new Error("stop");
      }),
      /stop/,
    );
    const rows = (await db.prepare("SELECT name FROM item").all()) as { name: string }[];
    assert.deepEqual(rows.map((row) => row.name), ["panda"]);
  });

  it("keeps statements issued through the same handle inside the transaction", async () => {
    const db = memory();
    await db.transaction(async () => {
      await db.prepare("INSERT INTO item (name) VALUES (?)").run("first");
      await insert(db, "second");
    });
    const rows = (await db.prepare("SELECT name FROM item ORDER BY id").all()) as { name: string }[];
    assert.deepEqual(rows.map((row) => row.name), ["first", "second"]);
  });
});

async function insert(db: ReturnType<typeof memory>, name: string) {
  await db.prepare("INSERT INTO item (name) VALUES (?)").run(name);
}
