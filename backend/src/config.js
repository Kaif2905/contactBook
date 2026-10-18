// All settings in one place. Values come from backend/.env (see .env.example).
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function numberSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: numberSetting('PORT', 4000),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: numberSetting('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'contact_book',
    ssl: process.env.DB_SSL === 'true',
  },

  maxUploadMb: numberSetting('MAX_UPLOAD_MB', 100),
  importBatchSize: numberSetting('IMPORT_BATCH_SIZE', 1000),
  editLockSeconds: numberSetting('EDIT_LOCK_SECONDS', 90),

  // Uploaded files wait here until they are imported (then they are deleted).
  uploadDir: path.join(backendDir, 'uploads'),
  // Upload sessions (and their error lists) are forgotten after this long.
  uploadExpiryMinutes: 60,

  // If the React app has been built (frontend/dist), the API serves it too.
  frontendDistDir: path.resolve(backendDir, '..', 'frontend', 'dist'),
};
