import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Folders live outside the numbered migrations so this fork never claims an
// upstream migration id. Upstream builds ignore these tables.
export const ensureThreadFolderSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Sidebar folders are presentation, not thread history, so they are plain
  // rows rather than events. Membership lives on the folder.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_folders (
      folder_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_key INTEGER NOT NULL DEFAULT 0,
      rule_json TEXT,
      auto_file INTEGER NOT NULL DEFAULT 0,
      rule_set_at TEXT,
      pinned_at TEXT
    )
  `;
  // Added after the table shipped, so existing databases gain it in place.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(thread_folders)`;
  if (!columns.some((column) => column.name === "workspace_root")) {
    yield* sql`ALTER TABLE thread_folders ADD COLUMN workspace_root TEXT`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_folder_members (
      thread_id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL REFERENCES thread_folders (folder_id) ON DELETE CASCADE,
      added_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_folder_members_folder
    ON thread_folder_members (folder_id)
  `;
  // Threads a person or agent placed; auto-file never moves them.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_folder_explicit_moves (
      thread_id TEXT PRIMARY KEY
    )
  `;
});
