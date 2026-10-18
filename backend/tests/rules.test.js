// Unit tests for the shared validation rules (no database needed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMapping,
  checkMapping,
  normalizePhone,
  suggestMapping,
  validateContact,
} from '../../shared/contactRules.mjs';

const validContact = { name: 'Priya Sharma', email: 'Priya.Sharma@Example.com', phone: '+91 98765-43210' };

describe('validateContact - required fields', () => {
  it('accepts a contact with name, email and phone', () => {
    const { isValid, value } = validateContact(validContact);
    assert.equal(isValid, true);
    assert.equal(value.email, 'priya.sharma@example.com', 'email is stored in lower case');
    assert.equal(value.phone, '+919876543210', 'phone is stored without spaces and dashes');
  });

  for (const field of ['name', 'email', 'phone']) {
    it(`rejects a contact without ${field}`, () => {
      const { isValid, errors } = validateContact({ ...validContact, [field]: '   ' });
      assert.equal(isValid, false);
      assert.match(errors[field], /is required/);
    });
  }

  it('turns empty optional fields into null', () => {
    const { value } = validateContact({ ...validContact, company: '  ', group: '' });
    assert.equal(value.company, null);
    assert.equal(value.group, null);
  });

  it('trims spaces around values', () => {
    const { value } = validateContact({ ...validContact, name: '  Priya  ', company: ' Acme ' });
    assert.equal(value.name, 'Priya');
    assert.equal(value.company, 'Acme');
  });

  it('rejects values that are too long', () => {
    const { errors } = validateContact({ ...validContact, name: 'x'.repeat(101), notes: 'y'.repeat(1001) });
    assert.match(errors.name, /100 characters or less/);
    assert.match(errors.notes, /1000 characters or less/);
  });
});

describe('validateContact - status', () => {
  it('uses Active when status is empty', () => {
    assert.equal(validateContact(validContact).value.status, 'Active');
  });

  it('accepts any letter case and tidies it', () => {
    assert.equal(validateContact({ ...validContact, status: 'inactive' }).value.status, 'Inactive');
    assert.equal(validateContact({ ...validContact, status: ' ACTIVE ' }).value.status, 'Active');
  });

  it('rejects other values', () => {
    assert.match(validateContact({ ...validContact, status: 'Deleted' }).errors.status, /Active or Inactive/);
  });
});

describe('validateContact - email format', () => {
  const good = ['a@b.co', 'first.last@company.com', 'user+tag@mail.example.org', "o'brien@test.ie", 'UPPER@CASE.COM', 'x_y-z@sub-domain.co.in'];
  const bad = ['plainaddress', 'no-at-sign.com', '@missing-user.com', 'missing-domain@', 'user@domain', 'user@domain.c', 'two@@at.com', 'space in@mail.com', 'user@.com', '.leading@dot.com', 'trailing.@dot.com', 'double..dot@mail.com', 'user@domain..com'];

  for (const email of good) {
    it(`accepts ${email}`, () => assert.equal(validateContact({ ...validContact, email }).isValid, true));
  }
  for (const email of bad) {
    it(`rejects ${email}`, () => assert.match(validateContact({ ...validContact, email }).errors.email, /format is invalid/));
  }
});

describe('validateContact - phone format', () => {
  const good = ['9876543210', '+919876543210', '+91 98765 43210', '(022) 2345-6789', '022.2345.6789', '1234567', '+123456789012345'];
  const bad = ['12345', '123456', '+1234567890123456', '98765abcde', '98765-4321 ext 5', '++919876543210', '91+9876543210', 'phone'];

  for (const phone of good) {
    it(`accepts ${phone}`, () => assert.equal(validateContact({ ...validContact, phone }).isValid, true));
  }
  for (const phone of bad) {
    it(`rejects ${phone}`, () => assert.match(validateContact({ ...validContact, phone }).errors.phone, /format is invalid/));
  }

  it('accepts phone numbers that Excel stored as numbers', () => {
    const { isValid, value } = validateContact({ ...validContact, phone: 9876543210 });
    assert.equal(isValid, true);
    assert.equal(value.phone, '9876543210');
  });

  it('normalizePhone removes spaces, dashes, dots and brackets', () => {
    assert.equal(normalizePhone(' +1 (415) 555-0134 '), '+14155550134');
  });
});

describe('column mapping', () => {
  const headers = [
    { index: 0, label: 'Full Name' },
    { index: 1, label: 'E-mail' },
    { index: 2, label: 'Mobile No' },
    { index: 3, label: 'Organisation' },
    { index: 4, label: 'Category' },
    { index: 5, label: 'Something Else' },
  ];

  it('suggests columns from common header names', () => {
    const mapping = suggestMapping(headers);
    assert.equal(mapping.name, 0);
    assert.equal(mapping.email, 1);
    assert.equal(mapping.phone, 2);
    assert.equal(mapping.company, 3);
    assert.equal(mapping.group, 4);
    assert.equal(mapping.address, null);
    assert.equal(mapping.status, null);
  });

  it('accepts a mapping that covers the required fields', () => {
    assert.deepEqual(checkMapping({ name: 0, email: 1, phone: 2 }, headers), []);
  });

  it('complains when a required field is not mapped', () => {
    const problems = checkMapping({ name: 0, email: 1, phone: null }, headers);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Phone Number/);
  });

  it('complains when one column is used twice', () => {
    const problems = checkMapping({ name: 0, email: 1, phone: 2, company: 0 }, headers);
    assert.match(problems.join(' '), /same column/);
  });

  it('complains about columns that do not exist', () => {
    const problems = checkMapping({ name: 0, email: 1, phone: 9 }, headers);
    assert.match(problems.join(' '), /does not exist/);
  });

  it('applyMapping picks the right cells (and copes with missing cells)', () => {
    const row = applyMapping(['Ann', 'ann@x.com'], { name: 0, email: 1, phone: 2, company: null });
    assert.equal(row.name, 'Ann');
    assert.equal(row.email, 'ann@x.com');
    assert.equal(row.phone, '');
    assert.equal(row.company, '');
  });
});
