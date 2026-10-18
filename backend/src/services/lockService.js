// ---------------------------------------------------------------------------
// Edit locks - stop two people from editing the same contact at once.
//
// How it works:
//   1. When someone clicks "Edit", the browser asks for a lock.
//   2. While the edit form is open, the browser renews the lock every 30 seconds.
//   3. Anyone else who tries to edit (or delete) gets "X is editing this contact".
//   4. The lock is removed on Save/Cancel, or it simply expires if the tab is closed.
//
// A "user" here is { sessionId, name }. Each browser tab has its own sessionId.
// ---------------------------------------------------------------------------
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';

/** Returns the lock on a contact if it has not expired yet, otherwise null. */
export async function getActiveLock(contactId, db = pool) {
  const [rows] = await db.query(
    `SELECT session_id AS sessionId, user_name AS userName, locked_at AS lockedAt, expires_at AS expiresAt
       FROM contact_edit_locks
      WHERE contact_id = ? AND expires_at > NOW()`,
    [contactId],
  );
  return rows[0] || null;
}

/** Throws 409 if someone ELSE is editing this contact right now. */
export async function assertNotLockedByOthers(contactId, user, db = pool) {
  const lock = await getActiveLock(contactId, db);
  if (lock && lock.sessionId !== user.sessionId) {
    throw new HttpError(409, `${lock.userName} is editing this contact right now. Please try again in a moment.`, {
      code: 'CONTACT_LOCKED',
      lock: { userName: lock.userName, lockedAt: lock.lockedAt },
    });
  }
}

/** Takes (or renews) the edit lock for this user. */
export async function acquireLock(contactId, user) {
  return withTransaction(async (connection) => {
    // Locking the contact row makes two simultaneous "Edit" clicks wait for each other.
    const [contacts] = await connection.query('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [contactId]);
    if (contacts.length === 0) throw new HttpError(404, 'Contact not found');

    await assertNotLockedByOthers(contactId, user, connection);
    const myLock = await getActiveLock(contactId, connection);

    if (myLock) {
      // We already hold it - this is a heartbeat, just push the expiry time forward.
      await connection.query(
        'UPDATE contact_edit_locks SET expires_at = NOW() + INTERVAL ? SECOND WHERE contact_id = ?',
        [config.editLockSeconds, contactId],
      );
    } else {
      // Nobody holds it (or the old lock expired) - remove leftovers and write ours.
      await connection.query('DELETE FROM contact_edit_locks WHERE contact_id = ?', [contactId]);
      await connection.query(
        `INSERT INTO contact_edit_locks (contact_id, session_id, user_name, locked_at, expires_at)
         VALUES (?, ?, ?, NOW(), NOW() + INTERVAL ? SECOND)`,
        [contactId, user.sessionId, user.name, config.editLockSeconds],
      );
    }

    return { contactId, userName: user.name, expiresInSeconds: config.editLockSeconds };
  });
}

/** Removes the lock, but only if this user owns it. */
export async function releaseLock(contactId, user) {
  await pool.query('DELETE FROM contact_edit_locks WHERE contact_id = ? AND session_id = ?', [
    contactId,
    user.sessionId,
  ]);
}
