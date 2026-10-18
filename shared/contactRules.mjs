export const CONTACT_FIELDS = [
  { key: 'name', label: 'Name', required: true, maxLength: 100 },
  { key: 'email', label: 'Email', required: true, maxLength: 254 },
  { key: 'phone', label: 'Phone Number', required: true, maxLength: 30 },
  { key: 'group', label: 'Group', required: false, maxLength: 50 },
  { key: 'company', label: 'Company', required: false, maxLength: 100 },
  { key: 'address', label: 'Address', required: false, maxLength: 255 },
  { key: 'notes', label: 'Notes', required: false, maxLength: 1000 },
  { key: 'status', label: 'Status', required: false, maxLength: 10 },
];

export const STATUSES = ['Active', 'Inactive'];

export const SUGGESTED_GROUPS = ['Friends', 'Family', 'Work', 'Clients', 'Vendors'];

export const REQUIRED_FIELDS = CONTACT_FIELDS.filter((field) => field.required).map((field) => field.key);

// Fields the user can pick when exporting to Excel.
export const EXPORT_FIELDS = [
  ...CONTACT_FIELDS.map(({ key, label }) => ({ key, label })),
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },
];


const EMAIL_PATTERN = /^[A-Za-z0-9_%+'-]+(\.[A-Za-z0-9_%+'-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}


export function normalizePhone(phone) {
  return toText(phone).replace(/[\s().-]/g, '');
}

export function isValidEmail(email) {
  return EMAIL_PATTERN.test(toText(email));
}

export function isValidPhone(phone) {
  return PHONE_PATTERN.test(normalizePhone(phone));
}


export function validateContact(input = {}) {
  const value = {};
  const errors = {};

  for (const field of CONTACT_FIELDS) {
    const text = toText(input[field.key]);

    if (text === '') {
      if (field.required) errors[field.key] = `${field.label} is required`;
      value[field.key] = field.required ? '' : null;
      continue;
    }

    if (text.length > field.maxLength) {
      errors[field.key] = `${field.label} must be ${field.maxLength} characters or less`;
    }
    value[field.key] = text;
  }

  if (value.email && !errors.email) {
    value.email = value.email.toLowerCase();
    if (!EMAIL_PATTERN.test(value.email)) {
      errors.email = 'Email format is invalid (example: name@company.com)';
    }
  }

  if (value.phone && !errors.phone) {
    const phone = normalizePhone(value.phone);
    if (PHONE_PATTERN.test(phone)) {
      value.phone = phone;
    } else {
      errors.phone = 'Phone Number format is invalid (use 7-15 digits, optional + at the start)';
    }
  }

  // Status: "active", "ACTIVE", "Inactive"... -> "Active" / "Inactive". Empty -> "Active".
  if (!errors.status) {
    const status = STATUSES.find((option) => option.toLowerCase() === (value.status || 'active').toLowerCase());
    if (status) value.status = status;
    else errors.status = 'Status must be Active or Inactive';
  }

  return { value, errors, isValid: Object.keys(errors).length === 0 };
}

// ---------------------------------------------------------------------------
// Column mapping helpers (used when importing Excel files)
// ---------------------------------------------------------------------------

// Common header names people use for each field.
const HEADER_SYNONYMS = {
  name: ['name', 'full name', 'fullname', 'contact name', 'customer name', 'person name'],
  email: ['email', 'e mail', 'email address', 'e mail address', 'mail', 'email id', 'mail id'],
  phone: [
    'phone', 'phone number', 'phone no', 'phone num', 'mobile', 'mobile number', 'mobile no',
    'contact number', 'contact no', 'telephone', 'tel', 'cell', 'cell phone', 'phonenumber',
  ],
  group: ['group', 'contact group', 'category', 'type', 'tag', 'label'],
  company: ['company', 'company name', 'organization', 'organisation', 'org', 'employer'],
  address: ['address', 'full address', 'street address', 'location', 'addr'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'description'],
  status: ['status', 'state', 'contact status'],
};

/** "Phone_Number " -> "phone number" so headers can be compared easily. */
export function normalizeHeader(header) {
  return toText(header)
    .toLowerCase()
    .replace(/[_\-.:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Guesses which file column belongs to which contact field.
 * headers: [{ index: 0, label: 'Full Name' }, ...]
 * returns: { name: 0, email: 2, phone: null, ... }
 */
export function suggestMapping(headers) {
  const mapping = {};
  const usedColumns = new Set();

  for (const field of CONTACT_FIELDS) {
    const synonyms = HEADER_SYNONYMS[field.key];
    const match = headers.find(
      (header) => !usedColumns.has(header.index) && synonyms.includes(normalizeHeader(header.label)),
    );
    mapping[field.key] = match ? match.index : null;
    if (match) usedColumns.add(match.index);
  }
  return mapping;
}

/**
 * Checks a mapping chosen by the user.
 * Returns a list of problems (empty list = mapping is fine).
 */
export function checkMapping(mapping, headers) {
  const problems = [];
  const validIndexes = new Set(headers.map((header) => header.index));
  const fieldByColumn = new Map();

  for (const field of CONTACT_FIELDS) {
    const column = mapping?.[field.key];
    const isMapped = column !== null && column !== undefined && column !== '';

    if (!isMapped) {
      if (field.required) problems.push(`Please choose the column that holds "${field.label}"`);
      continue;
    }
    if (!validIndexes.has(Number(column))) {
      problems.push(`The column chosen for "${field.label}" does not exist in the file`);
      continue;
    }
    if (fieldByColumn.has(Number(column))) {
      problems.push(`The same column is used for "${fieldByColumn.get(Number(column))}" and "${field.label}"`);
    }
    fieldByColumn.set(Number(column), field.label);
  }
  return problems;
}

/** Picks the mapped cells out of one file row: ['Ann', 'x@y.com'] -> { name: 'Ann', email: 'x@y.com', ... } */
export function applyMapping(cells, mapping) {
  const row = {};
  for (const field of CONTACT_FIELDS) {
    const column = mapping[field.key];
    row[field.key] = column === null || column === undefined ? '' : toText(cells[Number(column)]);
  }
  return row;
}
