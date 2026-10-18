// An error that already knows which HTTP status to send back.
// Example: throw new HttpError(404, 'Contact not found');
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra; // additional JSON fields, e.g. { code: 'DUPLICATE', fieldErrors: {...} }
  }
}

/** Reads a positive whole number from a URL parameter, or throws 400. */
export function parseId(value, label = 'contact id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `Invalid ${label}: "${value}"`);
  }
  return id;
}
