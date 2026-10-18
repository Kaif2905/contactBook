// Builds the Express application: middleware, routes and error handling.
// (server.js starts it; the tests import it directly.)
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from './config.js';
import { checkDatabaseConnection } from './db.js';
import { HttpError } from './utils/httpError.js';
import contactRoutes from './routes/contactRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

// MySQL errors that mean "the database is not reachable / not set up"
const DATABASE_SETUP_ERRORS = {
  ECONNREFUSED: 'Cannot connect to MySQL. Is MySQL running? Check DB_HOST and DB_PORT in backend/.env.',
  ENOTFOUND: 'MySQL host not found. Check DB_HOST in backend/.env.',
  ETIMEDOUT: 'Connecting to MySQL timed out. Check DB_HOST/DB_PORT in backend/.env and your network.',
  ER_ACCESS_DENIED_ERROR: 'MySQL refused the login. Check DB_USER and DB_PASSWORD in backend/.env.',
  ER_BAD_DB_ERROR: 'The database does not exist yet. Run "npm run db:setup" in the backend folder.',
  ER_NO_SUCH_TABLE: 'The tables do not exist yet. Run "npm run db:setup" in the backend folder.',
  PROTOCOL_CONNECTION_LOST: 'The connection to MySQL was lost. Please try again.',
};

/** Who is calling? The browser sends a per-tab session id and the user's name. */
function identifyUser(req, res, next) {
  let name = req.get('X-User-Name') || '';
  try {
    name = decodeURIComponent(name); // the frontend encodes it so any language works
  } catch {
    // keep the raw value if it was not encoded
  }
  req.user = {
    sessionId: (req.get('X-Session-Id') || 'anonymous').slice(0, 64),
    name: name.trim().slice(0, 100) || 'Unknown user',
  };
  next();
}

/** Turns any error into a JSON answer like { "message": "...", "code": "..." }. */
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    // Something broke in the middle of a file download - we can only close the connection
    console.error('Error after the response started:', error);
    res.destroy();
    return;
  }

  let status = 500;
  let body = { message: 'Something went wrong on the server. Check the backend console for details.' };

  if (error instanceof HttpError) {
    status = error.status;
    body = { message: error.message, ...error.extra };
  } else if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    body = {
      message: error.code === 'LIMIT_FILE_SIZE' ? `The file is larger than the ${config.maxUploadMb} MB limit.` : error.message,
      code: error.code,
    };
  } else if (error.type === 'entity.too.large') {
    status = 413;
    body = { message: 'The request is too large.' };
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    body = { message: 'The request body is not valid JSON.' };
  } else if (/Unexpected end of form|Boundary not found|Malformed part header|Multipart/i.test(error.message || '')) {
    // The browser sent a broken or incomplete file upload
    status = 400;
    body = { message: 'The upload was incomplete. Please choose the file and try again.' };
  } else if (DATABASE_SETUP_ERRORS[error.code]) {
    status = 503;
    body = { message: DATABASE_SETUP_ERRORS[error.code], code: 'DATABASE_UNAVAILABLE' };
  }

  if (status >= 500) console.error(error);
  res.status(status).json(body);
}

/** If the React app has been built, serve it from the same server (handy for deployment). */
function serveFrontendIfBuilt(app) {
  const indexFile = path.join(config.frontendDistDir, 'index.html');
  if (!fs.existsSync(indexFile)) return;

  app.use(express.static(config.frontendDistDir));
  // Any other GET (like /contacts/12) gets index.html - React Router shows the right page
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(indexFile);
  });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  const allowAnyOrigin = config.corsOrigins.includes('*');
  app.use(cors({ origin: allowAnyOrigin ? true : config.corsOrigins, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '10mb' }));
  app.use(identifyUser);

  // Quick way to see if the API and the database are working
  app.get('/api/health', async (req, res) => {
    try {
      const mysqlVersion = await checkDatabaseConnection();
      res.json({ status: 'ok', database: 'connected', mysqlVersion });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        database: 'not connected',
        message: DATABASE_SETUP_ERRORS[error.code] || error.message,
      });
    }
  });

  app.use('/api/contacts/upload', uploadRoutes);
  app.use('/api/contacts', contactRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ message: `There is no API route for ${req.method} ${req.originalUrl}` });
  });

  serveFrontendIfBuilt(app);
  app.use(errorHandler);
  return app;
}
