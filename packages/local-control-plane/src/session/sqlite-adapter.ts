/**
 * SqlStorageAdapter — wraps better-sqlite3 to match the SqlStorage interface
 * used by SessionRepository and schema.ts from the original control plane.
 *
 * The SqlStorage interface is:
 *   exec(query: string, ...params: unknown[]): SqlResult
 *
 * SqlResult has:
 *   toArray(): unknown[]
 *   one(): unknown
 */

import Database from "better-sqlite3";

export interface SqlResult {
  toArray(): unknown[];
  one(): unknown;
}

export interface SqlStorage {
  exec(query: string, ...params: unknown[]): SqlResult;
}

export class SqlStorageAdapter implements SqlStorage {
  constructor(private db: Database.Database) {}

  exec(query: string, ...params: unknown[]): SqlResult {
    const trimmed = query.trimStart().toUpperCase();

    // SELECT queries return rows
    if (trimmed.startsWith("SELECT")) {
      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params);
      return {
        toArray: () => rows,
        one: () => rows[0] ?? null,
      };
    }

    // For compound statements (CREATE TABLE, etc.) that may contain multiple
    // statements separated by semicolons, use exec() for DDL
    if (
      trimmed.startsWith("CREATE") ||
      trimmed.startsWith("--") ||
      trimmed.startsWith("\n")
    ) {
      // DDL statements — may contain multiple statements
      // Replace bound parameters if any (DDL typically has none)
      if (params.length === 0) {
        this.db.exec(query);
      } else {
        this.db.prepare(query).run(...params);
      }
      return { toArray: () => [], one: () => null };
    }

    // INSERT, UPDATE, DELETE, ALTER, etc.
    try {
      const stmt = this.db.prepare(query);
      stmt.run(...params);
    } catch (e) {
      // Re-throw with context
      const msg = e instanceof Error ? e.message : String(e);
      // Let the caller handle "duplicate column" etc.
      throw new Error(msg);
    }
    return { toArray: () => [], one: () => null };
  }

  /** Get the underlying better-sqlite3 database for direct access if needed. */
  getDatabase(): Database.Database {
    return this.db;
  }
}
