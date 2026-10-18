import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import App from './App.jsx';
import { ToastProvider } from './components/common/ToastProvider.jsx';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>,
);
