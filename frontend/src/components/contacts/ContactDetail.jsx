// Contact Detail Component - one contact with Edit / Delete and its change history.
// Editing itself happens on the Edit Contact page (ContactEditor.jsx).
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';
import { CONTACT_FIELDS } from '../../shared.js';
import { contactService } from '../../services/contactService.js';
import { getErrorMessage } from '../../services/api.js';
import { useToast } from '../common/ToastProvider.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { formatDateTime, formatTime, initials } from '../../utils/format.js';

const REFRESH_MS = 15000; // look for changes (and "X is editing") this often
const FIELD_LABELS = Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, field.label]));

export function StatusBadge({ status }) {
  return (
    <Badge pill bg={status === 'Inactive' ? 'secondary' : 'success'} className="status-badge">
      {status || 'Active'}
    </Badge>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();

  const [contact, setContact] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [freshContact, freshHistory] = await Promise.all([contactService.get(id), contactService.history(id)]);
        setContact(freshContact);
        setHistory(freshHistory);
        setNotFound(false);
        setLoadError('');
      } catch (error) {
        if (error.response?.status === 404) setNotFound(true);
        else setLoadError(getErrorMessage(error));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh now and then, so changes by others and "X is editing" show up by themselves
  useEffect(() => {
    if (notFound) return undefined;
    const timer = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [notFound, load]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await contactService.remove(id);
      showToast(`${contact.name} was deleted`);
      navigate('/contacts');
    } catch (error) {
      showToast(getErrorMessage(error), 'danger');
      setShowDelete(false);
      load({ quiet: true });
    } finally {
      setDeleting(false);
    }
  }

  // Back to the list exactly as it was (same page, search and filters)
  function goBack() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/contacts');
  }

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <Alert variant="warning">
        <Alert.Heading as="h5">Contact not found</Alert.Heading>
        It may have been deleted by someone else. <Link to="/contacts">Back to contacts</Link>
      </Alert>
    );
  }

  if (!contact) {
    return (
      <Alert variant="danger" className="d-flex align-items-center justify-content-between">
        <span>{loadError || 'Could not load this contact.'}</span>
        <Button size="sm" variant="outline-danger" onClick={() => load()}>
          Try again
        </Button>
      </Alert>
    );
  }

  const lockedByOther = Boolean(contact.editingBy);
  const rows = [
    ['Email', contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>],
    ['Phone', contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>],
    ['Group', contact.group],
    ['Company', contact.company],
    ['Address', contact.address],
    ['Notes', contact.notes && <span className="pre-wrap">{contact.notes}</span>],
    ['Created At', formatDateTime(contact.createdAt)],
    ['Updated At', formatDateTime(contact.updatedAt)],
  ];

  return (
    <>
      <Button variant="link" className="p-0 mb-2 text-decoration-none small" onClick={goBack}>
        <i className="bi bi-arrow-left me-1" /> Back to contacts
      </Button>

      <div className="page-header">
        <h1 className="page-title">Contact Details</h1>
        <div className="d-flex gap-2">
          <Button onClick={() => navigate(`/contacts/${id}/edit`)} disabled={lockedByOther}>
            <i className="bi bi-pencil-fill me-1" /> Edit
          </Button>
          <Button variant="danger" onClick={() => setShowDelete(true)} disabled={lockedByOther}>
            <i className="bi bi-trash-fill me-1" /> Delete
          </Button>
        </div>
      </div>

      {lockedByOther && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill fs-4" />
          <div>
            <strong>{contact.editingBy.userName}</strong> is editing this contact right now
            {contact.editingBy.lockedAt && ` (since ${formatTime(contact.editingBy.lockedAt)})`}. Edit and Delete are turned off until
            they finish. This page refreshes by itself.
          </div>
        </Alert>
      )}

      <Card className="content-card mb-4">
        <Card.Body className="p-4">
          <div className="d-flex align-items-center gap-3 mb-3">
            <div className="avatar-circle">{initials(contact.name)}</div>
            <div className="d-flex align-items-center flex-wrap gap-2">
              <h2 className="h4 mb-0">{contact.name}</h2>
              <StatusBadge status={contact.status} />
            </div>
          </div>

          <Table bordered className="detail-table mb-0">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td className="text-break">{value || <span className="text-muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card className="content-card">
        <Card.Header className="bg-white fw-semibold d-flex justify-content-between align-items-center">
          <span>
            <i className="bi bi-clock-history me-1" /> Change history
          </span>
          <Badge bg="light" text="dark" title="Goes up by one every time the contact is saved">
            Version {contact.version}
          </Badge>
        </Card.Header>
        {history.length === 0 ? (
          <Card.Body className="text-muted small">No changes yet. Added on {formatDateTime(contact.createdAt)}.</Card.Body>
        ) : (
          <div className="table-responsive history-table">
            <Table size="sm" className="mb-0 small align-top">
              <thead className="table-light">
                <tr>
                  <th>When</th>
                  <th>Changed by</th>
                  <th>Field</th>
                  <th>Old value</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((change) => (
                  <tr key={change.id}>
                    <td className="text-nowrap">{formatDateTime(change.changedAt)}</td>
                    <td>{change.changedBy}</td>
                    <td>{FIELD_LABELS[change.field] || change.field}</td>
                    <td className="text-break text-danger">{change.oldValue ?? <em className="text-muted">empty</em>}</td>
                    <td className="text-break text-success">{change.newValue ?? <em className="text-muted">empty</em>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <ConfirmDialog show={showDelete} title="Delete contact?" busy={deleting} onConfirm={handleDelete} onCancel={() => setShowDelete(false)}>
        Delete <strong>{contact.name}</strong>? This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
