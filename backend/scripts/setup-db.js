// Creates the database and tables.
//
//   npm run db:setup   -> create database + tables (safe to run again, keeps data)
//   npm run db:reset   -> DELETE all tables and data, then create them again
import { setupDatabase } from '../src/setupDatabase.js';

const reset = process.argv.includes('--reset');

try {
  await setupDatabase({ resetTables: reset });
  process.exit(0);
} catch (error) {
  console.error(`\nDatabase setup failed: ${error.message}`);
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('-> Check DB_USER and DB_PASSWORD in backend/.env');
  } else if (error.code === 'ECONNREFUSED') {
    console.error('-> MySQL is not running, or DB_HOST/DB_PORT in backend/.env are wrong');
  }
  process.exit(1);
}
