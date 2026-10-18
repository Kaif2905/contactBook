// MySQL connection pool. Every service imports `pool` from here.
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
  connectionLimit: 10,
  waitForConnections: true,
  // Store and read every date in UTC, so times are correct whether MySQL
  // runs on your laptop or on a server in another time zone.
  timezone: 'Z',
});

// Each new connection uses UTC for NOW() and TIMESTAMP columns.
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

/** Runs `work(connection)` inside a transaction. Rolls back if anything throws. */
export async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {}); // keep the original error
    throw error;
  } finally {
    connection.release();
  }
}

/** Quick check used at start-up so connection problems are reported clearly. */
export async function checkDatabaseConnection() {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  return rows[0].version;
}
