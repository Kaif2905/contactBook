// Creates the database (if it does not exist yet) and all tables from database/schema.sql.
// Used by "npm run db:setup" / "npm run db:reset" and by the automated tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from './config.js';

const schemaFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'schema.sql');

/** Creates the database (if needed) and all tables. resetTables = drop everything first. */
export async function setupDatabase({ resetTables = false, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  // Connect WITHOUT a database first, because it may not exist yet.
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
    multipleStatements: true,
  });

  try {
    const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
    log(`Connected to MySQL ${version} at ${config.db.host}:${config.db.port}`);
    warnAboutOldVersions(version, log);

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` DEFAULT CHARACTER SET utf8mb4`);
    await connection.query(`USE \`${config.db.database}\``);

    if (resetTables) {
      // Child tables first, because they point to `contacts`
      await connection.query('DROP TABLE IF EXISTS contact_edit_locks');
      await connection.query('DROP TABLE IF EXISTS contact_history');
      await connection.query('DROP TABLE IF EXISTS contacts');
      log('Old tables dropped.');
    }

    const schemaSql = await fs.readFile(schemaFile, 'utf8');
    await connection.query(schemaSql);
    log(`Database "${config.db.database}" is ready.`);
  } finally {
    await connection.end();
  }
}

function warnAboutOldVersions(version, log) {
  if (/mariadb/i.test(version)) {
    log('Note: this is MariaDB. The app should work, but it was written for MySQL 8.');
    return;
  }
  const [major, minor, patch] = version.split(/[.-]/).map(Number);
  const tooOld = major < 8 || (major === 8 && minor === 0 && patch < 16);
  if (tooOld) {
    log('WARNING: MySQL older than 8.0.16 ignores CHECK constraints. Please use MySQL 8.0.16 or newer.');
  }
}
