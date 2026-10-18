// Step 2 - match each contact field to a column of the uploaded file.
import { Alert, Badge, Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import { checkMapping } from '../../shared.js';
import { formatNumber } from '../../utils/format.js';

export default function MapColumnsStep({ upload, mapping, note, busy, onChange, onBack, onCheckRows }) {
  const problems = checkMapping(mapping, upload.headers);
  const example = (column) => {
    if (column === null || column === undefined || column === '') return '';
    const value = upload.preview?.find((row) => row[column])?.[column];
    return value || '';
  };

  return (
    <Card className="content-card">
      <Card.Body className="p-4">
        {note && (
          <Alert variant="info" className="py-2">
            <i className="bi bi-info-circle me-1" /> {note}
          </Alert>
        )}
        <h2 className="h5">Match columns</h2>
        <p className="mb-3">
          <strong>{upload.fileName}</strong> has <strong>{formatNumber(upload.dataRowCount)} rows</strong> and{' '}
          {upload.headers.length} columns. Tell us which column holds each piece of information. We guessed where we could.
        </p>

        <Table responsive className="align-middle mapping-table">
          <thead className="table-light">
            <tr>
              <th>Contact field</th>
              <th>Column in your file</th>
              <th className="d-none d-md-table-cell">Example from the file</th>
            </tr>
          </thead>
          <tbody>
            {upload.fields.map((field) => {
              const column = mapping[field.key];
              return (
                <tr key={field.key}>
                  <td className="fw-medium">
                    {field.label}
                    {field.required && (
                      <Badge bg="danger" className="ms-2">
                        required
                      </Badge>
                    )}
                  </td>
                  <td>
                    <Form.Select
                      aria-label={`Column for ${field.label}`}
                      value={column ?? ''}
                      disabled={busy}
                      isInvalid={field.required && (column === null || column === undefined || column === '')}
                      onChange={(event) => onChange(field.key, event.target.value === '' ? null : Number(event.target.value))}
                    >
                      <option value="">- Don't import -</option>
                      {upload.headers.map((header) => (
                        <option key={header.index} value={header.index}>
                          {header.label}
                        </option>
                      ))}
                    </Form.Select>
                  </td>
                  <td className="d-none d-md-table-cell text-muted small text-break">{example(column)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        {problems.length > 0 && (
          <Alert variant="warning">
            <ul className="mb-0 ps-3">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="d-flex justify-content-between gap-2 mt-3">
          <Button variant="outline-secondary" onClick={onBack} disabled={busy}>
            <i className="bi bi-arrow-left me-1" /> Choose another file
          </Button>
          <Button onClick={onCheckRows} disabled={busy || problems.length > 0}>
            {busy && <Spinner animation="border" size="sm" className="me-2" />}
            Validate rows <i className="bi bi-arrow-right ms-1" />
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
