// The only file that talks to Firebase. These settings identify the project and are
// meant to be public: the Firestore rules are what keep each user's data private.
const firebaseConfig = {
  apiKey: 'AIzaSyBP2uycse-XYJRaBPMLFHvguET-MF8tCW0',
  authDomain: 'flowstate-7bc71.firebaseapp.com',
  projectId: 'flowstate-7bc71',
  storageBucket: 'flowstate-7bc71.firebasestorage.app',
  messagingSenderId: '902501680473',
  appId: '1:902501680473:web:c6717a4144e6fde93f3848',
};

const SDK = 'https://www.gstatic.com/firebasejs/13.2.0';

let authApi = null;
let firestoreApi = null;
let auth = null;
let db = null;

// Loaded separately so guests, and classes in progress, never wait on the network.
async function load() {
  if (auth) return;
  const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  authApi = authModule;
  firestoreApi = firestoreModule;
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);
}

function toUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? '',
    providers: user.providerData.map((provider) => provider.providerId),
  };
}

const classesOf = (uid) => firestoreApi.collection(db, 'users', uid, 'classes');
const classDoc = (uid, id) => firestoreApi.doc(db, 'users', uid, 'classes', encodeURIComponent(id));

export const backend = {
  async onAuth(callback) {
    await load();
    authApi.onAuthStateChanged(auth, (user) => callback(toUser(user)));
  },

  async signUp(email, password) {
    await load();
    await authApi.createUserWithEmailAndPassword(auth, email, password);
  },

  async signIn(email, password) {
    await load();
    await authApi.signInWithEmailAndPassword(auth, email, password);
  },

  async signInWithGoogle() {
    await load();
    await authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider());
  },

  async signOut() {
    await load();
    await authApi.signOut(auth);
  },

  async resetPassword(email) {
    await load();
    await authApi.sendPasswordResetEmail(auth, email);
  },

  // Account deletion requires a fresh sign-in, so a borrowed device can't do it.
  async confirmIdentity(password) {
    await load();
    const user = auth.currentUser;
    if (password) {
      const credential = authApi.EmailAuthProvider.credential(user.email, password);
      await authApi.reauthenticateWithCredential(user, credential);
    } else {
      await authApi.reauthenticateWithPopup(user, new authApi.GoogleAuthProvider());
    }
  },

  async deleteAccount(uid) {
    await load();
    const snapshot = await firestoreApi.getDocs(classesOf(uid));
    await Promise.all(snapshot.docs.map((item) => firestoreApi.deleteDoc(item.ref)));
    await authApi.deleteUser(auth.currentUser);
  },

  // Calls back with changed programs, leaving out changes still on their way to the
  // server. `fromServer` says whether this view has been confirmed by the server.
  subscribe(uid, callback, onError) {
    return firestoreApi.onSnapshot(
      classesOf(uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docChanges()
          .filter((change) => change.type !== 'removed' && !change.doc.metadata.hasPendingWrites)
          .map((change) => change.doc.data());
        callback(docs, { fromServer: !snapshot.metadata.fromCache });
      },
      onError,
    );
  },

  async put(uid, data) {
    await firestoreApi.setDoc(classDoc(uid, data.id), data);
  },
};
