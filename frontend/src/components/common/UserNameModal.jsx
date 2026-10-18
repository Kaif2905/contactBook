// Asks for the user's name the first time the app opens.
// The name is shown to others when you are editing a contact and is saved in the change history.
import { useEffect, useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';

export default function UserNameModal({ show, initialName, canClose, onSave, onClose }) {
  const [name, setName] = useState(initialName || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) {
      setName(initialName || '');
      setError('');
    }
  }, [show, initialName]);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your name.');
      return;
    }
    onSave(trimmed);
  }

  return (
    <Modal show={show} onHide={() => canClose && onClose()} backdrop={canClose ? true : 'static'} keyboard={canClose} centered>
      <Form noValidate onSubmit={handleSubmit}>
        <Modal.Header closeButton={canClose}>
          <Modal.Title as="h5">{canClose ? 'Change your name' : 'Welcome! What is your name?'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            Your name is shown to other people while you are editing a contact, and it is saved in the change history.
            No password is needed.
          </p>
          <Form.Group controlId="user-name">
            <Form.Label>Your name</Form.Label>
            <Form.Control
              autoFocus
              value={name}
              maxLength={50}
              placeholder="e.g. Priya Sharma"
              isInvalid={Boolean(error)}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit">Continue</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
