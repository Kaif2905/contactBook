// Starts the API server:  npm run dev   (restarts on file changes)
//                         npm start     (normal start)
import { createApp } from './app.js';
import { config } from './config.js';
import { checkDatabaseConnection } from './db.js';
import { prepareUploadFolder, startCleanupTimer } from './services/uploadService.js';

// Background jobs (imports) run outside any request. Log unexpected problems
// instead of letting one bad file stop the whole server.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

await prepareUploadFolder();
startCleanupTimer();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\nContact Book API is running at http://localhost:${config.port}/api`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other program or change PORT in backend/.env.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

// Allow slow uploads of very large files (default would cut them off after 5 minutes)
server.requestTimeout = 30 * 60 * 1000;

try {
  const version = await checkDatabaseConnection();
  console.log(`Connected to MySQL ${version} (database "${config.db.database}")`);
} catch (error) {
  console.error(`\n*** Could not connect to MySQL: ${error.message}`);
  console.error('*** Check the DB_* settings in backend/.env and run "npm run db:setup".\n');
}
