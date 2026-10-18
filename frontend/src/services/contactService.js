// Contact Service - every call the app makes for contacts (CRUD, locks, history).
import api, { API_BASE_URL, userHeaders } from './api.js';

/** Drops empty values so URLs stay clean: { search: '', page: 2 } -> { page: 2 } */
function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined));
}

export const contactService = {
  // Read
  list: (params) => api.get('/contacts', { params: cleanParams(params) }).then((res) => res.data),
  get: (id) => api.get(`/contacts/${id}`).then((res) => res.data),
  history: (id) => api.get(`/contacts/${id}/history`).then((res) => res.data),
  filterOptions: () => api.get('/contacts/filter-options').then((res) => res.data),

  // Create / Update / Delete
  create: (contact) => api.post('/contacts', contact).then((res) => res.data),
  update: (id, contact) => api.put(`/contacts/${id}`, contact).then((res) => res.data),
  remove: (id) => api.delete(`/contacts/${id}`).then((res) => res.data),
  removeMany: (ids) => api.post('/contacts/batch-delete', { ids }).then((res) => res.data),

  // Edit locks
  lock: (id) => api.post(`/contacts/${id}/lock`).then((res) => res.data),
  unlock: (id) => api.delete(`/contacts/${id}/lock`).then((res) => res.data),

  /** Releases a lock while the page is closing ("keepalive" lets the request finish). */
  unlockWhilePageCloses(id) {
    fetch(`${API_BASE_URL}/contacts/${id}/lock`, { method: 'DELETE', headers: userHeaders(), keepalive: true }).catch(() => {});
  },
};
