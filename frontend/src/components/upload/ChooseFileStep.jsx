// Step 1 - pick a file (click or drag & drop), check it, upload it.
import { useRef, useState } from 'react';
import { Alert, Button, Card, ProgressBar } from 'react-bootstrap';
import { ACCEPTED_FILE_TYPES, MAX_UPLOAD_MB, checkFile, formatBytes } from '../../services/excelService.js';
import { formatNumber } from '../../utils/format.js';

export default function ChooseFileStep({ file, fileError, uploadPercent, reading, readProgress, onFileChosen, onUpload, onCancel, onDownloadTemplate }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const busy = uploadPercent !== null || reading;

  async function chooseFile(chosen) {
    if (!chosen) return;
    onFileChosen(chosen, await checkFile(chosen));
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (!busy) chooseFile(event.dataTransfer.files?.[0]);
  }

  return (
    <Card className="content-card">
      <Card.Body className="p-4">
        <div
          className={`drop-zone ${dragging ? 'drop-zone-active' : ''} ${busy ? 'drop-zone-disabled' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <i className="bi bi-cloud-arrow-up drop-zone-icon" />
          <div className="fw-semibold mt-2">Drag &amp; Drop your Excel file here</div>
          <div className="text-muted small my-2">or</div>
          <Button onClick={() => inputRef.current?.click()} disabled={busy} className="px-4">
            Choose File
          </Button>
          <div className="text-muted small mt-3">
            Supported format: .xlsx, .xls, .csv (Max size: {MAX_UPLOAD_MB}MB)
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            className="d-none"
            data-testid="file-input"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.target.value = ''; // lets the same file be chosen again
            }}
          />

          {file && !fileError && (
            <div className="file-pill mt-3">
              <i className="bi bi-check-circle-fill me-2" />
              File selected: <strong className="ms-1">{file.name}</strong>
              <span className="ms-1">({formatBytes(file.size)})</span>
            </div>
          )}
        </div>

        {fileError && (
          <Alert variant="danger" className="mt-3 mb-0">
            <i className="bi bi-exclamation-triangle-fill me-1" /> {fileError}
          </Alert>
        )}

        {uploadPercent !== null && (
          <div className="mt-3">
            <div className="small mb-1">Uploading... {uploadPercent}%</div>
            <ProgressBar now={uploadPercent} animated striped />
          </div>
        )}

        {reading && (
          <div className="mt-3">
            <div className="small mb-1">Reading the file... {formatNumber(readProgress?.rowsDone)} rows read</div>
            <ProgressBar now={readProgress?.percent || 0} animated striped variant="info" />
          </div>
        )}

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-4">
          <div className="d-flex align-items-start gap-2">
            <i className="bi bi-file-earmark-excel-fill text-success fs-2" />
            <div className="small">
              <div className="fw-semibold">Required Columns: Name, Email, Phone Number</div>
              <div className="text-muted">You can also include: Group, Company, Address, Notes, Status.</div>
              <Button variant="link" size="sm" className="p-0" onClick={onDownloadTemplate}>
                <i className="bi bi-download me-1" />
                Download a sample template
              </Button>
            </div>
          </div>
          <div className="d-flex gap-2">
            {busy && (
              <Button variant="light" className="border" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button onClick={onUpload} disabled={!file || Boolean(fileError) || busy}>
              Upload &amp; Validate
            </Button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
