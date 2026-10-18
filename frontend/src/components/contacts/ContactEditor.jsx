// "Add Contact" (/contacts/new) and "Edit Contact" (/contacts/:id/edit) pages.
//
// Editing safety:
//   * Opening the Edit page asks the server for an edit lock. If someone else is
//     editing, a warning shows who it is and the form stays read-only. The page
//     tries again every 10 seconds and unlocks the form once they are done.
//   * While we hold the lock, it is renewed every 30 seconds.
//   * Saving sends the version we started from. If someone still managed to save in
//     between (e.g. their lock expired), the server refuses and we offer to reload.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import { contactService } from '../../services/contactService.js';
import { getErrorMessage } from '../../services/api.js';
import { useToast } from '../common/ToastProvider.jsx';
import ContactForm from './ContactForm.jsx';
import { formatTime } from '../../utils/format.js';

const HEARTBEAT_MS = 30000; // renew our lock this often
const RETRY_LOCK_MS = 10000; // while someone else edits, check again this often

export default function ContactEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const showToast = useToast();

  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [lockState, setLockState] = useState(isNew ? 'mine' : 'checking'); // checking | mine | other | lost
  const [lockOwner, setLockOwner] = useState(null); // { userName, lockedAt }
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null); // { message, code }
  const [serverErrors, setServerErrors] = useState(null);
  const [groupOptions, setGroupOptions] = useState([]);

  const holdsLock = useRef(false);

  useEffect(() => {
    contactService
      .filterOptions()
      .then((options) => setGroupOptions(options.groups))
      .catch(() => {});
  }, []);

  // ----- Load the contact and try to take the edit lock -----
  const loadContact = useCallback(async () => {
    try {
      const fresh = await contactService.get(id);
      setContact(fresh);
      return fresh;
    } catch (error) {
      if (error.response?.status === 404) setNotFound(true);
      else setLoadError(getErrorMessage(error));
      return null;
    }
  }, [id]);

  const tryToLock = useCallback(async () => {
    try {
      await contactService.lock(id);
      holdsLock.current = true;
      setLockState('mine');
      setLockOwner(null);
      return true;
    } catch (error) {
      const data = error.response?.data;
      if (data?.code === 'CONTACT_LOCKED') {
        setLockState('other');
        setLockOwner(data.lock);
      } else if (error.response?.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(getErrorMessage(error));
      }
      return false;
    }
  }, [id]);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      setLoading(true);
      await tryToLock();
      await loadContact(); // load AFTER locking, so we edit the newest version
      setLoading(false);
    })();
  }, [isNew, tryToLock, loadContact]);

  // Someone else is editing: try again every few seconds
  useEffect(() => {
    if (lockState !== 'other') return undefined;
    const timer = setInterval(async () => {
      if (await tryToLock()) {
        await loadContact();
        showToast('The other person has finished. You can edit now.', 'info');
      }
    }, RETRY_LOCK_MS);
    return () => clearInterval(timer);
  }, [lockState, tryToLock, loadContact, showToast]);

  // We hold the lock: keep it alive
  useEffect(() => {
    if (lockState !== 'mine' || isNew) return undefined;
    const timer = setInterval(async () => {
      try {
        await contactService.lock(id);
      } catch (error) {
        holdsLock.current = false;
        setLockState(error.response?.data?.code === 'CONTACT_LOCKED' ? 'other' : 'lost');
        setLockOwner(error.response?.data?.lock || null);
        setProblem({ message: `Your edit session ended: ${getErrorMessage(error)}`, code: error.response?.data?.code });
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [lockState, isNew, id]);

  // Give the lock back when leaving this page or closing the tab
  useEffect(() => {
    if (isNew) return undefined;
    const releaseLock = () => {
      if (holdsLock.current) {
        holdsLock.current = false;
        contactService.unlockWhilePageCloses(id);
      }
    };
    window.addEventListener('pagehide', releaseLock);
    return () => {
      window.removeEventListener('pagehide', releaseLock);
      releaseLock();
    };
  }, [isNew, id]);

  // ----- Save / Cancel -----
  async function handleSave(values) {
    setSaving(true);
    setProblem(null);
    setServerErrors(null);
    try {
      if (isNew) {
        const created = await contactService.create(values);
        showToast(`${created.name} was added`);
        navigate(`/contacts/${created.id}`, { replace: true });
      } else {
        const saved = await contactService.update(id, { ...values, version: contact.version });
        holdsLock.current = false;
        await contactService.unlock(id).catch(() => {});
        showToast(saved.version === contact.version ? 'Nothing was changed' : 'Contact updated');
        navigate(`/contacts/${id}`, { replace: true });
      }
    } catch (error) {
      const data = error.response?.data;
      setServerErrors(data?.fieldErrors || null);
      setProblem({ message: getErrorMessage(error), code: data?.code });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    navigate(isNew ? '/contacts' : `/contacts/${id}`); // leaving the page releases the lock
  }

  async function loadLatestVersion() {
    setProblem(null);
    await loadContact(); // the form re-opens with the newest values
  }

  // ----- Rendering -----
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
        It may have been deleted. <Link to="/contacts">Back to contacts</Link>
      </Alert>
    );
  }

  if (!isNew && !contact) {
    return <Alert variant="danger">{loadError || 'Could not load this contact.'}</Alert>;
  }

  return (
    <>
      <Button variant="link" className="p-0 mb-2 text-decoration-none small" onClick={handleCancel}>
        <i className="bi bi-arrow-left me-1" /> {isNew ? 'Back to contacts' : 'Back to contact details'}
      </Button>

      <div className="page-header">
        <div>
          <h1 className="page-title">{isNew ? 'Add Contact' : 'Edit Contact'}</h1>
          <div className="page-subtitle">Fields marked * are required. Email and phone must be unique.</div>
        </div>
      </div>

      {lockState === 'other' && (
        <Alert variant="warning" className="d-flex align-items-center gap-3 lock-alert">
          <i className="bi bi-lock-fill fs-3 text-warning" />
          <div>
            <strong>
              This contact is currently being edited by another user ({lockOwner?.userName || 'someone else'}
              {lockOwner?.lockedAt ? `, since ${formatTime(lockOwner.lockedAt)}` : ''}).
            </strong>
            <div>Please try again later to avoid data conflicts. This page checks again every 10 seconds.</div>
          </div>
        </Alert>
      )}

      {lockState === 'lost' && !problem && (
        <Alert variant="danger">Your edit session ended. Go back and open the contact again to continue editing.</Alert>
      )}

      {problem && (
        <Alert variant={problem.code === 'VERSION_CONFLICT' ? 'warning' : 'danger'} dismissible onClose={() => setProblem(null)}>
          <div>{problem.message}</div>
          {problem.code === 'VERSION_CONFLICT' && (
            <Button size="sm" variant="warning" className="mt-2" onClick={loadLatestVersion}>
              <i className="bi bi-arrow-clockwise me-1" /> Load the latest version (your unsaved changes will be lost)
            </Button>
          )}
        </Alert>
      )}

      <Card className="content-card">
        <Card.Body className="p-4">
          <ContactForm
            key={contact ? `${contact.id}-${contact.version}` : 'new'}
            formId={isNew ? 'add-contact' : 'edit-contact'}
            initialValues={contact}
            groupOptions={groupOptions}
            serverErrors={serverErrors}
            submitting={saving}
            disabled={lockState !== 'mine'}
            submitLabel={isNew ? 'Save' : 'Update'}
            onSubmit={handleSave}
            onCancel={handleCancel}
          />
        </Card.Body>
      </Card>
    </>
  );
}
