import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  added_by      TEXT NOT NULL,
  PRIMARY KEY (department_id, username)
);
CREATE TABLE IF NOT EXISTS users (
  username     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  username TEXT NOT NULL,
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL
);
`;

export type Department = {
  id: number; name: string; slug: string; created_at: string; created_by: string; member_count?: number;
};
export type Member = {
  username: string; added_at: string; added_by: string; display_name: string | null; last_seen: string | null;
};
export type UserRow = {
  username: string; display_name: string; email: string; first_seen: string; last_seen: string;
};
export type AuditRow = { id: number; ts: string; username: string; action: string; detail: string };

type Params = (string | number | null)[];
const plain = <T>(rows: unknown[]): T[] => rows.map((r) => ({ ...(r as object) }) as T);

export class Db {
  readonly conn: DatabaseSync;

  constructor(file: string) {
    this.conn = new DatabaseSync(file);
    this.conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
    this.conn.exec(SCHEMA);
  }

  static now(): string {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  all<T>(sql: string, ...params: Params): T[] {
    return plain<T>(this.conn.prepare(sql).all(...params));
  }
  get<T>(sql: string, ...params: Params): T | undefined {
    const row = this.conn.prepare(sql).get(...params);
    return row ? ({ ...(row as object) } as T) : undefined;
  }
  run(sql: string, ...params: Params): { changes: number; lastId: number } {
    const r = this.conn.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  /** All-or-nothing group of writes. */
  tx<T>(fn: () => T): T {
    this.conn.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.conn.exec("COMMIT");
      return out;
    } catch (err) {
      this.conn.exec("ROLLBACK");
      throw err;
    }
  }

  log(username: string, action: string, detail = ""): void {
    this.run("INSERT INTO audit (ts, username, action, detail) VALUES (?, ?, ?, ?)",
      Db.now(), username, action, detail);
  }

  touchUser(username: string, displayName: string, email: string): void {
    const stamp = Db.now();
    this.run(
      `INSERT INTO users (username, display_name, email, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name,
         email = excluded.email, last_seen = excluded.last_seen`,
      username, displayName, email, stamp, stamp);
  }

  knownUsers(): UserRow[] {
    return this.all("SELECT * FROM users ORDER BY lower(display_name), username");
  }
  departments(): Department[] {
    return this.all(
      `SELECT d.*, (SELECT COUNT(*) FROM members m WHERE m.department_id = d.id) AS member_count
       FROM departments d ORDER BY lower(d.name)`);
  }
  department(id: number): Department | undefined {
    return this.get("SELECT * FROM departments WHERE id = ?", id);
  }
  departmentBySlug(slug: string): Department | undefined {
    return this.get("SELECT * FROM departments WHERE slug = ?", slug);
  }
  members(deptId: number): Member[] {
    return this.all(
      `SELECT m.username, m.added_at, m.added_by, u.display_name, u.last_seen
       FROM members m LEFT JOIN users u ON u.username = m.username
       WHERE m.department_id = ? ORDER BY m.username`, deptId);
  }
  departmentsForUser(username: string): Department[] {
    return this.all(
      `SELECT d.* FROM departments d JOIN members m ON m.department_id = d.id
       WHERE m.username = ? ORDER BY lower(d.name)`, username);
  }
  auditRecent(limit = 200): AuditRow[] {
    return this.all("SELECT * FROM audit ORDER BY id DESC LIMIT ?", limit);
  }
  close(): void {
    this.conn.close();
  }
}
