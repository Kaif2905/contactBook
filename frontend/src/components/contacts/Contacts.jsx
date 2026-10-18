// Contacts Component - the main list: search, filters, sorting, pagination,
// view / edit / delete, multi-select for batch delete and export.
//
// The page, search, filters and sort live in the URL (e.g. /contacts?page=2&group=Work),
// so the Back button and a page refresh keep your place.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner, Table } from 'react-bootstrap';
import { STATUSES } from '../../shared.js';
import { contactService } from '../../services/contactService.js';
import { getErrorMessage } from '../../services/api.js';
import { useToast } from '../common/ToastProvider.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import PaginationBar from '../common/PaginationBar.jsx';
import { formatDate, formatNumber, plural } from '../../utils/format.js';

const PAGE_SIZES = [5, 10, 25, 50, 100];
const DEFAULTS = { page: 1, limit: 10, search: '', group: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' };

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'group', label: 'Group' },
  { key: 'createdAt', label: 'Created At' },
];

/** Reads page/search/filters/sort from the URL (with defaults). */
function readQuery(searchParams) {
  const limit = Number(searchParams.get('limit'));
  return {
    page: Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1),
    limit: PAGE_SIZES.includes(limit) ? limit : DEFAULTS.limit,
    search: searchParams.get('search') || '',
    group: searchParams.get('group') || '',
    status: searchParams.get('status') || '',
    sortBy: searchParams.get('sortBy') || DEFAULTS.sortBy,
    sortOrder: searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  };
}

/** Writes the query back into the URL, leaving out default values. */
function toSearchParams(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== '' && value !== DEFAULTS[key]) params.set(key, String(value));
  }
  return params;
}

export default function Contacts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => readQuery(searchParams), [searchParams]);
  const navigate = useNavigate();
  const showToast = useToast();

  const [result, setResult] = useState({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [groups, setGroups] = useState([]);
  const [searchText, setSearchText] = useState(query.search);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleteRequest, setDeleteRequest] = useState(null); // { ids: [...], name? }
  const [deleting, setDeleting] = useState(false);

  const hasFilters = Boolean(query.search || query.group || query.status);
  const reload = () => setReloadKey((key) => key + 1);

  /** Changes part of the query. Any change except paging goes back to page 1. */
  const updateQuery = useCallback(
    (changes, { replace = false } = {}) => {
      setSearchParams(
        (previous) => {
          const next = { ...readQuery(previous), ...changes };
          if (!('page' in changes)) next.page = 1;
          return toSearchParams(next);
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  // Keep the search box in step with the URL (e.g. after pressing Back)
  useEffect(() => {
    setSearchText(query.search);
  }, [query.search]);

  // ----- Load the contacts whenever the query changes -----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');

    contactService
      .list(query)
      .then((data) => {
        if (cancelled) return;
        // e.g. we deleted the last contact on the last page -> go to the new last page
        if (data.data.length === 0 && query.page > 1 && data.pagination.totalPages > 0) {
          updateQuery({ page: data.pagination.totalPages }, { replace: true });
          return;
        }
        setResult(data);
      })
      .catch((error) => !cancelled && setLoadError(getErrorMessage(error)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [query, reloadKey, updateQuery]);

  // ----- Values for the Group filter -----
  useEffect(() => {
    contactService
      .filterOptions()
      .then((options) => setGroups(options.groups))
      .catch(() => {});
  }, [reloadKey]);

  // ----- Search / filters / sorting -----
  function handleSearch(event) {
    event.preventDefault();
    updateQuery({ search: searchText.trim() });
  }

  function clearFilters() {
    setSearchText('');
    updateQuery({ search: '', group: '', status: '' });
  }

  function handleSort(columnKey) {
    if (query.sortBy === columnKey) updateQuery({ sortOrder: query.sortOrder === 'asc' ? 'desc' : 'asc' });
    else updateQuery({ sortBy: columnKey, sortOrder: 'asc' });
  }

  function sortIcon(columnKey) {
    if (query.sortBy !== columnKey) return <i className="bi bi-arrow-down-up ms-1 sort-idle" />;
    return <i className={`bi ${query.sortOrder === 'asc' ? 'bi-sort-up' : 'bi-sort-down'} ms-1 text-primary`} />;
  }

  // ----- Selection (kept while moving between pages) -----
  const pageIds = result.data.map((contact) => contact.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageIds.some((id) => selectedIds.has(id));
  const selectedList = [...selectedIds];

  function toggleOne(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelectedIds((current) => {
      const next = new Set(current);
      pageIds.forEach((id) => (allOnPageSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  // ----- Deleting -----
  async function confirmDelete() {
    const { ids } = deleteRequest;
    setDeleting(true);
    try {
      let deletedIds = ids;
      if (ids.length === 1) {
        await contactService.remove(ids[0]);
        showToast('Contact deleted');
      } else {
        const outcome = await contactService.removeMany(ids);
        const skippedIds = outcome.skipped.map((item) => item.id);
        deletedIds = ids.filter((id) => !skippedIds.includes(id));
        if (outcome.skipped.length > 0) {
          showToast(
            `${plural(outcome.deleted, 'contact')} deleted. ${plural(outcome.skipped.length, 'contact')} skipped because someone is editing them.`,
            'warning',
          );
        } else {
          showToast(`${plural(outcome.deleted, 'contact')} deleted`);
        }
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      reload();
    } catch (error) {
      showToast(getErrorMessage(error), 'danger');
    } finally {
      setDeleting(false);
      setDeleteRequest(null);
    }
  }

  const { pagination } = result;
  const firstRowNumber = (pagination.page - 1) * pagination.limit;
  const lastShown = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <>
      {/* ----- Title and main buttons ----- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts</h1>
          <div className="page-subtitle">Manage your contacts</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button as={Link} to="/contacts/new">
            <i className="bi bi-plus-lg me-1" /> Add Contact
          </Button>
          <Button as={Link} to="/upload" variant="success">
            <i className="bi bi-person-fill-up me-1" /> Upload Excel
          </Button>
        </div>
      </div>

      <Card className="content-card">
        <Card.Body>
          {/* ----- Search and filters ----- */}
          <Form onSubmit={handleSearch}>
            <Row className="g-2 mb-3">
              <Col md={5}>
                <InputGroup>
                  <InputGroup.Text className="bg-white">
                    <i className="bi bi-search text-muted" />
                  </InputGroup.Text>
                  <Form.Control
                    className="border-start-0"
                    placeholder="Search by name, email or phone..."
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    aria-label="Search contacts"
                  />
                </InputGroup>
              </Col>
              <Col sm={4} md={2}>
                <Form.Select aria-label="Filter by group" value={query.group} onChange={(e) => updateQuery({ group: e.target.value })}>
                  <option value="">All Groups</option>
                  {groups.map((group) => (
                    <option key={group}>{group}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col sm={4} md={2}>
                <Form.Select aria-label="Filter by status" value={query.status} onChange={(e) => updateQuery({ status: e.target.value })}>
                  <option value="">All Statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col sm={4} md={3} className="d-flex gap-2">
                <Button type="submit" className="flex-grow-1">
                  <i className="bi bi-search me-1" /> Search
                </Button>
                {hasFilters && (
                  <Button variant="light" className="border" onClick={clearFilters} title="Clear search and filters">
                    Clear
                  </Button>
                )}
              </Col>
            </Row>
          </Form>

          {/* ----- Batch actions for selected contacts ----- */}
          {selectedIds.size > 0 && (
            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <span className="selected-pill">
                <i className="bi bi-check-square-fill text-primary me-1" />
                {formatNumber(selectedIds.size)} selected
              </span>
              <Button size="sm" variant="danger" onClick={() => setDeleteRequest({ ids: selectedList })}>
                <i className="bi bi-trash me-1" /> Delete Selected
              </Button>
              <Button size="sm" onClick={() => navigate('/export', { state: { ids: selectedList } })}>
                <i className="bi bi-download me-1" /> Export Selected
              </Button>
              <Button size="sm" variant="link" className="text-muted" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </Button>
            </div>
          )}

          {loadError && (
            <Alert variant="danger" className="d-flex align-items-center justify-content-between">
              <span>{loadError}</span>
              <Button size="sm" variant="outline-danger" onClick={reload}>
                Try again
              </Button>
            </Alert>
          )}

          {/* ----- The table ----- */}
          <div className={`table-responsive border rounded ${loading ? 'is-loading' : ''}`}>
            <Table hover className="mb-0 align-middle contacts-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      aria-label="Select all contacts on this page"
                      checked={allOnPageSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = someOnPageSelected && !allOnPageSelected;
                      }}
                      onChange={togglePage}
                      disabled={pageIds.length === 0}
                    />
                  </th>
                  <th style={{ width: 50 }}>#</th>
                  {COLUMNS.map((column) => (
                    <th key={column.key} role="button" className="text-nowrap user-select-none" onClick={() => handleSort(column.key)}>
                      {column.label}
                      {sortIcon(column.key)}
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loading && result.data.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 3} className="text-center text-muted py-5">
                      {hasFilters ? (
                        <>
                          <i className="bi bi-search fs-3 d-block mb-2" />
                          No contacts match your search.{' '}
                          <Button variant="link" className="p-0 align-baseline" onClick={clearFilters}>
                            Clear search
                          </Button>
                        </>
                      ) : (
                        <>
                          <i className="bi bi-people fs-3 d-block mb-2" />
                          No contacts yet. <Link to="/upload">Upload an Excel file</Link> or <Link to="/contacts/new">add one</Link>.
                        </>
                      )}
                    </td>
                  </tr>
                )}

                {result.data.map((contact, index) => (
                  <tr key={contact.id} className={selectedIds.has(contact.id) ? 'row-selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        aria-label={`Select ${contact.name}`}
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleOne(contact.id)}
                      />
                    </td>
                    <td className="text-muted">{formatNumber(firstRowNumber + index + 1)}</td>
                    <td>
                      <Link to={`/contacts/${contact.id}`} className="contact-name-link">
                        {contact.name}
                      </Link>
                      {contact.status === 'Inactive' && (
                        <Badge bg="secondary" className="ms-2 fw-normal">
                          Inactive
                        </Badge>
                      )}
                      {contact.editingBy && (
                        <Badge bg="warning" text="dark" className="ms-2 fw-normal" title={`${contact.editingBy} is editing this contact`}>
                          <i className="bi bi-lock-fill me-1" />
                          {contact.editingBy} editing
                        </Badge>
                      )}
                    </td>
                    <td className="text-break">{contact.email}</td>
                    <td className="text-nowrap">{contact.phone}</td>
                    <td>{contact.group}</td>
                    <td className="text-nowrap">{formatDate(contact.createdAt)}</td>
                    <td className="text-nowrap">
                      <button type="button" className="action-btn action-view" title="View" aria-label={`View ${contact.name}`} onClick={() => navigate(`/contacts/${contact.id}`)}>
                        <i className="bi bi-eye-fill" />
                      </button>
                      <button
                        type="button"
                        className="action-btn action-edit"
                        title={contact.editingBy ? `${contact.editingBy} is editing` : 'Edit'}
                        aria-label={`Edit ${contact.name}`}
                        disabled={Boolean(contact.editingBy)}
                        onClick={() => navigate(`/contacts/${contact.id}/edit`)}
                      >
                        <i className="bi bi-pencil-fill" />
                      </button>
                      <button
                        type="button"
                        className="action-btn action-delete"
                        title={contact.editingBy ? `${contact.editingBy} is editing` : 'Delete'}
                        aria-label={`Delete ${contact.name}`}
                        disabled={Boolean(contact.editingBy)}
                        onClick={() => setDeleteRequest({ ids: [contact.id], name: contact.name })}
                      >
                        <i className="bi bi-trash-fill" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {loading && (
              <div className="table-loading">
                <Spinner animation="border" variant="primary" />
              </div>
            )}
          </div>

          {/* ----- Paging ----- */}
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
            <div className="d-flex align-items-center gap-2 small text-muted">
              <span>Show</span>
              <Form.Select
                size="sm"
                style={{ width: 'auto' }}
                aria-label="Rows per page"
                value={query.limit}
                onChange={(event) => updateQuery({ limit: Number(event.target.value) })}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Form.Select>
              <span>entries</span>
              <span className="ms-2">
                {pagination.total > 0
                  ? `Showing ${formatNumber(firstRowNumber + 1)}-${formatNumber(lastShown)} of ${formatNumber(pagination.total)}`
                  : 'No entries'}
              </span>
            </div>
            <PaginationBar page={query.page} totalPages={pagination.totalPages} disabled={loading} onChange={(page) => updateQuery({ page })} />
          </div>
        </Card.Body>
      </Card>

      <ConfirmDialog
        show={Boolean(deleteRequest)}
        title={deleteRequest?.ids.length > 1 ? `Delete ${deleteRequest.ids.length} contacts?` : 'Delete contact?'}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteRequest(null)}
      >
        {deleteRequest?.ids.length > 1 ? (
          <>
            You are about to delete <strong>{formatNumber(deleteRequest.ids.length)} contacts</strong>. This cannot be undone.
          </>
        ) : (
          <>
            Delete <strong>{deleteRequest?.name || 'this contact'}</strong>? This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
