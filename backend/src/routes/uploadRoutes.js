// /api/contacts/upload/...  - Excel/CSV import routes.
//
//   POST   /api/contacts/upload                       receive the file (form field "file")
//                                                     add form field mode=import to validate AND save in one request
//   GET    /api/contacts/upload/:uploadId             status + progress (the browser polls this)
//   POST   /api/contacts/upload/:uploadId/validate    body: { mapping } -> check every row
//   GET    /api/contacts/upload/:uploadId/errors      rows with problems (paginated)
//   GET    /api/contacts/upload/:uploadId/error-report  same list as an Excel download
//   POST   /api/contacts/upload/:uploadId/import      save the valid rows
//   DELETE /api/contacts/upload/:uploadId             cancel and delete the upload
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { checkFileExtension, sendErrorReport } from '../services/excelService.js';
import {
  cancelUpload,
  createUpload,
  getUploadErrors,
  getUploadForReport,
  getUploadStatus,
  startImport,
  startValidation,
} from '../services/uploadService.js';

const router = Router();

// Multer saves the uploaded file straight to disk (never fully in memory)
const fileUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    try {
      checkFileExtension(file.originalname); // reject wrong types before saving anything
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  },
});

// Form fields: file (required), mode=import (optional, one-step), mapping (optional JSON, one-step only)
router.post('/', fileUpload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Please choose a file to upload (form field name: "file").');

  const importNow = req.body?.mode === 'import';
  let mapping = null;
  if (importNow && req.body?.mapping) {
    try {
      mapping = JSON.parse(req.body.mapping);
    } catch {
      throw new HttpError(400, '"mapping" must be JSON, for example {"name":0,"email":1,"phone":2}');
    }
  }
  res.status(201).json(await createUpload(req.file, { importNow, mapping }));
});

router.get('/:uploadId', (req, res) => {
  res.json(getUploadStatus(req.params.uploadId));
});

router.post('/:uploadId/validate', (req, res) => {
  res.json(startValidation(req.params.uploadId, req.body?.mapping ?? {}));
});

router.get('/:uploadId/errors', (req, res) => {
  res.json(getUploadErrors(req.params.uploadId, req.query));
});

router.get('/:uploadId/error-report', async (req, res) => {
  await sendErrorReport(res, getUploadForReport(req.params.uploadId));
});

router.post('/:uploadId/import', (req, res) => {
  res.json(startImport(req.params.uploadId));
});

router.delete('/:uploadId', async (req, res) => {
  await cancelUpload(req.params.uploadId);
  res.json({ message: 'Upload cancelled' });
});

export default router;
