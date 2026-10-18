// Checks that everything is ready before you start the API:   npm run check
// Prints a clear OK / PROBLEM line for each step and what to do about it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;

function ok(message) {
  console.log(`  OK       ${message}`);
}
function problem(message, fix) {
  problems += 1;
  console.log(`  PROBLEM  ${message}`);
  console.log(`           -> ${fix}`);
}

console.log('\nChecking your setup...\n');

// 1. Node.js version
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 10)) ok(`Node.js ${process.versions.node}`);
else problem(`Node.js ${process.versions.node} is too old`, 'Install Node.js 20 LTS or newer from https://nodejs.org');

// 2. Libraries installed
if (fs.existsSync(path.join(backendDir, 'node_modules', 'express'))) ok('Libraries installed (node_modules)');
else problem('Libraries are not installed', 'Run "npm install" in the backend folder');

// 3. .env file
const envFile = path.join(backendDir, '.env');
if (!fs.existsSync(envFile)) {
  problem('backend/.env is missing', 'Run "copy .env.example .env" (Windows) or "cp .env.example .env", then put your MySQL password in it');
} else {
  ok('backend/.env found');
  const envText = fs.readFileSync(envFile, 'utf8');
  if (/^DB_PASSWORD=your_mysql_password\s*$/m.test(envText)) {
    problem('DB_PASSWORD in backend/.env is still the example value', 'Open backend/.env and set DB_PASSWORD to your real MySQL root password');
  }
}

// 4. MySQL connection, database and tables
if (problems === 0) {
  const { config } = await import('../src/config.js');
  const { default: mysql } = await import('mysql2/promise');
  try {
    const connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
    });
    const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
    ok(`Connected to MySQL ${version} at ${config.db.host}:${config.db.port}`);

    const [databases] = await connection.query('SHOW DATABASES LIKE ?', [config.db.database]);
    if (databases.length === 0) {
      problem(`Database "${config.db.database}" does not exist yet`, 'Run "npm run db:setup"');
    } else {
      const [tables] = await connection.query(
        'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
        [config.db.database],
      );
      const names = tables.map((table) => String(table.name || table.NAME || table.TABLE_NAME).toLowerCase());
      const missing = ['contacts', 'contact_history', 'contact_edit_locks'].filter((name) => !names.includes(name));
      if (missing.length === 0) ok(`Database "${config.db.database}" and its tables are ready`);
      else problem(`Missing tables: ${missing.join(', ')}`, 'Run "npm run db:setup"');
    }
    await connection.end();
  } catch (error) {
    const fixes = {
      ER_ACCESS_DENIED_ERROR: 'Wrong DB_USER or DB_PASSWORD in backend/.env',
      ECONNREFUSED: 'MySQL is not running (Windows: open "Services" and start MySQL80 / MySQL84), or DB_HOST/DB_PORT are wrong',
      ENOTFOUND: 'DB_HOST in backend/.env is wrong',
      ETIMEDOUT: 'Cannot reach DB_HOST - check the address and your network',
    };
    problem(`Cannot connect to MySQL: ${error.message}`, fixes[error.code] || 'Check the DB_* settings in backend/.env');
  }
}

console.log(problems === 0 ? '\nAll good! Start the API with:  npm run dev\n' : `\n${problems} problem(s) found - fix them and run "npm run check" again.\n`);
process.exit(problems === 0 ? 0 : 1);
