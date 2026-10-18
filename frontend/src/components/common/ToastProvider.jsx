// Small pop-up messages ("Contact saved") in the top-right corner.
import { createContext, useCallback, useContext, useState } from 'react';
import { Toast, ToastContainer } from 'react-bootstrap';

const ToastContext = createContext(() => {});

const ICONS = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, variant = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list, { id, message, variant }]);
  }, []);

  const closeToast = (id) => setToasts((list) => list.filter((toast) => toast.id !== id));

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <ToastContainer position="top-end" containerPosition="fixed" className="p-3" style={{ zIndex: 2000 }}>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            bg={toast.variant}
            onClose={() => closeToast(toast.id)}
            delay={toast.variant === 'danger' ? 8000 : 4000}
            autohide
          >
            <Toast.Body className={`d-flex align-items-start gap-2 ${toast.variant === 'warning' ? 'text-dark' : 'text-white'}`}>
              <i className={`bi ${ICONS[toast.variant] || ICONS.info}`} />
              <span className="flex-grow-1">{toast.message}</span>
              <button
                type="button"
                className={`btn-close ${toast.variant === 'warning' ? '' : 'btn-close-white'}`}
                aria-label="Close"
                onClick={() => closeToast(toast.id)}
              />
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
