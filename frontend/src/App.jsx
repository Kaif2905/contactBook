import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/common/AppLayout.jsx';
import UserNameModal from './components/common/UserNameModal.jsx';
import Contacts from './components/contacts/Contacts.jsx';
import ContactDetail from './components/contacts/ContactDetail.jsx';
import ContactEditor from './components/contacts/ContactEditor.jsx';
import Upload from './components/upload/Upload.jsx';
import ExportContacts from './components/export/ExportContacts.jsx';
import { getUserName, saveUserName } from './services/session.js';

function NotFound() {
  return (
    <div className="text-center py-5">
      <h1 className="h4">Page not found</h1>
      <Link to="/contacts">Go to contacts</Link>
    </div>
  );
}

export default function App() {
  const [userName, setUserName] = useState(getUserName());
  const [askForName, setAskForName] = useState(!getUserName());

  function handleNameSaved(name) {
    saveUserName(name);
    setUserName(name);
    setAskForName(false);
  }

  return (
    <AppLayout userName={userName} onChangeName={() => setAskForName(true)}>
      <Routes>
        <Route path="/" element={<Navigate to="/contacts" replace />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/new" element={<ContactEditor key="new" />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/contacts/:id/edit" element={<ContactEditor key="edit" />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/export" element={<ExportContacts />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <UserNameModal
        show={askForName}
        initialName={userName}
        canClose={Boolean(userName)}
        onSave={handleNameSaved}
        onClose={() => setAskForName(false)}
      />
    </AppLayout>
  );
}
