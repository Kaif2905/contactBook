// Export Contacts page - choose the fields and (optionally) filters, then download an Excel file.
// Opened from the list's "Export Selected" button, it exports just the selected contacts.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { EXPORT_FIELDS, STATUSES } from '../../shared.js';
import { excelService } from '../../services/excelService.js';
import { contactService } from '../../services/contactService.js';
import { getErrorMessage } from '../../services/api.js';
import { useToast } from '../common/ToastProvider.jsx';
import { formatNumber, plural } from '../../utils/format.js';

const ALL_FIELDS = EXPORT_FIELDS.map((field) => field.key);
const DEFAULT_FIELDS = ['name', 'email', 'phone', 'group'];
const EMPTY_FILTERS = { name: '', email: '', group: '', status: '', from: '', to: '' };

/** "2026-10-12" typed in the date box -> start of that day in the user's time zone */
function startOfDay(dateText) {
  return dateText ? new Date(`${dateText}T00:00:00`).toISOString() : '';
}

/** "2026-10-15" -> start of the NEXT day, so the whole 15th is included */
function endOfDay(dateText) {
  if (!dateText) return '';
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export default function ExportContacts() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const selectedIds = location.state?.ids || [];
  const exportingSelection = selectedIds.length > 0;

  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [groups, setGroups] = useState([]);
  const [matchCount, setMatchCount] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const apiFilters = {
    name: filters.name.trim(),
    email: filters.email.trim(),
    group: filters.group,
    status: filters.status,
    createdFrom: startOfDay(filters.from),
    createdTo: endOfDay(filters.to),
  };
  const filterKey = JSON.stringify(apiFilters);

  useEffect(() => {
    contactService
      .filterOptions()
      .then((options) => setGroups(options.groups))
      .catch(() => {});
  }, []);

  // Show how many contacts the current filters match
  useEffect(() => {
    if (exportingSelection) return undefined;
    if (filters.from && filters.to && filters.from > filters.to) {
      setMatchCount(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      contactService
        .list({ ...JSON.parse(filterKey), page: 1, limit: 1 })
        .then((result) => !cancelled && setMatchCount(result.pagination.total))
        .catch(() => !cancelled && setMatchCount(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filterKey, exportingSelection, filters.from, filters.to]);

  const allChecked = fields.length === ALL_FIELDS.length;

  function toggleField(key) {
    setFields((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  }

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function handleExport() {
    if (fields.length === 0) {
      setError('Choose at least one field to export.');
      return;
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      setError('The "From" date must be on or before the "To" date.');
      return;
    }
    setError('');
    setExporting(true);
    try {
      const options = { fields, sortBy: 'name', sortOrder: 'asc' };
      if (exportingSelection) options.ids = selectedIds;
      else options.filters = apiFilters;
      const fileName = await excelService.exportContacts(options);
      showToast(`Downloaded ${fileName}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Export Contacts</h1>
          <div className="page-subtitle">Choose the fields and filters for the contacts to export to Excel</div>
        </div>
      </div>

      {exportingSelection && (
        <Alert variant="primary" className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <span>
            <i className="bi bi-check2-square me-1" /> Exporting the <strong>{plural(selectedIds.length, 'contact')}</strong> you selected.
          </span>
          <Button size="sm" variant="outline-primary" onClick={() => navigate('/export', { replace: true, state: null })}>
            Export with filters instead
          </Button>
        </Alert>
      )}

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Row className="g-3">
        <Col lg={exportingSelection ? 12 : 5}>
          <Card className="content-card h-100">
            <Card.Body>
              <h2 className="h6 fw-semibold mb-3">Select Fields to Export</h2>
              <Form.Check
                id="export-all-fields"
                label="Select All"
                className="mb-2 fw-medium"
                checked={allChecked}
                onChange={() => setFields(allChecked ? [] : ALL_FIELDS)}
              />
              <div className="export-field-list">
                {EXPORT_FIELDS.map((field) => (
                  <Form.Check
                    key={field.key}
                    id={`export-field-${field.key}`}
                    label={field.label}
                    checked={fields.includes(field.key)}
                    onChange={() => toggleField(field.key)}
                  />
                ))}
              </div>
              <Button variant="link" size="sm" className="p-0 mt-2" onClick={() => setFields(['name', 'email', 'phone'])}>
                Only Name, Email and Phone
              </Button>
            </Card.Body>
          </Card>
        </Col>

        {!exportingSelection && (
          <Col lg={7}>
            <Card className="content-card h-100">
              <Card.Body>
                <h2 className="h6 fw-semibold mb-3">Apply Filters (Optional)</h2>
                <Row className="g-3">
                  <Col sm={6}>
                    <Form.Label className="form-label-sm" htmlFor="export-name">Name</Form.Label>
                    <Form.Control id="export-name" placeholder="Search by name..." value={filters.name} onChange={(e) => changeFilter('name', e.target.value)} />
                  </Col>
                  <Col sm={6}>
                    <Form.Label className="form-label-sm" htmlFor="export-email">Email</Form.Label>
                    <Form.Control id="export-email" placeholder="Search by email..." value={filters.email} onChange={(e) => changeFilter('email', e.target.value)} />
                  </Col>
                  <Col sm={6}>
                    <Form.Label className="form-label-sm" htmlFor="export-group">Group</Form.Label>
                    <Form.Select id="export-group" value={filters.group} onChange={(e) => changeFilter('group', e.target.value)}>
                      <option value="">All Groups</option>
                      {groups.map((group) => (
                        <option key={group}>{group}</option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col sm={6}>
                    <Form.Label className="form-label-sm" htmlFor="export-status">Status</Form.Label>
                    <Form.Select id="export-status" value={filters.status} onChange={(e) => changeFilter('status', e.target.value)}>
                      <option value="">All Statuses</option>
                      {STATUSES.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col xs={12}>
                    <Form.Label className="form-label-sm mb-1">Date Added</Form.Label>
                    <Row className="g-2">
                      <Col sm={6}>
                        <Form.Control type="date" aria-label="From date" value={filters.from} onChange={(e) => changeFilter('from', e.target.value)} />
                        <Form.Text>From</Form.Text>
                      </Col>
                      <Col sm={6}>
                        <Form.Control type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => changeFilter('to', e.target.value)} />
                        <Form.Text>To</Form.Text>
                      </Col>
                    </Row>
                  </Col>
                </Row>
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <span className="text-muted small">
                    {matchCount === null ? '' : `${formatNumber(matchCount)} contacts match these filters`}
                  </span>
                  <Button variant="link" size="sm" className="p-0" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        )}
      </Row>

      <div className="d-grid mt-3">
        <Button variant="success" size="lg" onClick={handleExport} disabled={exporting || fields.length === 0 || matchCount === 0}>
          {exporting ? <Spinner animation="border" size="sm" className="me-2" /> : <i className="bi bi-file-earmark-excel-fill me-2" />}
          Export to Excel
        </Button>
      </div>
    </>
  );
}
