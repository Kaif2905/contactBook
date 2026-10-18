// Step 4 - saving progress, then the final result.
import { Alert, Button, Card, ProgressBar, Spinner } from 'react-bootstrap';
import { formatNumber, plural } from '../../utils/format.js';

export default function ImportStep({ upload, downloading, onDownloadReport, onViewContacts, onUploadAnother, onTryAgain }) {
  if (upload.status === 'importing') {
    return (
      <Card className="content-card">
        <Card.Body className="p-4">
          <div className="mb-2">
            Saving contacts... {formatNumber(upload.progress.rowsDone)} of {formatNumber(upload.dataRowCount)} rows processed
          </div>
          <ProgressBar now={upload.progress.percent} label={`${upload.progress.percent}%`} animated striped variant="success" />
          <div className="text-muted small mt-2">You can keep this page open. Big files can take a few minutes.</div>
        </Card.Body>
      </Card>
    );
  }

  if (upload.status === 'failed') {
    return (
      <Card className="content-card">
        <Card.Body className="p-4">
          <Alert variant="danger">
            <Alert.Heading as="h5">The import stopped</Alert.Heading>
            {upload.message}
          </Alert>
          <div className="d-flex gap-2">
            <Button onClick={onTryAgain}>Check the rows again</Button>
            <Button variant="outline-secondary" onClick={onUploadAnother}>
              Start over
            </Button>
          </div>
        </Card.Body>
      </Card>
    );
  }

  const { inserted, invalidRows } = upload.summary;

  return (
    <Card className="content-card">
      <Card.Body className="p-4 text-center">
        <i className="bi bi-check-circle-fill text-success display-4" />
        <h2 className="h4 mt-2">Import finished</h2>
        <p className="mb-1">
          <strong>{plural(inserted, 'contact')}</strong> saved.
        </p>
        {invalidRows > 0 && (
          <p className="text-muted">
            {plural(invalidRows, 'row')} skipped because of problems.{' '}
            <Button variant="link" className="p-0 align-baseline" onClick={onDownloadReport} disabled={downloading}>
              {downloading && <Spinner animation="border" size="sm" className="me-1" />}
              Download the error report
            </Button>
          </p>
        )}
        <div className="d-flex justify-content-center gap-2 mt-3">
          <Button onClick={onViewContacts}>
            <i className="bi bi-people me-1" /> View contacts
          </Button>
          <Button variant="outline-secondary" onClick={onUploadAnother}>
            Upload another file
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
