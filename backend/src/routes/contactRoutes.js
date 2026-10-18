// /api/contacts/...  - HTTP routes for contacts. Each route just reads the
// request, calls the right service function and sends the answer back.
// (Express 5 passes errors from async routes to the error handler automatically.)
import { Router } from 'express';
import { HttpError, parseId } from '../utils/httpError.js';
import {
  createContact,
  deleteContact,
  deleteContacts,
  getContact,
  getContactHistory,
  getFilterOptions,
  listContacts,
  updateContact,
} from '../services/contactService.js';
import { acquireLock, releaseLock } from '../services/lockService.js';
import { exportContacts, sendTemplate } from '../services/excelService.js';

const router = Router();
const MAX_EXPORT_IDS = 100000;

// GET /api/contacts?page=1&limit=10&search=&group=&status=&sortBy=name&sortOrder=asc
router.get('/', async (req, res) => {
  res.json(await listContacts(req.query, req.user));
});

// POST /api/contacts  - add one contact
router.post('/', async (req, res) => {
  const contact = await createContact(req.body ?? {});
  res.status(201).json(contact);
});

// GET /api/contacts/filter-options  - values for the filter dropdowns
router.get('/filter-options', async (req, res) => {
  res.json(await getFilterOptions());
});

// GET /api/contacts/template  - empty Excel template to fill in
router.get('/template', async (req, res) => {
  await sendTemplate(res);
});

// POST /api/contacts/export  - download contacts as Excel
// body: { fields: ['name','email'], ids?: [1,2], filters?: {...}, sortBy?, sortOrder?, timeZone? }
router.post('/export', async (req, res) => {
  const { fields, ids, filters, sortBy, sortOrder, timeZone } = req.body ?? {};
  if (ids !== undefined && ids !== null) {
    if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, '"ids" must be a non-empty list');
    if (ids.length > MAX_EXPORT_IDS) throw new HttpError(400, `You can export at most ${MAX_EXPORT_IDS} selected contacts`);
    if (ids.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) throw new HttpError(400, 'Every id must be a positive whole number');
  }
  await exportContacts(res, {
    fields,
    ids: ids ? ids.map(Number) : null,
    filters: filters ?? {},
    sortBy,
    sortOrder,
    timeZone,
  });
});

// POST /api/contacts/batch-delete  body: { ids: [1, 2, 3] }
router.post('/batch-delete', async (req, res) => {
  const result = await deleteContacts(req.body?.ids, req.user);
  res.json(result);
});

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
  res.json(await getContact(parseId(req.params.id), req.user));
});

// PUT /api/contacts/:id  body: { name, email, phone, ..., version }
router.put('/:id', async (req, res) => {
  res.json(await updateContact(parseId(req.params.id), req.body ?? {}, req.user));
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  await deleteContact(parseId(req.params.id), req.user);
  res.json({ message: 'Contact deleted' });
});

// GET /api/contacts/:id/history  - change tracking
router.get('/:id/history', async (req, res) => {
  res.json(await getContactHistory(parseId(req.params.id)));
});

// POST /api/contacts/:id/lock  - start editing (or keep the lock alive)
router.post('/:id/lock', async (req, res) => {
  res.json(await acquireLock(parseId(req.params.id), req.user));
});

// DELETE /api/contacts/:id/lock  - stop editing
router.delete('/:id/lock', async (req, res) => {
  await releaseLock(parseId(req.params.id), req.user);
  res.json({ message: 'Lock released' });
});

export default router;
