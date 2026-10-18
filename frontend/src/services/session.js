// Who is using the app?
//  - userName:  typed once, remembered in this browser (localStorage)
//  - sessionId: new for every opened tab/page load. The server uses it to tell
//               two editors apart, even if both have the same name.
const NAME_KEY = 'contactBook.userName';

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const sessionId = makeId();

export function getSessionId() {
  return sessionId;
}

export function getUserName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return ''; // storage blocked (private mode) - the app still works
  }
}

export function saveUserName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore - the name just won't be remembered next time
  }
}
