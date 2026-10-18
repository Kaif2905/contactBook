// Small display helpers.

/** "12 Oct 2026" in the user's own time zone */
export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "12 Oct 2026 10:30 AM" */
export function formatDateTime(value) {
  if (!value) return '';
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** "Amit Sharma" -> "AS" (for the round avatar) */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

/** "02:30 PM" */
export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** 1234567 -> "1,234,567" */
export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

/** "1 contact" / "5 contacts" */
export function plural(count, word) {
  return `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`;
}
