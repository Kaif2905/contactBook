# Test Scenarios - Advanced Contact Book

Every requirement from the assignment is listed below, with how it was implemented and which tests prove it.

**Automated tests** live in `backend/tests/` and run with `npm test` (in `backend`). They use their own database, `contact_book_test`.

| Suite | What it covers | Needs MySQL |
|-------|----------------|-------------|
| `rules.test.js` | Validation rules (required fields, email, phone, status, lengths) and column auto-mapping | No |
| `importProcessor.test.js` | Import logic: every error type, repeats in a file, duplicates in the database, batching, cancelling, race conditions | No |
| `xlsxReader.test.js` | .xlsx reading: text, numbers, links, formulas, rich text, empty rows, first sheet only, 5,000 rows with progress, stopping early, damaged file | No |
| `api.test.js` | Every contact endpoint against real MySQL: CRUD, uniqueness, search, filters, sort, pagination, locks, change history, batch delete, export, database constraints | Yes |
| `upload.test.js` | File upload end-to-end: format checks, size limit, mapping, validation, error list and report, import, .xlsx / .xls / .csv, 20,000-row file | Yes |

**UI flows**: the 20 browser scenarios in the "UI" column were clicked through in headless Chrome during development. They are also written as manual steps below, so you can repeat them yourself.

Legend: ✅ automated test · 🖱 UI scenario (manual steps given)

---

## 1. Upload Component

| ID | Scenario | Steps | Expected result | Covered by |
|----|----------|-------|-----------------|------------|
| UP-01 | Upload a valid .xlsx | Upload Contacts → choose `samples/contacts-valid.xlsx` → **Upload & Validate** | "Validation Passed - All 7 rows are valid". **Import 7 valid contacts** saves them | ✅ upload: *saves only the valid rows* · 🖱 |
| UP-02 | Large file (50 MB+) | `npm run samples` → upload `samples/contacts-large.xlsx` (~65 MB, 1M rows) | Upload, reading, validating and saving progress bars move. The browser stays responsive. a few thousand rows with errors are listed; the rest import | ✅ upload: *imports 20,000 rows in batches* (scaled-down) · manual |
| UP-03 | Wrong file type | Choose a `.pdf` / `.txt` / `.docx` | "Only Excel (.xlsx, .xls) and CSV (.csv) files can be uploaded." **Upload** stays disabled | ✅ upload: *rejects other file types* · 🖱 |
| UP-04 | Fake Excel (renamed text file) | Rename a .txt to .xlsx and choose it | "This is not a real Excel file…" (checked in the browser AND on the server) | ✅ upload: *rejects a text file renamed to .xlsx / .xls* · 🖱 |
| UP-05 | Empty file | Choose a 0-byte .csv | "The file is empty." | ✅ upload: *rejects an empty file* · 🖱 |
| UP-06 | File over the size limit | Upload a file bigger than `MAX_UPLOAD_MB` | "The file is larger than the 100 MB limit." (HTTP 413) | ✅ upload: *rejects a file over the size limit* |
| UP-07 | Damaged .xlsx | Upload a corrupted workbook | "Could not read this file…" / "empty or damaged" | ✅ upload: *reports a damaged .xlsx file* |
| UP-08 | Header row but no data | Upload a sheet with only headers | "The file has a header row but no contact rows below it." | ✅ upload: *reports a file with headers but no rows* |
| UP-09 | Old .xls format | Upload a .xls | Read and imported like .xlsx | ✅ upload: *imports an old .xls file* |
| UP-10 | CSV with BOM, quotes, commas | Upload `samples/contacts-sample.csv` | Values like `"Rao, Asha"` stay in one cell | ✅ upload: *imports a CSV file…* |
| UP-11 | Links, formulas and numbers in cells | Email typed as a hyperlink, phone stored as a number | Read as plain text: `9876543210`, `link@example.com` | ✅ upload: *reads links, formulas and number cells as text* |
| UP-12 | Cancel an upload | Click **Cancel** during any step | Upload is thrown away on the server (404 afterwards) | ✅ upload: *cancels an upload* · 🖱 |

## 2. Data validation rules (before anything is saved)

| ID | Scenario | Expected result | Covered by |
|----|----------|-----------------|------------|
| VA-01 | Missing **Name** | Row rejected: "Name is required" | ✅ rules, importProcessor, upload |
| VA-02 | Missing **Email** | Row rejected: "Email is required" | ✅ rules, upload |
| VA-03 | Missing **Phone Number** | Row rejected: "Phone Number is required" | ✅ rules, upload |
| VA-04 | All three missing | One row, three messages | ✅ importProcessor: *reports several problems on the same row* |
| VA-05 | Invalid emails: `invalid-email`, `user@domain`, `a@b.c`, `two@@at.com`, `double..dot@x.com`, `space in@x.com` … | "Email format is invalid" | ✅ rules (13 bad + 6 good examples) |
| VA-06 | Invalid phones: `12345`, `98765abcde`, 16+ digits, `++91…` | "Phone Number format is invalid" | ✅ rules (8 bad + 7 good examples) |
| VA-07 | Phone formats people type: `+91 98765-43210`, `(022) 2345-6789`, `022.2345.6789` | Accepted and stored cleaned (`+919876543210`) | ✅ rules, api |
| VA-08 | Same email twice in one file (any letter case) | 2nd row rejected: "Email is repeated in this file (first used on row N)" | ✅ importProcessor, upload |
| VA-09 | Same phone twice in one file (different formatting) | 2nd row rejected: "Phone Number is repeated in this file…" | ✅ importProcessor |
| VA-10 | Email/phone that already exists in the database | Row rejected: "Email already exists in contacts" | ✅ importProcessor, upload: *flags rows that already exist* |
| VA-11 | Status other than Active/Inactive | "Status must be Active or Inactive"; empty → Active; `inactive` → Inactive | ✅ rules, upload: *rejects rows with an unknown status* |
| VA-12 | Too-long values (name > 100, notes > 1000) | "…must be N characters or less" | ✅ rules |
| VA-13 | **Errors shown before saving** | Upload `samples/contacts-with-errors.xlsx` | Red "Validation Failed - 11 rows have errors", a table of Row No./Name/Email/Phone/Error Message, and **nothing saved** until Import | ✅ upload: *lists every invalid row*, *does not save anything while checking*, *will not import before checking* · 🖱 |
| VA-14 | Blank rows | Skipped quietly (not counted as errors) | ✅ importProcessor |

**Expected result for `contacts-with-errors.xlsx`:** 18 rows → 7 valid, 11 invalid (rows 4, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19).

## 3. Excel Service - import with field mapping and error report

| ID | Scenario | Steps | Expected result | Covered by |
|----|----------|-------|-----------------|------------|
| EX-01 | Automatic mapping | Upload a file with headers like "Full Name", "E-mail", "Mobile No" | Columns recognised; validation starts straight away | ✅ rules: *suggests columns*, upload: *finds the headers and guesses the mapping* · 🖱 |
| EX-02 | Manual mapping | Upload `samples/contacts-custom-headers.xlsx` | "Match columns" screen with an example value per column. **Validate rows** is disabled until Name, Email and Phone are chosen | ✅ upload: *refuses a mapping without the required fields* · 🖱 |
| EX-03 | Same column chosen twice | Map Name and Email to the same column | "The same column is used for…" | ✅ rules · 🖱 |
| EX-04 | Change mapping after reviewing | Review → **Change column matching** → change → validate again | New results | 🖱 |
| EX-05 | Downloadable error report | Review step → **Download Error Report (Excel)** | `<file>-errors.xlsx` with Row Number, original values and Problems | ✅ upload: *offers the invalid rows as a downloadable Excel report* · 🖱 |
| EX-06 | Error list paging | 25+ bad rows | Error table pages through all of them | ✅ upload: *pages through the error list* |
| EX-07 | Import twice | Upload the same file again after importing | Every row reported as already existing; nothing to import | ✅ upload: *uploading the same file again finds only duplicates* |
| EX-08 | Someone adds a contact during the import | (race condition) | That row is reported, all others are saved | ✅ importProcessor: *handles a contact that someone else saved during the import* |

## 4. Excel Service - export

| ID | Scenario | Steps | Expected result | Covered by |
|----|----------|-------|-----------------|------------|
| EP-01 | Export all contacts, all fields | Export page → **Select All** → **Export to Excel** | `contacts-YYYY-MM-DD.xlsx` with every contact | ✅ api: *exports all contacts with all fields* · 🖱 |
| EP-02 | Choose fields | Tick only Name, Email, Phone | File has exactly those 3 columns | ✅ api: *exports only the chosen fields* · 🖱 |
| EP-03 | Filtered export | Set Name / Group / Status / date range | Only matching contacts; "N contacts match these filters" shown | ✅ api: *exports contacts filtered by name, group, status and date* · 🖱 |
| EP-04 | Export selected (batch) | List → tick contacts → **Export Selected** | Only the ticked contacts | ✅ api: *exports only the selected contacts* · 🖱 |
| EP-05 | No field chosen / unknown field | Untick everything | Button disabled (UI); API answers 400 | ✅ api: *rejects unknown or empty field lists* · 🖱 |
| EP-06 | Import template | Upload page → **Download a sample template** | Excel with the right headers and 2 example rows | ✅ api: *offers an import template* |

## 5. Contacts Component (list)

| ID | Scenario | Expected result | Covered by |
|----|----------|-----------------|------------|
| CL-01 | Pagination | 10 per page; page 2 works; "Show 5/10/25/50/100 entries"; "#" keeps counting across pages | ✅ api: *returns the first page…*, *last page*, *page after the end*, *never more than 100* · 🖱 |
| CL-02 | Search | By name, email or phone (spaces in phone OK); `%` treated literally | ✅ api (4 tests) · 🖱 |
| CL-03 | Filters | Group, Status (and company) - combined with search | ✅ api: *filters by group, company and status*, *filters by status*, *combines search with filters* · 🖱 |
| CL-04 | Sorting | Click a column header; click again to reverse | ✅ api: *sorts by name both ways*, *ignores an unknown sort column* · 🖱 |
| CL-05 | View / Edit / Delete buttons | Eye opens details, pencil opens Edit, bin asks for confirmation | 🖱 |
| CL-06 | Multi-select | Tick rows (kept across pages); header box selects the whole page | 🖱 |
| CL-07 | Batch delete with confirmation | "Delete N contacts?" → confirm → deleted | ✅ api: *batch-deletes…* · 🖱 |
| CL-08 | Batch delete while someone edits one | That contact is skipped and reported; the others are deleted | ✅ api: *batch-deletes, skipping contacts someone else is editing* · 🖱 |
| CL-09 | "X editing" badge | A contact being edited shows a yellow badge; its Edit/Delete buttons are disabled | ✅ api: *shows the other person who is editing* · 🖱 |
| CL-10 | Empty states | "No contacts yet" / "No contacts match your search" | 🖱 |
| CL-11 | Back button keeps your place | Open a contact from page 2 with a search → Back | Same page, search and filters | 🖱 |

## 6. Contact Detail Component and editing

| ID | Scenario | Expected result | Covered by |
|----|----------|-----------------|------------|
| CD-01 | Detail view | Avatar initials, Active/Inactive badge, Email, Phone, Group, Company, Address, Notes, Created At, Updated At | ✅ api: *returns one contact* · 🖱 |
| CD-02 | Unknown / deleted contact | "Contact not found" | ✅ api: *answers 404*, *answers 400 for an id that is not a number* · 🖱 |
| CD-03 | Edit and save | Update → "Contact updated", values and version change | ✅ api: *updates, bumps the version…* · 🖱 |
| CD-04 | Form validation on edit/add | Missing / invalid fields show messages under each field; nothing is sent | ✅ api: *validates the new values* · 🖱 |
| CD-05 | **Another user is editing** | Banner "This contact is currently being edited by another user (name)"; form and **Update** disabled; Edit/Delete disabled on the detail page | ✅ api: *lets only one person edit at a time* · 🖱 |
| CD-06 | The other user finishes | Edit page unlocks by itself within 10 s | ✅ api: *frees the contact when the editor releases the lock* · 🖱 |
| CD-07 | The other user closes the tab | The lock expires (90 s) and editing is allowed again | ✅ api: *a lock expires if the editor disappears* |
| CD-08 | Others cannot save or delete while locked | 409 "X is editing this contact right now" | ✅ api: *blocks saving and deleting by others while locked* |
| CD-09 | Stale copy (lost-update protection) | Saving an old version → "Someone else saved changes…" with **Load the latest version** | ✅ api: *refuses to overwrite changes someone else saved first* · 🖱 |
| CD-10 | Cancel releases the lock | After Cancel, others can edit immediately | ✅ api: *frees the contact…* · 🖱 |
| CD-11 | Delete from details | Confirmation → deleted → back to the list | ✅ api: *deletes one contact (and its history)* · 🖱 |
| CD-12 | Delete twice | 404 | ✅ api: *answers 404 when deleting a contact twice* |

## 7. Contact Service (CRUD) and change tracking

| ID | Scenario | Expected result | Covered by |
|----|----------|-----------------|------------|
| CS-01 | Create | 201; email stored lower-case, phone cleaned, status defaults to Active | ✅ api: *creates a contact…* · 🖱 |
| CS-02 | Unique email (any case) | 409 "Another contact already uses this email" under the Email field | ✅ api: *rejects a duplicate email* · 🖱 |
| CS-03 | Unique phone (any formatting) | 409 under the Phone field | ✅ api: *rejects a duplicate phone…* |
| CS-04 | Unique on update | Changing to another contact's email → 409 | ✅ api: *refuses an email that another contact already uses* |
| CS-05 | Read with filters (name, email) | `?name=` / `?email=` partial match | ✅ api: *filters by name and email fields separately* |
| CS-06 | Change tracking | Each changed field saved with old value, new value, who, when and version; shown under "Change history" | ✅ api: *updates, bumps the version and records what changed* · 🖱 |
| CS-07 | Save without changes | Nothing written, version unchanged | ✅ api: *does nothing (and keeps the version)…* |
| CS-08 | Bad requests | Broken JSON → 400; unknown route → 404 JSON; missing version → 400 | ✅ api (3 tests) |

## 8. Database (MySQL) constraints

| ID | Scenario | Expected result | Covered by |
|----|----------|-----------------|------------|
| DB-01 | Duplicate email inserted directly with SQL | MySQL refuses (`ER_DUP_ENTRY`) | ✅ api: *MySQL itself refuses a duplicate email* |
| DB-02 | Duplicate phone inserted directly with SQL | MySQL refuses | ✅ api: *MySQL itself refuses a duplicate phone* |
| DB-03 | Bad phone / email / empty name inserted with SQL | MySQL refuses (`ER_CHECK_CONSTRAINT_VIOLATED`) | ✅ api: *MySQL itself refuses a badly formatted phone, email or empty name* |
| DB-04 | Deleting a contact | Its history and lock rows are removed too (`ON DELETE CASCADE`) | ✅ api: *deletes one contact (and its history)* |

## 9. Styling and UI

| ID | Check | Expected result |
|----|-------|-----------------|
| UI-01 | Bootstrap 5 + Bootstrap Icons throughout | Consistent buttons, forms, tables, badges, modals, toasts |
| UI-02 | Layout | Dark sidebar (Contacts, Upload Contacts, Export) that turns into a top bar on small screens |
| UI-03 | Feedback | Toast messages for every action, spinners while loading, progress bars for uploads |
