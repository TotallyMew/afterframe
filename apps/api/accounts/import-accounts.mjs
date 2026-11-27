import { DatabaseSync } from 'node:sqlite';
import { openAccountStorage } from './account-storage.mjs';
import { ratingOnTen } from '@afterframe/shared/library';

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

function prepareRowParams(row, table, columns, legacyRatings) {
  if (legacyRatings && table === 'library' && row.kind === 'ratings') {
    row.value = JSON.stringify(ratingOnTen(JSON.parse(row.value)));
  }
  return columns.map(column => row[column]);
}

async function runBatchedInserts(insert, iterator, table, columns, legacyRatings, count = 0) {
  const batch = [];
  for (let i = 0; i < 200; i++) {
    const next = iterator.next();
    if (next.done) break;
    batch.push(prepareRowParams(next.value, table, columns, legacyRatings));
  }
  if (!batch.length) return count;
  await Promise.all(batch.map(params => insert.run(...params)));
  return runBatchedInserts(insert, iterator, table, columns, legacyRatings, count + batch.length);
}

async function importTable(source, target, tableExists, [table, columns, order], legacyRatings) {
  if (!tableExists.get(table)) return 0;
  const fields = columns.join(', ');
  const orderClause = order ? ` ORDER BY ${order}` : '';
  const select = source.prepare(`SELECT ${fields} FROM ${table}${orderClause}`);
  const insert = target.prepare(`INSERT INTO ${table} (${fields}) VALUES (${columns.map(() => '?').join(', ')})`);
  return runBatchedInserts(insert, select.iterate(), table, columns, legacyRatings);
}

async function importAllTables(source, target, tableExists, legacyRatings, index, counts) {
  if (index >= tables.length) return counts;
  const spec = tables[index];
  const rowCount = await importTable(source, target, tableExists, spec, legacyRatings);
  if (spec[0] === 'accounts') counts.accountCount += rowCount;
  if (spec[0] === 'library') counts.libraryCount += rowCount;
  return importAllTables(source, target, tableExists, legacyRatings, index + 1, counts);
}

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
    const counts = await importAllTables(source, target, tableExists, legacyRatings, 0, { accountCount: 0, libraryCount: 0 });
    await target.prepare("SELECT setval(pg_get_serial_sequence('accounts', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM accounts").run();
    return counts;
  });
  console.log(`Imported ${inserted.accountCount} accounts and ${inserted.libraryCount} library entries.`);
} catch (error) {
  console.error('Account import failed:', error.code || error.message);
  process.exitCode = 1;
} finally {
  source?.close();
  await target?.close();
}
