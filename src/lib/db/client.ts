import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = "data";
const DEFAULT_DB_PATH = path.join(DATA_DIR, "app.db");

type SqliteDatabase = InstanceType<typeof Database>;

let db: SqliteDatabase | null = null;

export function getDb(): SqliteDatabase {
  if (db) {
    return db;
  }

  // Ensure data directory exists before opening the SQLite file.
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(process.env.SQLITE_PATH ?? DEFAULT_DB_PATH);

  // Enable WAL and foreign keys for reliability and relational integrity.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Initialize schema on first open.
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_threads_created_at
      ON threads(created_at);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread_created_at
      ON messages(thread_id, created_at);
  `);

  return db;
}