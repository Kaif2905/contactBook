// The contact form, used on the "Add Contact" and "Edit Contact" pages.
// It checks the values with the same rules as the server before sending them.
import { useEffect, useState } from 'react';
import { Button, Col, Form, Row, Spinner } from 'react-bootstrap';
import { CONTACT_FIELDS, STATUSES, SUGGESTED_GROUPS, validateContact } from '../../shared.js';

const FIELD = Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, field]));

const PLACEHOLDERS = {
  name: 'Amit Sharma',
  email: 'amit@gmail.com',
  phone: '9876543210',
  group: 'Friends',
  company: 'ABC Pvt Ltd',
  address: 'Lucknow, Uttar Pradesh',
  notes: 'Friend from college',
};

function toFormValues(contact) {
  const values = Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, contact?.[field.key] ?? '']));
  if (!values.status) values.status = 'Active';
  return values;
}

export default function ContactForm({
  formId,
  initialValues,
  serverErrors,
  groupOptions = [],
  submitting = false,
  disabled = false,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}) {
  const [values, setValues] = useState(() => toFormValues(initialValues));
  const [errors, setErrors] = useState({});
  const locked = submitting || disabled;
  const groups = [...new Set([...SUGGESTED_GROUPS, ...groupOptions])].sort();

  // Errors found by the server (e.g. "email already used") are shown under the fields too
  useEffect(() => {
    if (serverErrors) setErrors((current) => ({ ...current, ...serverErrors }));
  }, [serverErrors]);

  function handleChange(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateContact(values);
    if (!result.isValid) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.value);
  }

  /** One labelled input with its error message underneath. */
  function field(key, { type = 'text', as, rows, list } = {}) {
    const { label, required, maxLength } = FIELD[key];
    return (
      <Form.Group controlId={`${formId}-${key}`}>
        <Form.Label className="form-label-sm">
          {label}
          {required && <span className="text-danger ms-1">*</span>}
        </Form.Label>
        <Form.Control
          as={as}
          rows={rows}
          type={as ? undefined : type}
          list={list}
          value={values[key]}
          maxLength={maxLength}
          placeholder={PLACEHOLDERS[key]}
          isInvalid={Boolean(errors[key])}
          disabled={locked}
          onChange={(event) => handleChange(key, event.target.value)}
        />
        <Form.Control.Feedback type="invalid">{errors[key]}</Form.Control.Feedback>
      </Form.Group>
    );
  }

  return (
    <Form id={formId} noValidate onSubmit={handleSubmit}>
      <Row className="g-3">
        <Col md={4}>{field('name')}</Col>
        <Col md={4}>{field('email', { type: 'email' })}</Col>
        <Col md={4}>{field('phone', { type: 'tel' })}</Col>

        <Col md={4}>
          {field('group', { list: `${formId}-groups` })}
          <datalist id={`${formId}-groups`}>
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </Col>
        <Col md={4}>{field('company')}</Col>
        <Col md={4}>
          <Form.Group controlId={`${formId}-status`}>
            <Form.Label className="form-label-sm">Status</Form.Label>
            <Form.Select value={values.status} disabled={locked} isInvalid={Boolean(errors.status)} onChange={(event) => handleChange('status', event.target.value)}>
              {STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{errors.status}</Form.Control.Feedback>
          </Form.Group>
        </Col>

        <Col md={6}>{field('address')}</Col>
        <Col md={6}>{field('notes', { as: 'textarea', rows: 1 })}</Col>
      </Row>

      <div className="d-flex justify-content-end gap-2 mt-4">
        <Button variant="light" className="border" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={locked}>
          {submitting && <Spinner animation="border" size="sm" className="me-2" />}
          {submitLabel}
        </Button>
      </div>
    </Form>
  );
}
