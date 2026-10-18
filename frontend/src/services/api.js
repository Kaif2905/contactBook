// One configured axios instance used by all services.
import axios from 'axios';
import { getSessionId, getUserName } from './session.js';

// "/api" works in development (Vite forwards it to the backend) and when the
// backend serves the built app. Set VITE_API_URL only if they live on different domains.
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** Headers that tell the server which user/tab is making the request. */
export function userHeaders() {
  return {
    'X-Session-Id': getSessionId(),
    'X-User-Name': encodeURIComponent(getUserName() || 'Unknown user'),
  };
}

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  for (const [name, value] of Object.entries(userHeaders())) {
    config.headers[name] = value;
  }
  return config;
});

/** Turns any failed request into a sentence we can show to the user. */
export function getErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (data && typeof data === 'object' && data.message) return data.message;
  if (error?.response) return `${fallback} (server answered ${error.response.status})`;
  if (error?.request) return 'Cannot reach the server. Is the backend running (npm run dev in the backend folder)?';
  return error?.message || fallback;
}

export default api;
