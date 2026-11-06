// Small shared helpers for building the interface.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const ICONS = {
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/>',
  back: '<path d="M5 5h2.5v14H5zM20 5v14L9 12z"/>',
  next: '<path d="M16.5 5H19v14h-2.5zM4 5v14l11-7z"/>',
  grip: '<path d="M8 5h3v3H8zM13 5h3v3h-3zM8 10.5h3v3H8zM13 10.5h3v3h-3zM8 16h3v3H8zM13 16h3v3h-3z"/>',
  chevron: '<path d="M9 5.5 15.5 12 9 18.5l-1.8-1.8 4.7-4.7-4.7-4.7z"/>',
};

// Icons are drawn so they look the same everywhere. Phones turn text symbols like these into emoji.
export function icon(name) {
  const el = h('span', { class: 'icon', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS[name]}</svg>`;
  return el;
}

const toastEl = () => document.getElementById('toast');
let toastTimer = null;

export function showToast(message, undo) {
  const el = toastEl();
  clearTimeout(toastTimer);
  el.replaceChildren(h('span', {}, message));
  if (undo) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-undo',
      onclick: () => {
        undo();
        el.hidden = true;
      },
    }, 'Undo'));
  }
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 8000 : 4000);
}

// Resolves true if confirmed. Escape or the cancel button resolves false.
export function confirmDialog({ title, body = [], confirmLabel, cancelLabel = 'Cancel', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const finish = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(
      h('h2', { class: 'dialog-title' }, title),
      ...body.map((line) => h('p', { class: 'dialog-body' }, line)),
      extra ?? '',
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => finish(false) }, cancelLabel),
        h('button', {
          type: 'button',
          class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`,
          onclick: () => finish(true),
        }, confirmLabel)),
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
