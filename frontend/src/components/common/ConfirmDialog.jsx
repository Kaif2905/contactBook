// "Are you sure?" pop-up used before deleting.
import { Button, Modal, Spinner } from 'react-bootstrap';

export default function ConfirmDialog({ show, title, children, confirmLabel = 'Delete', variant = 'danger', busy = false, onConfirm, onCancel }) {
  return (
    <Modal show={show} onHide={() => !busy && onCancel()} centered>
      <Modal.Header closeButton={!busy}>
        <Modal.Title as="h5">{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={variant} onClick={onConfirm} disabled={busy}>
          {busy && <Spinner animation="border" size="sm" className="me-2" />}
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
