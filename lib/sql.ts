import { AsyncLocalStorage } from "async_hooks";

export type RunResult = { lastInsertRowid: number; changes: number };

export type Statement = {
  get(...args: unknown[]): Promise<unknown>;
  all(...args: unknown[]): Promise<unknown[]>;
  run(...args: unknown[]): Promise<RunResult>;
};

export type Sql = {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

export type Executor = {
  get(sql: string, args: unknown[]): Promise<unknown>;
  all(sql: string, args: unknown[]): Promise<unknown[]>;
  run(sql: string, args: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
};

type SqlOptions = {
  root: Executor;
  queued: boolean;
  transact?: (fn: () => Promise<unknown>, bind: (executor: Executor, fn: () => Promise<unknown>) => Promise<unknown>) => Promise<unknown>;
};

export function createSql(options: SqlOptions): Sql {
  const scope = new AsyncLocalStorage<Executor>();
  let tail: Promise<void> = Promise.resolve();

  function current(): Executor {
    return scope.getStore() ?? options.root;
  }

  function gate<T>(task: () => Promise<T>): Promise<T> {
    if (scope.getStore() || !options.queued) return task();
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function bind(executor: Executor, fn: () => Promise<unknown>): Promise<unknown> {
    return scope.run(executor, fn);
  }

  async function defaultTransact(fn: () => Promise<unknown>): Promise<unknown> {
    await options.root.exec("BEGIN IMMEDIATE");
    try {
      const result = await bind(options.root, fn);
      await options.root.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await options.root.exec("ROLLBACK");
      } catch {
        // The transaction is already closed.
      }
      throw error;
    }
  }

  const transact = options.transact ?? defaultTransact;

  return {
    prepare(sql) {
      return {
        get: (...args) => gate(() => current().get(sql, args)),
        all: (...args) => gate(() => current().all(sql, args)),
        run: (...args) => gate(() => current().run(sql, args)),
      };
    },
    exec: (sql) => gate(() => current().exec(sql)),
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      return gate(() => transact(fn, bind)) as Promise<T>;
    },
  };
}
