import { NavLink } from 'react-router-dom';

const LINKS = [
  { to: '/contacts', icon: 'bi-person-rolodex', label: 'Contacts' },
  { to: '/upload', icon: 'bi-upload', label: 'Upload Contacts' },
  { to: '/export', icon: 'bi-box-arrow-up-right', label: 'Export' },
];

export default function AppLayout({ userName, onChangeName, children }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-icon">
            <i className="bi bi-people-fill" />
          </span>
          Contact Book
        </div>

        <nav className="app-nav">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
              <i className={`bi ${link.icon}`} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <button type="button" className="app-user" onClick={onChangeName} title="Change your name">
          <i className="bi bi-gear-fill" />
          <span className="text-truncate">{userName || 'Set your name'}</span>
        </button>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
