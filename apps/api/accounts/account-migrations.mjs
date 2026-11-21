export function migrateAccounts(db) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 1) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`UPDATE library SET value = json_set(value, '$.score', json_extract(value, '$.score') * 2, '$.scale', 10)
        WHERE kind = 'ratings' AND json_extract(value, '$.scale') IS NULL;
      CREATE TABLE IF NOT EXISTS recovery_codes (
        account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS release_snapshots (series_id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playback_versions (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, key TEXT NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY (account_id, kind, key)
      );
      PRAGMA user_version = 1;`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
