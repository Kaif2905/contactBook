// Excel Service - file checks, upload/import calls and Excel downloads (export, error report).
import api from './api.js';

export const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 100;
export const ACCEPTED_FILE_TYPES = '.xlsx,.xls,.csv';

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Quick format check in the browser, before uploading anything.
 * Returns an error message, or null when the file looks fine.
 * (The server checks again - never trust only the browser.)
 */
export async function checkFile(file) {
  if (!file) return 'Please choose a file.';
  const name = file.name.toLowerCase();

  if (!['.xlsx', '.xls', '.csv'].some((extension) => name.endsWith(extension))) {
    return 'Only Excel (.xlsx, .xls) and CSV (.csv) files can be uploaded.';
  }
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `The file is ${formatBytes(file.size)}. The largest file allowed is ${MAX_UPLOAD_MB} MB.`;
  }
  if (name.endsWith('.xlsx')) {
    // Real .xlsx files are ZIP archives, which always start with the letters "PK"
    const firstBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (firstBytes[0] !== 0x50 || firstBytes[1] !== 0x4b) {
      return 'This is not a real Excel file. It may be password-protected, or a different file renamed to .xlsx.';
    }
  }
  return null;
}

/** Reads the file name out of a "Content-Disposition: attachment; filename=..." header. */
function fileNameFromHeader(header) {
  const match = /filename="?([^";]+)"?/i.exec(header || '');
  return match ? match[1] : null;
}

/** Makes the browser download a Blob as a file. */
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Downloads a file from the API. Returns the file name. */
async function downloadFile(method, url, body) {
  try {
    const response = await api.request({ method, url, data: body, responseType: 'blob' });
    const fileName = fileNameFromHeader(response.headers['content-disposition']) || 'download.xlsx';
    saveBlob(response.data, fileName);
    return fileName;
  } catch (error) {
    // With responseType "blob", error messages also arrive as a Blob - turn it back into JSON
    if (error.response?.data instanceof Blob) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        // not JSON - keep the generic message
      }
    }
    throw error;
  }
}

export const excelService = {
  /** Sends the file to the server. onProgress(percent) is called while uploading. */
  upload(file, onProgress) {
    const form = new FormData();
    form.append('file', file);
    return api
      .post('/contacts/upload', form, {
        onUploadProgress: (event) => {
          if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
        },
      })
      .then((res) => res.data);
  },

  getUpload: (uploadId) => api.get(`/contacts/upload/${uploadId}`).then((res) => res.data),
  validate: (uploadId, mapping) => api.post(`/contacts/upload/${uploadId}/validate`, { mapping }).then((res) => res.data),
  getErrors: (uploadId, page, limit) =>
    api.get(`/contacts/upload/${uploadId}/errors`, { params: { page, limit } }).then((res) => res.data),
  startImport: (uploadId) => api.post(`/contacts/upload/${uploadId}/import`).then((res) => res.data),
  cancel: (uploadId) => api.delete(`/contacts/upload/${uploadId}`).catch(() => {}),

  downloadErrorReport: (uploadId) => downloadFile('get', `/contacts/upload/${uploadId}/error-report`),
  downloadTemplate: () => downloadFile('get', '/contacts/template'),

  /** options: { fields, ids?, filters?, sortBy, sortOrder } */
  exportContacts: (options) =>
    downloadFile('post', '/contacts/export', {
      ...options,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // dates in the user's own time
    }),
};
