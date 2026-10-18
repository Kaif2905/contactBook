// Imported FIRST by the API tests, before any app code reads its settings.
// The tests use their own database so your real contacts are never touched.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'contact_book_test';
process.env.EDIT_LOCK_SECONDS = '2'; // short locks so the "lock expires" test is quick
process.env.MAX_UPLOAD_MB = '5'; // small limit so the "file too large" test is quick
process.env.IMPORT_BATCH_SIZE = '500';
