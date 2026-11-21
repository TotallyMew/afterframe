import { DatabaseSync } from 'node:sqlite';
import { openAccountStorage } from './account-storage.mjs';
import { ratingOnTen } from './public/library.js';

const file = process.argv[2];
if (!file || !process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL) {
  console.error('Provide a SQLite snapshot path and set AFTERFRAME_ACCOUNTS_DATABASE_URL to the empty PostgreSQL destination.');
  process.exit(1);
}

const tables = [
  ['accounts', ['id', 'username', 'salt', 'password_hash'], 'id'],
  ['library', ['account_id', 'kind', 'key', 'value'], 'rowid'],
  ['playback_versions', ['account_id', 'kind', 'key', 'updated']],
  ['recovery_codes', ['account_id', 'code_hash']],
  ['release_snapshots', ['series_id', 'value']],
];

let source;
let target;
try {
  source = new DatabaseSync(file, { readOnly: true });
  source.exec('BEGIN');
  const tableExists = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  if (!tableExists.get('accounts') || !tableExists.get('library')) throw new Error('The source is not an Afterframe account snapshot.');
  const legacyRatings = source.prepare('PRAGMA user_version').get().user_version < 1;
  target = await openAccountStorage();
  const inserted = await target.transaction(async () => {
    await target.prepare('LOCK TABLE accounts, release_snapshots IN EXCLUSIVE MODE').run();
    const occupied = await target.prepare('SELECT EXISTS (SELECT 1 FROM accounts UNION ALL SELECT 1 FROM release_snapshots) AS occupied').get();
    if (occupied.occupied) throw new Error('The destination already contains Afterframe account data.');
    let accountCount = 0;
    let libraryCount = 0;
    for (const [table, columns, order] of tables) {
      if (!tableExists.get(table)) continue;
      const fields = columns.join(', ');
      const select = source.prepare(`SELECT ${fields} FROM ${table}${order ? ` ORDER BY ${order}` : ''}`);
      const insert = target.prepare(`INSERT INTO ${table} (${fields}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of select.iterate()) {
        if (legacyRatings && table === 'library' && row.kind === 'ratings') {
          row.value = JSON.stringify(ratingOnTen(JSON.parse(row.value)));
        }
        await insert.run(...columns.map(column => row[column]));
        if (table === 'accounts') accountCount++;
        if (table === 'library') libraryCount++;
      }
    }
    await target.prepare("SELECT setval(pg_get_serial_sequence('accounts', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM accounts").run();
    return { accountCount, libraryCount };
  });
  console.log(`Imported ${inserted.accountCount} accounts and ${inserted.libraryCount} library entries.`);
} catch (error) {
  console.error('Account import failed:', error.code || error.message);
  process.exitCode = 1;
} finally {
  source?.close();
  await target?.close();
}
