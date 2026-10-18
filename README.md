# Advanced Contact Book

A full-stack contact manager built with **React + Bootstrap**, a **Node.js / Express** API, and **MySQL**.

Main features:

- Upload Excel files (50 MB and bigger), with column mapping and row-by-row validation. Errors are shown before anything is saved, and you can download them as an Excel error report.
- A contact list with search, filters, sorting and pagination, plus multi-select to delete or export many contacts at once.
- Contact details, editing and deleting. If someone else is already editing a contact, editing is locked for everyone else, and every change is recorded in a history.
- Export to Excel: all contacts, filtered contacts or selected contacts, with only the fields you choose.

---

## 1. Which database? (offline vs online)

**Use local (offline) MySQL 8.** It is free and fast for big imports, it has no storage or connection limits, and it works without internet.

The app reads every database setting from `backend/.env`. To use an online MySQL later, change `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` (and `DB_SSL=true` if your provider needs it). No code changes are needed (see section 7).

---

## 2. What you need to install

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 20 LTS or newer (22 LTS recommended) | https://nodejs.org |
| MySQL Community Server | 8.0.16 or newer (8.4 LTS recommended) | https://dev.mysql.com/downloads/mysql/ |
| MySQL Workbench (optional, to look at the data) | any | https://dev.mysql.com/downloads/workbench/ |

During the MySQL install on Windows, choose **"Use Strong Password Encryption"**, and **remember the root password** you type. You need it in step 3.

> Already have Docker? Instead of installing MySQL, run `docker compose up -d` in this folder.
> It starts MySQL 8.4 with the root password `contactbook123`.

Check that everything is installed:

```bash
node -v      # v20.x or higher
npm -v
mysql --version   # (or just open MySQL Workbench)
```

---

## 3. Backend setup (API on port 4000)

```bash
cd backend
copy .env.example .env        # Windows (Command Prompt)
# cp .env.example .env        # Mac / Linux / Git Bash
```

Open `backend/.env` and set **your** MySQL password:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password    # <- change this
DB_NAME=contact_book
```

Then:

```bash
npm install          # downloads the libraries (needs internet once)
npm run db:setup     # creates the "contact_book" database and its tables
npm run check        # checks Node, .env, MySQL login, database and tables - all lines should say OK
npm run dev          # starts the API
```

You should see:

```
Contact Book API is running at http://localhost:4000/api
Connected to MySQL 8.x (database "contact_book")
```

Open http://localhost:4000/api/health in the browser. It should say `"database": "connected"`.

---

## 4. Frontend setup (website on port 5173)

Open a **second** terminal (keep the backend running):

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The first time, the app asks for your name. It is shown to others when you edit a contact, and it is saved in the change history.

> To try the "someone else is editing" warning, open the app in two different browsers (or one normal and one private window) with two different names, then edit the same contact in both.

---

## 5. Run the tests

```bash
cd backend
npm test             # ALL tests: validation rules, import logic, API + MySQL, Excel upload/export
npm run test:unit    # only the tests that don't need MySQL
```

`npm test` uses a **separate** database, `contact_book_test`, which it creates and empties by itself, so your real contacts are never touched. MySQL must be running and `backend/.env` filled in.

See **TEST-SCENARIOS.md** for every requirement, its test scenarios, and which automated test covers it.

---

## 6. Try it with sample files

The `samples` folder has ready-made files:

| File | What it shows |
|------|---------------|
| `contacts-valid.xlsx` | 7 good contacts, all imported |
| `contacts-with-errors.xlsx` | 18 rows: 7 good, 11 with every kind of error (missing name/email/phone, bad email, bad phone, repeated email/phone, bad status) |
| `contacts-sample.csv` | CSV import |
| `contacts-custom-headers.xlsx` | Headers that can't be matched automatically, to try the column-mapping step |

**Large-file test (50 MB+):**

```bash
cd backend
npm run samples                # writes samples/contacts-large.xlsx (1,000,000 rows, about 65 MB)
npm run samples -- 200000      # or a smaller one
```

Upload it on the **Upload Contacts** page. The file is read in streaming mode (never fully in memory). Progress bars show reading, validating and saving. About 1 row in 500 is broken on purpose, so you also see the error list and the error report.

---

## 7. Using an online MySQL instead

1. Create a MySQL 8 database with any hosting provider and copy its host, port, user and password.
2. Put them in `backend/.env`, and set `DB_SSL=true` if the provider requires SSL.
3. Run `npm run db:setup` once, then `npm run dev`.

Large imports are slower online because every batch of rows travels over the internet.

---

## 8. One-server mode (optional)

```bash
cd frontend
npm run build        # creates frontend/dist
cd ../backend
npm start            # now http://localhost:4000 serves the website AND the API
```

---

## 9. Configuration reference

**backend/.env**

| Setting | Default | Meaning |
|---------|---------|---------|
| `PORT` | 4000 | API port |
| `CORS_ORIGIN` | http://localhost:5173 | Website address(es) allowed to call the API (comma separated, `*` = any) |
| `DB_HOST` / `DB_PORT` | 127.0.0.1 / 3306 | MySQL server |
| `DB_USER` / `DB_PASSWORD` | root / - | MySQL login |
| `DB_NAME` | contact_book | Database name |
| `DB_SSL` | false | `true` for online databases that need SSL |
| `MAX_UPLOAD_MB` | 100 | Largest file accepted |
| `IMPORT_BATCH_SIZE` | 1000 | Rows checked/saved per database round-trip |
| `EDIT_LOCK_SECONDS` | 90 | How long an edit lock lives without a heartbeat (closed tab) |

**frontend/.env** (optional, copy from `.env.example`)

| Setting | Default | Meaning |
|---------|---------|---------|
| `VITE_BACKEND_URL` | http://127.0.0.1:4000 | Where the dev server forwards `/api` calls |
| `VITE_API_URL` | (empty) | Only if the website and API are on different domains |
| `VITE_MAX_UPLOAD_MB` | 100 | Keep equal to `MAX_UPLOAD_MB` (instant size check in the browser) |

---

## 10. How it works (short version)

```
React (Vite)  --/api-->  Express API  ---->  MySQL
  Upload page             Excel Service       contacts (UNIQUE email, UNIQUE phone, CHECK formats)
  Contacts list           Contact Service     contact_history (change tracking)
  Detail / Edit           Upload Service      contact_edit_locks (who is editing)
  Export page             Lock Service
```

- **Shared validation rules**: `shared/contactRules.mjs` is used by both the browser (instant form errors) and the server (final check). The two can never disagree.
- **Big files**: the uploaded file goes to disk, is read row by row (streaming), and is processed in the background. The page polls for progress, so a 65 MB file never blocks the server or the browser.
- **.xlsx reading**: `services/xlsxReader.js` opens the .xlsx (a zip) through its table of contents and reads only the parts needed: the shared texts, the workbook (to find the first sheet), then the sheet row by row. This avoids a known problem in ExcelJS's one-pass streaming reader, which on slow disks (often Windows) can silently lose the text cells.
- **Validation before saving**: the "check" step runs every rule (required fields, email/phone format, repeats inside the file, duplicates already in the database) and lists every bad row. Only after you click **Import** are the good rows saved, 1,000 per INSERT.
- **Database safety net**: MySQL itself enforces unique email and phone, plus CHECK constraints on formats. Bad data is refused even if it bypasses the API.
- **Edit conflicts**: opening the Edit page takes a lock that is renewed every 30 s. Others see "X is editing" and cannot edit or delete. Each contact also has a `version`, so a save based on an old copy is refused instead of silently overwriting someone else's change.
- **Change tracking**: every update writes one history row per changed field (old value, new value, who, when).

### Project structure

```
contact-book/
├── shared/contactRules.mjs      validation + column-mapping rules (used by backend AND frontend)
├── backend/
│   ├── database/schema.sql     tables, unique keys, CHECK constraints
│   ├── scripts/                setup-db.js, make-large-file.js
│   ├── src/
│   │   ├── app.js / server.js  Express app and start-up
│   │   ├── routes/             contactRoutes.js, uploadRoutes.js
│   │   └── services/           contactService, excelService, xlsxReader, uploadService, importProcessor, lockService
│   └── tests/                  node:test test suites
├── frontend/src/
│   ├── components/contacts/    Contacts (list), ContactDetail, ContactEditor (add/edit), ContactForm
│   ├── components/upload/      Upload wizard (choose -> match columns -> review errors -> import)
│   ├── components/export/      Export page
│   └── services/               contactService.js, excelService.js, api.js
└── samples/                    example files
```

### API endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/contacts?page=&limit=&search=&name=&email=&group=&company=&status=&createdFrom=&createdTo=&sortBy=&sortOrder=` | Paginated list with search, filters and sorting |
| POST | `/api/contacts` | Create (validates, unique email + phone) |
| GET | `/api/contacts/:id` | One contact (+ who is editing it) |
| PUT | `/api/contacts/:id` | Update (needs `version`; records history) |
| DELETE | `/api/contacts/:id` | Delete one |
| POST | `/api/contacts/batch-delete` | Delete many `{ ids: [...] }` |
| GET | `/api/contacts/:id/history` | Change history |
| POST / DELETE | `/api/contacts/:id/lock` | Start / stop editing |
| GET | `/api/contacts/filter-options` | Values for the Group / Company filters |
| POST | `/api/contacts/export` | Excel export `{ fields, ids? , filters?, sortBy, sortOrder }` |
| GET | `/api/contacts/template` | Empty import template |
| POST | `/api/contacts/upload` | Receive an Excel/CSV file (multipart field `file`) |
| GET | `/api/contacts/upload/:id` | Upload status and progress |
| POST | `/api/contacts/upload/:id/validate` | Check every row with `{ mapping }` |
| GET | `/api/contacts/upload/:id/errors` | Invalid rows (paginated) |
| GET | `/api/contacts/upload/:id/error-report` | Invalid rows as an Excel download |
| POST | `/api/contacts/upload/:id/import` | Save the valid rows |
| DELETE | `/api/contacts/upload/:id` | Cancel an upload |
| GET | `/api/health` | Is the API and database OK? |

---

## 11. Troubleshooting

| Message | Fix |
|---------|-----|
| `MySQL refused the login` / `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` / `DB_PASSWORD` in `backend/.env` |
| `Cannot connect to MySQL` / `ECONNREFUSED` | MySQL is not running. Windows: open *Services* and start **MySQL80** (or **MySQL84**) |
| `The database does not exist yet` | Run `npm run db:setup` in `backend` |
| `Port 4000 is already in use` | Change `PORT` in `backend/.env` **and** `VITE_BACKEND_URL` in `frontend/.env` |
| Website shows `Cannot reach the server` | The backend is not running. Start it with `npm run dev` in `backend` |
| `npm install` fails on `cdn.sheetjs.com` (old `.xls` support library) | Your network blocks that site. Run `npm install xlsx@0.18.5` in `backend` instead; everything still works |
| PowerShell says `running scripts is disabled` | Use Command Prompt instead, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
