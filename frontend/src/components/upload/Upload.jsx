// Upload Component - import contacts from an Excel (.xlsx) or CSV file.
//
//   1. Choose file   -> format/size checked in the browser, then uploaded
//   2. Match columns -> which column is Name, Email, Phone...
//   3. Review rows   -> every invalid row is listed BEFORE anything is saved
//   4. Import        -> only the valid rows are saved
//
// The server does the heavy work in the background (files can be 50 MB+),
// so this page simply asks for progress every 0.7 seconds.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card } from 'react-bootstrap';
import { checkMapping } from '../../shared.js';
import { excelService } from '../../services/excelService.js';
import { getErrorMessage } from '../../services/api.js';
import { useToast } from '../common/ToastProvider.jsx';
import StepIndicator from './StepIndicator.jsx';
import ChooseFileStep from './ChooseFileStep.jsx';
import MapColumnsStep from './MapColumnsStep.jsx';
import ReviewStep from './ReviewStep.jsx';
import ImportStep from './ImportStep.jsx';

const PHASES = ['choose', 'map', 'review', 'import'];
const WORKING_STATUSES = ['reading', 'validating', 'importing'];
const POLL_MS = 700;

export default function Upload() {
  const navigate = useNavigate();
  const showToast = useToast();

  const [phase, setPhase] = useState('choose');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [uploadPercent, setUploadPercent] = useState(null); // null = not uploading
  const [upload, setUpload] = useState(null); // what the server knows about this upload
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [mappingNote, setMappingNote] = useState('');

  // ----- Ask the server for progress while it is working -----
  useEffect(() => {
    if (!upload || !WORKING_STATUSES.includes(upload.status)) return undefined;
    const timer = setInterval(async () => {
      try {
        setUpload(await excelService.getUpload(upload.id));
      } catch (err) {
        clearInterval(timer);
        setError(getErrorMessage(err));
        if (err.response?.status === 404) resetAll();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [upload?.id, upload?.status]);

  // ----- React to the server finishing a step -----
  // When the file has been read: if every required column was recognised, validate
  // straight away ("Upload & Validate"). Otherwise ask the user to match the columns.
  const autoValidateStarted = useRef(false);
  useEffect(() => {
    if (!upload || phase !== 'choose') return;
    if (upload.status === 'ready') {
      const suggested = upload.suggestedMapping || {};
      setMapping(suggested);
      if (checkMapping(suggested, upload.headers).length === 0) {
        if (!autoValidateStarted.current) {
          autoValidateStarted.current = true;
          handleCheckRows(suggested);
        }
      } else {
        setMappingNote('Some required columns could not be matched automatically. Please choose them below.');
        setPhase('map');
      }
    } else if (upload.status === 'failed') {
      setFileError(upload.message); // e.g. "The file is empty or damaged"
      setUpload(null);
    }
  }, [upload, phase]);

  // ----- If the user leaves this page half way, tell the server to throw the upload away -----
  const latestUpload = useRef(null);
  latestUpload.current = upload;
  useEffect(
    () => () => {
      const current = latestUpload.current;
      if (current && !['completed', 'importing'].includes(current.status)) excelService.cancel(current.id);
    },
    [],
  );

  function resetAll() {
    autoValidateStarted.current = false;
    setMappingNote('');
    setPhase('choose');
    setFile(null);
    setFileError('');
    setUpload(null);
    setMapping({});
    setUploadPercent(null);
    setBusy(false);
  }

  // ----- Step 1 -----
  function handleFileChosen(chosenFile, problem) {
    setError('');
    setFile(chosenFile);
    setFileError(problem || '');
  }

  async function handleUpload() {
    setError('');
    setFileError('');
    setUploadPercent(0);
    try {
      setUpload(await excelService.upload(file, setUploadPercent));
    } catch (err) {
      setFileError(getErrorMessage(err));
    } finally {
      setUploadPercent(null);
    }
  }

  async function handleCancel() {
    if (upload) await excelService.cancel(upload.id);
    resetAll();
  }

  // ----- Step 2 -----
  async function handleCheckRows(mappingToUse = mapping) {
    setBusy(true);
    setError('');
    try {
      setUpload(await excelService.validate(latestUpload.current.id, mappingToUse));
      setPhase('review');
    } catch (err) {
      setError(getErrorMessage(err));
      setPhase('map');
    } finally {
      setBusy(false);
    }
  }

  // ----- Step 3 -----
  async function handleImport() {
    setBusy(true);
    setError('');
    try {
      setUpload(await excelService.startImport(upload.id));
      setPhase('import');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadReport() {
    setDownloading(true);
    try {
      const fileName = await excelService.downloadErrorReport(upload.id);
      showToast(`Downloaded ${fileName}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'danger');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      await excelService.downloadTemplate();
    } catch (err) {
      showToast(getErrorMessage(err), 'danger');
    }
  }

  // ----- Rendering -----
  function renderStep() {
    if (phase === 'choose') {
      return (
        <ChooseFileStep
          file={file}
          fileError={fileError}
          uploadPercent={uploadPercent}
          reading={upload?.status === 'reading'}
          readProgress={upload?.progress}
          onFileChosen={handleFileChosen}
          onUpload={handleUpload}
          onCancel={handleCancel}
          onDownloadTemplate={handleDownloadTemplate}
        />
      );
    }

    if (phase === 'map') {
      return (
        <MapColumnsStep
          upload={upload}
          mapping={mapping}
          note={mappingNote}
          busy={busy}
          onChange={(fieldKey, column) => setMapping((current) => ({ ...current, [fieldKey]: column }))}
          onBack={handleCancel}
          onCheckRows={() => handleCheckRows()}
        />
      );
    }

    if (phase === 'review') {
      if (upload.status === 'failed') {
        return (
          <Card className="content-card">
            <Card.Body className="p-4">
              <Alert variant="danger">{upload.message}</Alert>
              <Button onClick={() => setPhase('map')}>Back to column matching</Button>
            </Card.Body>
          </Card>
        );
      }
      return (
        <ReviewStep
          upload={upload}
          busy={busy}
          downloading={downloading}
          onBackToMapping={() => {
            setMappingNote('');
            setPhase('map');
          }}
          onCancel={handleCancel}
          onImport={handleImport}
          onDownloadReport={handleDownloadReport}
        />
      );
    }

    return (
      <ImportStep
        upload={upload}
        downloading={downloading}
        onDownloadReport={handleDownloadReport}
        onViewContacts={() => navigate('/contacts')}
        onUploadAnother={() => {
          if (upload && upload.status !== 'completed') excelService.cancel(upload.id);
          resetAll();
        }}
        onTryAgain={async () => {
          setPhase('review');
          await handleCheckRows();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Contacts</h1>
          <div className="page-subtitle">Upload an Excel file to add multiple contacts. Rows with errors are shown before anything is saved.</div>
        </div>
      </div>

      <StepIndicator current={PHASES.indexOf(phase)} />

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {renderStep()}
    </>
  );
}
