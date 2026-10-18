// Step 3 - the result of checking every row, shown BEFORE anything is saved.
import { Alert, Button, Card, ProgressBar, Spinner } from 'react-bootstrap';
import InvalidRowsTable from './InvalidRowsTable.jsx';
import { formatNumber, plural } from '../../utils/format.js';

export default function ReviewStep({ upload, busy, downloading, onBackToMapping, onCancel, onImport, onDownloadReport }) {
  if (upload.status === 'validating') {
    return (
      <Card className="content-card">
        <Card.Body className="p-4">
          <div className="mb-2">
            Validating rows... {formatNumber(upload.progress.rowsDone)} of {formatNumber(upload.dataRowCount)}
          </div>
          <ProgressBar now={upload.progress.percent} label={`${upload.progress.percent}%`} animated striped />
          <div className="text-muted small mt-2">Nothing is saved yet. Big files can take a minute.</div>
        </Card.Body>
      </Card>
    );
  }

  const { totalRows, validRows, invalidRows } = upload.summary;

  return (
    <Card className="content-card">
      <Card.Body className="p-4">
        {invalidRows > 0 ? (
          <div className="validation-banner validation-failed">
            <i className="bi bi-exclamation-triangle-fill" />
            <div>
              <div className="validation-title">Validation Failed</div>
              <div>
                {plural(invalidRows, 'row')} {invalidRows === 1 ? 'has' : 'have'} errors. Please check the details below.{' '}
                {validRows > 0 && (
                  <>
                    The other <strong>{plural(validRows, 'row')}</strong> can be imported.
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="validation-banner validation-passed">
            <i className="bi bi-check-circle-fill" />
            <div>
              <div className="validation-title">Validation Passed</div>
              <div>All {plural(totalRows, 'row')} are valid. Nothing has been saved yet - click Import to save them.</div>
            </div>
          </div>
        )}

        {invalidRows > 0 && (
          <>
            <InvalidRowsTable uploadId={upload.id} total={invalidRows} />
            <Button className="mt-3" onClick={onDownloadReport} disabled={downloading}>
              {downloading ? <Spinner animation="border" size="sm" className="me-2" /> : <i className="bi bi-download me-2" />}
              Download Error Report (Excel)
            </Button>
          </>
        )}

        {validRows === 0 && (
          <Alert variant="danger" className="mt-3 mb-0">
            None of the rows can be imported. Download the error report, fix the file and upload it again.
          </Alert>
        )}

        <hr className="my-4" />

        <div className="d-flex flex-wrap justify-content-between gap-2">
          <Button variant="link" className="px-0" onClick={onBackToMapping} disabled={busy}>
            <i className="bi bi-arrow-left me-1" /> Change column matching
          </Button>
          <div className="d-flex gap-2">
            <Button variant="light" className="border" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="success" onClick={onImport} disabled={busy || validRows === 0}>
              {busy && <Spinner animation="border" size="sm" className="me-2" />}
              Import {plural(validRows, 'valid contact')}
            </Button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
