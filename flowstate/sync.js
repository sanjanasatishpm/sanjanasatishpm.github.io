// Keeps this device and the signed-in account in step. Programs always save on the device
// first, so nothing here can slow down editing or interrupt a class.
import { applyRemote, isBlankClass, normalizeRemote, pendingChanges } from './core.js';

const STATE_KEY = 'flowstate.sync';
const DEBOUNCE_MS = 2000;
const RETRY_MS = 30000;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (saved && typeof saved.uid === 'string' && saved.synced && typeof saved.synced === 'object') return saved;
  } catch {
    // Fall through to a clean state.
  }
  return { uid: null, synced: {} };
}

export function createSync({ backend, getClasses, setClasses, getProtectedIds, onStatus, onRemoteChange, onNotice }) {
  let state = loadState();
  let user = null;
  let available = true;
  let ready = false;
  let failed = false;
  let guestPrograms = 0;
  let unsubscribe = null;
  let timer = null;
  const inFlight = new Map();
  const deferred = new Map();

  const saveState = () => {
    if (state.uid) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
  };

  const pending = () => pendingChanges(getClasses(), state.synced);
  const pendingCount = () => {
    const { upserts, deletes } = pending();
    return upserts.length + deletes.length;
  };

  function statusLabel() {
    if (!state.uid) return 'Guest mode: not saved';
    if (!user) return 'Sign in to sync';
    if (!navigator.onLine) return 'Saved. Waiting for connection';
    if (failed) return 'Saved. Couldn’t sync yet';
    if (!ready || inFlight.size || pendingCount()) return 'Syncing…';
    return 'Synced';
  }

  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    onStatus();
  }

  function send(uid, id, data, stamp, onDone) {
    inFlight.set(id, stamp);
    backend.put(uid, data).then(() => {
      if (inFlight.get(id) === stamp) inFlight.delete(id);
      if (state.uid !== uid) return;
      onDone();
      failed = false;
      saveState();
      onStatus();
    }).catch(() => {
      if (inFlight.get(id) === stamp) inFlight.delete(id);
      failed = true;
      onStatus();
      schedule(RETRY_MS);
    });
  }

  function flush() {
    if (!user || !ready || !navigator.onLine) {
      onStatus();
      return;
    }
    const uid = user.uid;
    const { upserts, deletes } = pending();
    for (const cls of upserts) {
      if (inFlight.get(cls.id) === cls.updatedAt) continue;
      const stamp = cls.updatedAt;
      send(uid, cls.id, JSON.parse(JSON.stringify(cls)), stamp, () => {
        state.synced[cls.id] = stamp;
      });
    }
    const now = Date.now();
    for (const id of deletes) {
      if (inFlight.has(id)) continue;
      send(uid, id, { id, deleted: true, updatedAt: now }, now, () => {
        delete state.synced[id];
      });
    }
    onStatus();
  }

  function applyDocs(docs) {
    const result = applyRemote(
      { classes: getClasses(), synced: state.synced, protectedIds: getProtectedIds() },
      docs,
    );
    state.synced = result.synced;
    for (const doc of result.deferred) deferred.set(doc.id, doc);
    if (result.changed) {
      setClasses(result.classes);
      onRemoteChange();
    }
    for (const name of result.replaced) {
      onNotice(`A newer version of ${name} from another device replaced the existing one.`);
    }
    saveState();
  }

  function onSnapshot(rawDocs, { fromServer }) {
    applyDocs(rawDocs.map(normalizeRemote).filter(Boolean));
    if (fromServer && !ready) {
      ready = true;
      if (guestPrograms) {
        onNotice(`${guestPrograms} ${guestPrograms === 1 ? 'program' : 'programs'} moved into your account.`);
        guestPrograms = 0;
      }
    }
    schedule(ready ? 0 : DEBOUNCE_MS);
  }

  function clearLocal() {
    state = { uid: null, synced: {} };
    saveState();
    deferred.clear();
    inFlight.clear();
    setClasses([]);
    localStorage.removeItem('flowstate.run');
    onRemoteChange();
  }

  function stopListening() {
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(timer);
    ready = false;
    failed = false;
  }

  function handleAuth(nextUser) {
    stopListening();
    user = nextUser;
    if (user) {
      // Leftovers from someone else's account must never reach this one.
      if (state.uid && state.uid !== user.uid) clearLocal();
      if (!state.uid) {
        guestPrograms = getClasses().filter((c) => !isBlankClass(c)).length;
        state.uid = user.uid;
        saveState();
        // A guest's in-progress program becomes this account's, so it's stored from here on.
        setClasses(getClasses());
      }
      unsubscribe = backend.subscribe(user.uid, onSnapshot, () => {
        failed = true;
        onStatus();
      });
    }
    onStatus();
    onRemoteChange();
  }

  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', onStatus);

  backend.onAuth(handleAuth).catch(() => {
    // Firebase couldn't load, usually no connection. The app carries on from this device.
    available = false;
    onStatus();
  });

  return {
    statusLabel,
    hasAccount: () => Boolean(state.uid),
    getUser: () => user,
    isAvailable: () => available,
    unsyncedCount: () => (state.uid ? pendingCount() : 0),
    localChanged: () => {
      if (state.uid) schedule();
    },
    // Newer versions that waited because their program was open can land now.
    routeChanged: () => {
      if (!deferred.size) return;
      const docs = [...deferred.values()];
      deferred.clear();
      applyDocs(docs);
      schedule();
    },
    async signOut() {
      stopListening();
      user = null;
      await backend.signOut();
      clearLocal();
    },
    async deleteAccount() {
      const current = user;
      stopListening();
      try {
        await backend.deleteAccount(current.uid);
      } catch (error) {
        handleAuth(current);
        throw error;
      }
      user = null;
      clearLocal();
    },
  };
}
