/**
 * Local SQLite session index — replaces Cloudflare D1 SessionIndexStore.
 *
 * Uses better-sqlite3 for synchronous operations (no async needed locally).
 */

import Database from "better-sqlite3";

export interface SessionEntry {
  id: string;
  title: string | null;
  repoOwner: string;
  repoName: string;
  model: string;
  reasoningEffort: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ListSessionsOptions {
  status?: string;
  excludeStatus?: string;
  repoOwner?: string;
  repoName?: string;
  limit?: number;
  offset?: number;
}

export interface ListSessionsResult {
  sessions: SessionEntry[];
  total: number;
  hasMore: boolean;
}

export class LocalSessionIndexStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'anthropic/claude-haiku-4-5',
        reasoning_effort TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_updated
      ON sessions (updated_at DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status
      ON sessions (status)
    `);
  }

  create(session: SessionEntry): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sessions (id, title, repo_owner, repo_name, model, reasoning_effort, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.title,
        session.repoOwner.toLowerCase(),
        session.repoName.toLowerCase(),
        session.model,
        session.reasoningEffort,
        session.status,
        session.createdAt,
        session.updatedAt
      );
  }

  get(id: string): SessionEntry | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as any;
    return row ? this.toEntry(row) : null;
  }

  list(options: ListSessionsOptions = {}): ListSessionsResult {
    const {
      status,
      excludeStatus,
      repoOwner,
      repoName,
      limit = 50,
      offset = 0,
    } = options;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (excludeStatus) {
      conditions.push("status != ?");
      params.push(excludeStatus);
    }
    if (repoOwner) {
      conditions.push("repo_owner = ?");
      params.push(repoOwner.toLowerCase());
    }
    if (repoName) {
      conditions.push("repo_name = ?");
      params.push(repoName.toLowerCase());
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM sessions ${where}`)
      .get(...params) as { count: number };
    const total = countRow?.count ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM sessions ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    const sessions = rows.map((r: any) => this.toEntry(r));

    return {
      sessions,
      total,
      hasMore: offset + sessions.length < total,
    };
  }

  updateStatus(id: string, status: string): boolean {
    const result = this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id);
    return result.changes > 0;
  }

  touchUpdatedAt(id: string): boolean {
    const result = this.db
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM sessions WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  private toEntry(row: any): SessionEntry {
    return {
      id: row.id,
      title: row.title,
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
