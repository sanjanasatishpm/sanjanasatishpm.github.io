// Sign-up, sign-in, password reset and account management screens.
import { backend } from './backend.js';
import { confirmDialog, h, showToast } from './ui.js';

const MIN_PASSWORD = 8;

function friendlyError(error) {
  switch (error?.code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.';
    case 'auth/invalid-email':
      return 'That doesn’t look like a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return `Choose a stronger password of at least ${MIN_PASSWORD} characters.`;
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don’t match.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups or use email instead.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/unauthorized-domain':
      return 'Sign-in isn’t set up for this web address yet.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method isn’t turned on yet.';
    case 'auth/requires-recent-login':
      return 'Please sign in again, then try once more.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function backLink() {
  return h('nav', { class: 'editor-nav' }, h('a', { class: 'back', href: '#/' }, '‹ Programs'));
}

function renderSignedOut(app, sync, startMode) {
  let mode = startMode;
  const root = h('div', { class: 'account' });

  const draw = () => {
    const isSignUp = mode === 'signup';
    const isReset = mode === 'reset';
    const message = h('p', { class: 'form-message', role: 'alert', hidden: true });
    const showMessage = (text, good = false) => {
      message.textContent = text ?? '';
      message.hidden = !text;
      message.classList.toggle('form-message-good', good);
    };

    const email = h('input', {
      class: 'input', type: 'email', name: 'email', autocomplete: 'email', required: true, inputmode: 'email',
    });
    const password = isReset ? null : h('input', {
      class: 'input', type: 'password', name: 'password', required: true,
      autocomplete: isSignUp ? 'new-password' : 'current-password',
      minlength: isSignUp ? String(MIN_PASSWORD) : undefined,
    });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-large' },
      isReset ? 'Send reset email' : isSignUp ? 'Create account' : 'Sign in');

    // The form stays usable after an error, and the screen moves on once sign-in lands.
    const busy = async (button, action) => {
      showMessage(null);
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        showMessage(friendlyError(error));
      } finally {
        button.disabled = false;
      }
    };

    const form = h('form', {
      class: 'account-form',
      onsubmit: (event) => {
        event.preventDefault();
        const address = email.value.trim();
        if (isSignUp && password.value.length < MIN_PASSWORD) {
          showMessage(`Use at least ${MIN_PASSWORD} characters for your password.`);
          return;
        }
        busy(submit, async () => {
          if (isReset) {
            await backend.resetPassword(address);
            showMessage('If that email has an account, a reset link is on its way.', true);
          } else if (isSignUp) {
            await backend.signUp(address, password.value);
          } else {
            await backend.signIn(address, password.value);
          }
        });
      },
    },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Email'), email),
      password ? h('label', { class: 'field' },
        h('span', { class: 'field-label' }, isSignUp ? `Password (at least ${MIN_PASSWORD} characters)` : 'Password'),
        password) : null,
      message,
      submit);

    const google = h('button', { type: 'button', class: 'btn btn-quiet btn-large' }, 'Continue with Google');
    google.addEventListener('click', () => busy(google, () => backend.signInWithGoogle()));

    const link = (label, target) => h('button', {
      type: 'button', class: 'text-button',
      onclick: () => { mode = target; draw(); },
    }, label);

    root.replaceChildren(
      backLink(),
      h('h1', { class: 'account-title' }, isReset ? 'Reset your password' : isSignUp ? 'Create your account' : 'Welcome back'),
      h('p', { class: 'account-lead' }, isReset
        ? 'Enter your email and we’ll send you a link.'
        : 'Save your programs and use them on every device. Anything you’re building right now comes with you.'),
      sync.isAvailable() ? '' : h('p', { class: 'form-message' }, 'Sign-in can’t load right now. Check your connection. You can keep using FlowState on this device.'),
      form,
      isReset ? '' : h('div', { class: 'account-divider' }, h('span', {}, 'or')),
      isReset ? '' : google,
      h('div', { class: 'account-links' },
        isSignUp ? link('Already have an account? Sign in', 'signin') : null,
        mode === 'signin' ? link('New here? Create an account', 'signup') : null,
        mode === 'signin' ? link('Forgot your password?', 'reset') : null,
        isReset ? link('Back to sign in', 'signin') : null),
    );
  };

  draw();
  app.replaceChildren(root);
}

function renderSignedIn(app, sync, user) {
  const signOut = async () => {
    const unsynced = sync.unsyncedCount();
    const leave = await confirmDialog({
      title: 'Sign out?',
      body: [
        unsynced
          ? `${unsynced} ${unsynced === 1 ? 'change hasn’t' : 'changes haven’t'} synced yet and will be lost if you sign out now.`
          : 'Your programs stay in your account and are removed from this device until you sign in again.',
      ],
      confirmLabel: 'Sign out',
      danger: unsynced > 0,
    });
    if (!leave) return;
    try {
      await sync.signOut();
      location.hash = '#/';
      showToast('Signed out.');
    } catch (error) {
      showToast(friendlyError(error) ?? 'Couldn’t sign out. Please try again.');
    }
  };

  const deleteAccount = async () => {
    const usesPassword = user.providers.includes('password');
    const password = usesPassword ? h('input', {
      class: 'input', type: 'password', autocomplete: 'current-password',
    }) : null;
    const go = await confirmDialog({
      title: 'Delete your account?',
      body: ['This permanently deletes your account and every program in it, on all your devices. It can’t be undone.'],
      extra: usesPassword
        ? h('label', { class: 'field dialog-test' }, h('span', { class: 'field-label' }, 'Enter your password to confirm'), password)
        : h('p', { class: 'dialog-body' }, 'You’ll confirm with Google in the next step.'),
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!go) return;
    try {
      await backend.confirmIdentity(usesPassword ? password.value : null);
      await sync.deleteAccount();
      location.hash = '#/';
      showToast('Your account and programs have been deleted.');
    } catch (error) {
      const text = friendlyError(error);
      if (text) showToast(text);
    }
  };

  app.replaceChildren(h('div', { class: 'account' },
    backLink(),
    h('h1', { class: 'account-title' }, 'Your account'),
    h('section', { class: 'account-card' },
      h('p', { class: 'field-label' }, 'Signed in as'),
      h('p', { class: 'account-email' }, user.email),
      h('p', { class: 'saved' }, sync.statusLabel())),
    h('div', { class: 'account-actions' },
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: signOut }, 'Sign out'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-danger', onclick: deleteAccount }, 'Delete account'))));
}

export function renderAccount(app, sync, mode = 'signup') {
  document.title = 'Account · FlowState';
  const user = sync.getUser();
  if (user) renderSignedIn(app, sync, user);
  else renderSignedOut(app, sync, mode);
}
