import {
  DISCIPLINES, SUGGESTIONS, buildTimeline, clampSeconds, createBlock, createClass, createCue,
  createRun, disciplineLabel, duplicateBlock, duplicateClass, formatTime, mergeLibraries, moveBlock,
  normalizeLibrary, restoreRun, resumeRun, runView, startCheck, timingStatus,
} from './core.js';
import { renderAccount } from './account.js';
import { testAlert, unlockAudio } from './alerts.js';
import { backend } from './backend.js';
import { mountPlayer } from './player.js';
import { createSync } from './sync.js';
import { confirmDialog, h, icon, showToast } from './ui.js';

const STORAGE_KEY = 'flowstate.library';
const OLD_STORAGE_KEY = 'cuesheet.library';
const RUN_KEY = 'flowstate.run';
const DURATION_PRESETS = [30, 45, 60, 75];

// The PRD moves music cues to a future phase. Any cues already saved are kept, just not shown.
const MUSIC_ENABLED = false;

const app = document.getElementById('app');

let library = loadLibrary();
let expandedId = null;
let pendingFocus = null;
let player = null;
let sync = null;
let guestRun = null;
let currentHash = location.hash;

/* ---------- Storage ---------- */

function deviceHasAccount() {
  try {
    return typeof JSON.parse(localStorage.getItem('flowstate.sync'))?.uid === 'string';
  } catch {
    return false;
  }
}

// Only accounts keep programs. A guest's work lives in memory and is gone when they leave.
function loadLibrary() {
  if (!deviceHasAccount()) {
    for (const key of [STORAGE_KEY, OLD_STORAGE_KEY, RUN_KEY]) localStorage.removeItem(key);
    return normalizeLibrary(null);
  }
  try {
    return normalizeLibrary(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeLibrary(null);
  }
}

const isGuest = () => !sync?.hasAccount();

function writeLibrary() {
  if (isGuest()) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    showToast('Couldn’t save on this device. Your storage may be full.');
  }
}

function persist() {
  writeLibrary();
  sync?.localChanged();
}

function rawRun() {
  try {
    return JSON.parse(isGuest() ? guestRun : localStorage.getItem(RUN_KEY));
  } catch {
    return null;
  }
}

function loadRun() {
  return restoreRun(rawRun());
}

function saveRun(run) {
  if (isGuest()) {
    guestRun = JSON.stringify(run);
    return;
  }
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    // The class keeps running. Only the resume point is affected.
  }
}

function clearRun() {
  guestRun = null;
  localStorage.removeItem(RUN_KEY);
}

function discardGuestWork() {
  library.classes = [];
  guestRun = null;
}

const guestHasProgram = () => isGuest() && library.classes.some((c) => c.name.trim() || c.blocks.length);

// Editing a program ends any paused run of it, because that run follows the old plan.
function touch(cls) {
  cls.updatedAt = Date.now();
  persist();
  if (loadRun()?.classId === cls.id) clearRun();
}

function findClass(id) {
  return library.classes.find((c) => c.id === id);
}

const classHref = (id) => `#/class/${encodeURIComponent(id)}`;
const runHref = (id) => `#/run/${encodeURIComponent(id)}`;

/* ---------- Shared pieces ---------- */

function digits(value) {
  return value.replace(/\D/g, '').slice(0, 4);
}

// Paired minute and second boxes. Typing 90 in seconds tidies to 1:30 on leaving the field.
function timeField({ legend, seconds, onChange }) {
  const minutes = h('input', {
    class: 'time-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
    'aria-label': `${legend}, minutes`,
  });
  const secs = h('input', {
    class: 'time-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
    'aria-label': `${legend}, seconds`,
  });
  const show = (total) => {
    minutes.value = String(Math.floor(total / 60));
    secs.value = String(total % 60).padStart(2, '0');
  };
  const read = () => clampSeconds(Number(minutes.value || 0) * 60 + Number(secs.value || 0));
  show(seconds);
  for (const input of [minutes, secs]) {
    input.addEventListener('input', (event) => {
      event.target.value = digits(event.target.value);
      onChange(read());
    });
    input.addEventListener('change', () => show(read()));
    input.addEventListener('focus', () => input.select());
  }
  const el = h('div', { class: 'time-field' },
    minutes, h('span', { class: 'unit' }, 'min'), secs, h('span', { class: 'unit' }, 'sec'));
  el.setSeconds = show;
  return el;
}

function ribbon(cls) {
  const { total, target } = timingStatus(cls);
  const span = Math.max(total, target, 1);
  const pct = (value) => `${(value / span) * 100}%`;
  const parts = [];
  for (const { block, start, cues } of buildTimeline(cls)) {
    if (block.seconds > 0) {
      parts.push(h('span', {
        class: `seg seg-${block.type}`,
        style: `left:${pct(start)};width:${pct(block.seconds)}`,
      }));
    }
    if (MUSIC_ENABLED && cls.musicEnabled) {
      for (const { at, pastEnd } of cues) {
        if (!pastEnd) parts.push(h('span', { class: 'tick', style: `left:${pct(at)}` }));
      }
    }
  }
  if (target > 0 && total > target) {
    parts.push(h('span', { class: 'target-line', style: `left:${pct(target)}` }));
  }
  return h('div', { class: 'ribbon', 'aria-hidden': 'true' }, parts);
}

// A paused or stopped class can be picked up again from either screen.
function resumeBanner(onlyClassId = null) {
  const run = loadRun();
  if (!run || (onlyClassId && run.classId !== onlyClassId) || !findClass(run.classId)) return null;
  const view = runView(run, Date.now());
  if (view.done) return null;
  return h('section', { class: 'resume', 'aria-label': 'Unfinished class' },
    h('p', { class: 'resume-text' },
      h('strong', {}, run.className.trim() || 'Untitled program'),
      h('span', {}, ` stopped with ${formatTime(Math.ceil(view.classRemainingMs / 1000))} left`)),
    h('div', { class: 'resume-actions' },
      h('button', {
        type: 'button', class: 'btn btn-quiet',
        onclick: () => { clearRun(); render(); },
      }, 'Discard'),
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          unlockAudio();
          resumeRun(run, Date.now());
          saveRun(run);
          location.hash = runHref(run.classId);
        },
      }, 'Resume')));
}

/* ---------- Home ---------- */

function renderHome() {
  document.title = 'FlowState';
  if (isGuest()) discardGuestWork();
  const classes = [...library.classes].sort((a, b) => b.updatedAt - a.updatedAt);

  const user = sync.getUser();
  const topBar = h('div', { class: 'home-top' },
    h('p', { class: 'wordmark' }, 'FlowState'),
    h('a', { class: 'account-link', href: '#/account' }, user ? 'Account' : 'Sign up or sign in'));

  const header = h('header', { class: 'home-header' },
    h('h1', { class: 'home-title' }, classes.length ? 'Your programs' : 'Plan it. Press start. Teach.'),
    classes.length ? h('button', { type: 'button', class: 'btn btn-primary', onclick: newClass }, 'New program') : null);

  const body = classes.length
    ? h('ul', { class: 'class-list' }, classes.map(classCard))
    : h('section', { class: 'empty' },
        h('p', {}, 'Map out your class, see the time add up as you go, then run it with a timer you can read from across the room. For Pilates, strength, yoga, cycling, barre, HIIT and whatever else you teach.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: newClass }, 'Build your first class'));

  const importInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'import-file', onchange: importLibrary,
  });
  const footer = isGuest()
    ? h('footer', { class: 'home-footer' },
        h('p', {}, 'Try FlowState without an account: build a class and run it. Create a free account to save your programs.'))
    : h('footer', { class: 'home-footer' },
        h('p', {}, user
          ? `Signed in as ${user.email}. You can also export a copy of your programs as a backup.`
          : 'Sign in to sync your programs. You can also export a copy as a backup.'),
        h('div', { class: 'footer-actions' },
          h('button', { type: 'button', class: 'btn btn-quiet', disabled: !classes.length, onclick: exportLibrary }, 'Export programs'),
          importInput,
          h('label', { class: 'btn btn-quiet', for: 'import-file' }, 'Import programs')));

  app.replaceChildren(h('div', { class: 'home' }, topBar, header, resumeBanner(), body, footer));
}

function classCard(cls) {
  const status = timingStatus(cls);
  const check = startCheck(cls);
  const blocks = cls.blocks.length;
  return h('li', { class: 'class-card', 'data-type': cls.discipline || 'none' },
    h('a', { class: 'card-link', href: classHref(cls.id) },
      h('span', { class: 'card-top' },
        h('span', { class: 'type-pill' }, disciplineLabel(cls) || 'Class'),
        h('span', { class: 'card-blocks' }, `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`)),
      h('span', { class: 'card-name' }, cls.name || 'Untitled program'),
      h('span', { class: 'card-time' }, formatTime(status.total)),
      h('span', { class: `card-status status-${status.state}` }, status.label)),
    ribbon(cls),
    h('div', { class: 'card-actions' },
      h('button', {
        type: 'button', class: 'btn btn-primary btn-small', disabled: !check.ok,
        onclick: () => startClass(cls),
      }, icon('play'), 'Start'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => copyClass(cls, false) }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small btn-danger', onclick: () => deleteClass(cls) }, 'Delete')));
}

function newClass() {
  const cls = createClass();
  library.classes.push(cls);
  persist();
  pendingFocus = '.class-name';
  location.hash = classHref(cls.id);
}

function exportLibrary() {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `flowstate-programs-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importLibrary(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed?.classes)) throw new Error('not a FlowState file');
    const incoming = normalizeLibrary(parsed);
    const before = JSON.stringify(library);
    const { library: merged, added, updated, skipped } = mergeLibraries(library, incoming);
    library = merged;
    persist();
    render();
    const parts = [`${added} added`, `${updated} updated`];
    if (skipped) parts.push(`${skipped} already up to date`);
    showToast(`Import finished: ${parts.join(', ')}.`, () => {
      library = normalizeLibrary(JSON.parse(before));
      persist();
      render();
    });
  } catch {
    event.target.value = '';
    showToast('That file isn’t a FlowState export, so nothing was imported.');
  }
}

function copyClass(cls, openCopy = true) {
  const copy = duplicateClass(cls);
  library.classes.push(copy);
  persist();
  if (openCopy) {
    expandedId = null;
    pendingFocus = '.class-name';
    location.hash = classHref(copy.id);
    showToast('Duplicated. You’re now editing the copy.');
  } else {
    render();
    showToast(`Duplicated ${cls.name.trim() || 'program'}.`);
  }
}

function deleteClass(cls) {
  const position = library.classes.findIndex((c) => c.id === cls.id);
  library.classes.splice(position, 1);
  persist();
  if (loadRun()?.classId === cls.id) clearRun();
  if (location.hash === '#/') render();
  else location.hash = '#/';
  if (isGuest()) {
    showToast(`Deleted ${cls.name.trim() || 'untitled program'}.`);
    return;
  }
  showToast(`Deleted ${cls.name.trim() || 'untitled program'}.`, () => {
    library.classes.splice(position, 0, cls);
    cls.updatedAt = Date.now();
    persist();
    render();
  });
}

/* ---------- Start ---------- */

async function startClass(cls) {
  const check = startCheck(cls);
  if (!check.ok) {
    showToast(check.message);
    return;
  }
  unlockAudio();
  const start = await confirmDialog({
    title: `Ready to start${cls.name.trim() ? ` ${cls.name.trim()}` : ''}?`,
    body: [
      check.warning,
      'Turn your volume up. Sound alerts may not be heard if your device is muted.',
    ].filter(Boolean),
    extra: h('button', { type: 'button', class: 'btn btn-quiet btn-small dialog-test', onclick: testAlert }, 'Test the sound'),
    confirmLabel: 'Start class',
    cancelLabel: 'Not yet',
  });
  if (!start) return;
  unlockAudio();
  saveRun(createRun(cls, Date.now()));
  location.hash = runHref(cls.id);
}

/* ---------- Program editor ---------- */

function renderEditor(cls) {
  document.title = `${cls.name || 'Untitled program'} · FlowState`;

  const list = h('ol', { class: 'sheet-list' });
  const timing = h('section', { class: 'timing', 'aria-label': 'Class timing' });
  let refreshDetails = () => {};

  const refresh = () => {
    document.title = `${cls.name || 'Untitled program'} · FlowState`;
    renderTiming(timing, cls);
    refreshBlocks(list, cls);
    refreshDetails();
  };
  const rerenderList = () => {
    renderBlocks(list, cls, refresh, rerenderList);
    refresh();
  };

  const addBlock = (type) => {
    const block = createBlock(type);
    cls.blocks.push(block);
    expandedId = block.id;
    pendingFocus = `[data-block="${block.id}"] .block-name`;
    touch(cls);
    rerenderList();
    applyFocus();
  };

  const details = detailsPanel(cls, refresh, rerenderList);
  refreshDetails = details.refresh;

  const editor = h('div', { class: 'editor', 'data-type': cls.discipline || 'none' },
    h('div', { class: 'editor-top' },
      h('nav', { class: 'editor-nav' },
        h('a', { class: 'back', href: '#/' }, '‹ Programs'),
        h('span', { class: 'saved' }, sync.statusLabel())),
      isGuest() ? h('section', { class: 'nudge' },
        h('p', {}, h('strong', {}, 'Guest mode. '), 'You can build and run this class, but it won’t be kept when you leave.'),
        h('a', { class: 'btn btn-primary btn-small', href: '#/account' }, 'Create free account')) : null,
      resumeBanner(cls.id)),
    details.el,
    timing,
    h('section', { class: 'sheet', 'aria-label': 'Class program' },
      list,
      h('div', { class: 'add-bar' },
        h('button', { type: 'button', class: 'btn btn-add', onclick: () => addBlock('workout') }, 'New segment'),
        h('button', { type: 'button', class: 'btn btn-add btn-add-break', onclick: () => addBlock('break') }, 'New break'))));

  app.replaceChildren(editor);
  rerenderList();
  applyFocus();
}

function applyFocus() {
  if (!pendingFocus) return;
  const target = app.querySelector(pendingFocus);
  pendingFocus = null;
  if (target) {
    target.focus();
    target.closest('.block')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function detailsPanel(cls, refresh, rerenderList) {
  const custom = h('label', { class: 'field', hidden: cls.discipline !== 'Other' },
    h('span', { class: 'field-label' }, 'What do you teach?'),
    h('input', {
      type: 'text', class: 'input', value: cls.customDiscipline, placeholder: 'e.g. Boxing',
      oninput: (e) => { cls.customDiscipline = e.target.value; touch(cls); },
    }));

  const typeChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Class type' },
    DISCIPLINES.map((discipline) => h('label', { class: 'chip type-chip', 'data-type': discipline },
      h('input', {
        type: 'radio', name: 'class-type', value: discipline, checked: cls.discipline === discipline,
        onchange: () => {
          cls.discipline = discipline;
          custom.hidden = discipline !== 'Other';
          app.querySelector('.editor').dataset.type = discipline;
          touch(cls);
          updateSuggestions(cls);
        },
      }),
      h('span', {}, discipline))));

  const duration = timeField({
    legend: 'Class duration',
    seconds: cls.targetSeconds,
    onChange: (s) => { cls.targetSeconds = s; touch(cls); refresh(); },
  });

  const presets = DURATION_PRESETS.map((minutes) => h('button', {
    type: 'button', class: 'chip chip-button', 'data-seconds': minutes * 60,
    onclick: () => {
      cls.targetSeconds = minutes * 60;
      duration.setSeconds(cls.targetSeconds);
      touch(cls);
      refresh();
    },
  }, h('span', {}, `${minutes} min`)));

  const refreshPresets = () => {
    for (const preset of presets) {
      preset.setAttribute('aria-pressed', String(Number(preset.dataset.seconds) === cls.targetSeconds));
    }
  };

  const el = h('section', { class: 'details', 'aria-label': 'Program details' },
    h('input', {
      type: 'text', class: 'class-name', value: cls.name, placeholder: 'Name this program',
      'aria-label': 'Program name',
      oninput: (e) => { cls.name = e.target.value; touch(cls); refresh(); },
    }),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Class type'), typeChips),
    custom,
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Class duration'),
      h('div', { class: 'chips' }, presets),
      duration),
    MUSIC_ENABLED ? h('label', { class: 'switch' },
      h('input', {
        type: 'checkbox', role: 'switch', checked: cls.musicEnabled,
        onchange: (e) => { cls.musicEnabled = e.target.checked; touch(cls); rerenderList(); },
      }),
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
      h('span', { class: 'switch-title' }, 'Music cues')) : null,
    h('div', { class: 'class-actions' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => copyClass(cls) }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small btn-danger', onclick: () => deleteClass(cls) }, 'Delete')));

  return { el, refresh: refreshPresets };
}

function renderTiming(el, cls) {
  const status = timingStatus(cls);
  const check = startCheck(cls);
  el.replaceChildren(
    h('div', { class: 'timing-row' },
      h('div', { class: 'timing-numbers' },
        h('p', { class: 'timing-total' },
          h('strong', {}, formatTime(status.total)),
          status.target > 0 ? h('span', {}, ` / ${formatTime(status.target)}`) : null),
        h('p', { class: `timing-status status-${status.state}` }, status.label)),
      h('button', {
        type: 'button', class: 'btn btn-primary btn-start', disabled: !check.ok,
        onclick: () => startClass(cls),
      }, icon('play'), 'Start')),
    ribbon(cls),
    check.ok ? '' : h('p', { class: 'timing-hint' }, check.message));
}

function renderBlocks(list, cls, refresh, rerenderList) {
  updateSuggestions(cls);
  if (!cls.blocks.length) {
    list.replaceChildren(h('li', { class: 'sheet-empty' },
      h('p', {}, 'Nothing here yet. Add your first segment, then keep going until the time is filled.')));
    return;
  }
  list.replaceChildren(...cls.blocks.map((block, index) => blockCard(list, cls, block, index, refresh, rerenderList)));
}

function refreshBlocks(list, cls) {
  for (const entry of buildTimeline(cls)) {
    const card = list.querySelector(`[data-block="${entry.block.id}"]`);
    if (!card) continue;
    card.querySelector('.block-head').replaceChildren(...blockHead(cls, entry));
    for (const { cue, at, pastEnd } of entry.cues) {
      const note = card.querySelector(`[data-cue="${cue.id}"] .cue-clock`);
      if (!note) continue;
      note.textContent = pastEnd ? 'Past the end of this segment' : `Starts ${formatTime(at)} into class`;
      note.classList.toggle('cue-warning', pastEnd);
    }
  }
}

function blockHead(cls, { block, start, cues }) {
  const isBreak = block.type === 'break';
  const title = block.name.trim() || (isBreak ? 'Break' : 'Untitled segment');
  const showCues = MUSIC_ENABLED && cls.musicEnabled && cues.length > 0;
  return [
    h('span', { class: 'block-clock' }, formatTime(start)),
    h('span', { class: 'block-main' },
      h('span', { class: 'block-title' }, title),
      block.notes.trim() ? h('span', { class: 'block-notes' }, block.notes.trim()) : null,
      showCues ? h('span', { class: 'block-cues' }, cues.map(({ cue, at, pastEnd }) =>
        h('span', { class: `block-cue${pastEnd ? ' cue-warning' : ''}` },
          `♪ ${pastEnd ? 'Check time' : formatTime(at)}  ${cue.title.trim() || 'Music cue'}`))) : null),
    h('span', { class: `block-length${block.seconds === 0 ? ' cue-warning' : ''}` },
      block.seconds === 0 ? 'No time' : formatTime(block.seconds)),
    icon('chevron'),
  ];
}

function blockCard(list, cls, block, index, refresh, rerenderList) {
  const expanded = expandedId === block.id;
  const entry = buildTimeline(cls)[index];
  const title = block.name.trim() || (block.type === 'break' ? 'break' : 'segment');
  const handle = h('button', {
    type: 'button', class: 'drag-handle',
    'aria-label': `Reorder ${title}. Press the up or down arrow key to move it.`,
    onpointerdown: (event) => startBlockDrag(event, list, block, cls, rerenderList),
    onkeydown: (event) => {
      const delta = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      if (moveBlock(cls, block.id, delta)) {
        touch(cls);
        rerenderList();
      }
      app.querySelector(`[data-block="${block.id}"] .drag-handle`)?.focus();
    },
  }, icon('grip'));
  const head = h('button', {
    type: 'button', class: 'block-head', 'aria-expanded': String(expanded),
    onclick: () => {
      expandedId = expanded ? null : block.id;
      rerenderList();
    },
  }, blockHead(cls, entry));
  return h('li', {
    class: `block block-${block.type}${expanded ? ' is-open' : ''}`,
    'data-block': block.id,
  }, handle, head, expanded ? blockPanel(cls, block, index, refresh, rerenderList) : null);
}

// Dragging works from the handle only, so the rest of the list still scrolls normally on a phone.
function startBlockDrag(event, list, block, cls, rerenderList) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  list.classList.add('is-sorting');

  const cards = [...list.querySelectorAll('.block')];
  const from = cards.findIndex((c) => c.dataset.block === block.id);
  const card = cards[from];
  const slots = cards.map((c) => {
    const rect = c.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
  const gap = slots.length > 1 ? slots[1].top - (slots[0].top + slots[0].height) : 0;
  const shift = slots[from].height + gap;
  const handleRect = handle.getBoundingClientRect();
  const grab = handleRect.top + window.scrollY + handleRect.height / 2 - slots[from].top;

  let pointerY = event.clientY;
  let target = from;
  let frame = null;
  card.classList.add('is-dragging');

  const paint = () => {
    // Scroll when the finger nears the top or bottom, clear of the pinned bars.
    const edge = 120;
    if (pointerY < edge) window.scrollBy(0, -Math.ceil((edge - pointerY) / 8));
    if (pointerY > window.innerHeight - edge) window.scrollBy(0, Math.ceil((pointerY - window.innerHeight + edge) / 8));

    const pageY = pointerY + window.scrollY;
    card.style.transform = `translateY(${pageY - grab - slots[from].top}px)`;
    const center = pageY - grab + slots[from].height / 2;
    target = from;
    for (let i = 0; i < from; i += 1) {
      if (center < slots[i].top + slots[i].height / 2) { target = i; break; }
    }
    for (let i = from + 1; i < slots.length; i += 1) {
      if (center > slots[i].top + slots[i].height / 2) target = i;
    }
    cards.forEach((other, i) => {
      if (i === from) return;
      let offset = 0;
      if (i > from && i <= target) offset = -shift;
      if (i < from && i >= target) offset = shift;
      other.style.transform = offset ? `translateY(${offset}px)` : '';
    });
    frame = requestAnimationFrame(paint);
  };

  const onMove = (moveEvent) => { pointerY = moveEvent.clientY; };
  const finish = (commit) => {
    cancelAnimationFrame(frame);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    list.classList.remove('is-sorting');
    const moved = commit && target !== from && moveBlock(cls, block.id, target - from);
    if (moved) touch(cls);
    rerenderList();
    app.querySelector(`[data-block="${block.id}"] .drag-handle`)?.focus({ preventScroll: true });
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
  frame = requestAnimationFrame(paint);
}

function blockPanel(cls, block, index, refresh, rerenderList) {
  const isBreak = block.type === 'break';
  const change = () => { touch(cls); refresh(); };

  const moveTo = (delta, action) => {
    if (!moveBlock(cls, block.id, delta)) return;
    touch(cls);
    rerenderList();
    const card = `[data-block="${block.id}"]`;
    const preferred = app.querySelector(`${card} [data-action="${action}"]`);
    const other = app.querySelector(`${card} [data-action="${action === 'up' ? 'down' : 'up'}"]`);
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  };

  return h('div', { class: 'block-panel' },
    h('div', { class: 'block-fields' },
      h('label', { class: 'field' },
        h('span', { class: 'field-label' }, isBreak ? 'Break name' : 'Segment name'),
        h('input', {
          type: 'text', class: 'input block-name', value: block.name,
          placeholder: isBreak ? 'Break' : 'e.g. Warm-up',
          list: isBreak ? undefined : 'segment-suggestions',
          oninput: (e) => { block.name = e.target.value; change(); },
        })),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Duration'),
        timeField({
          legend: 'Duration',
          seconds: block.seconds,
          onChange: (s) => { block.seconds = s; change(); },
        }))),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'Notes (optional)'),
      h('textarea', {
        class: 'input', rows: '2', value: block.notes,
        placeholder: isBreak ? 'e.g. Grab water, set up mats' : 'Cues, reps, modifications',
        oninput: (e) => { block.notes = e.target.value; change(); },
      })),
    MUSIC_ENABLED && cls.musicEnabled ? musicSection(cls, block, refresh, rerenderList) : null,
    h('div', { class: 'block-actions' },
      h('button', {
        type: 'button', class: 'btn btn-quiet btn-small', 'data-action': 'up', disabled: index === 0,
        onclick: () => moveTo(-1, 'up'),
      }, 'Move up'),
      h('button', {
        type: 'button', class: 'btn btn-quiet btn-small', 'data-action': 'down', disabled: index === cls.blocks.length - 1,
        onclick: () => moveTo(1, 'down'),
      }, 'Move down'),
      h('button', {
        type: 'button', class: 'btn btn-quiet btn-small',
        onclick: () => {
          const copy = duplicateBlock(cls, block.id);
          expandedId = copy.id;
          touch(cls);
          rerenderList();
        },
      }, 'Duplicate'),
      h('button', {
        type: 'button', class: 'btn btn-quiet btn-small btn-danger',
        onclick: () => {
          const position = cls.blocks.findIndex((b) => b.id === block.id);
          cls.blocks.splice(position, 1);
          expandedId = null;
          touch(cls);
          rerenderList();
          showToast(`Removed ${block.name.trim() || (isBreak ? 'break' : 'segment')}.`, () => {
            cls.blocks.splice(position, 0, block);
            expandedId = block.id;
            touch(cls);
            rerenderList();
          });
        },
      }, 'Remove'),
      // Edits already save as they're typed, so this confirms the segment and closes it.
      h('button', {
        type: 'button', class: 'btn btn-small btn-save',
        onclick: () => {
          expandedId = null;
          persist();
          pendingFocus = `[data-block="${block.id}"] .block-head`;
          rerenderList();
          applyFocus();
          showToast(`Saved ${block.name.trim() || (isBreak ? 'break' : 'segment')}.`);
        },
      }, 'Save')));
}

function musicSection(cls, block, refresh, rerenderList) {
  const rows = [...block.music]
    .sort((a, b) => a.atSeconds - b.atSeconds)
    .map((cue) => h('div', { class: 'cue', 'data-cue': cue.id },
      h('div', { class: 'cue-top' },
        h('input', {
          type: 'text', class: 'input cue-title', value: cue.title, placeholder: 'Song or playlist',
          'aria-label': 'Song or playlist',
          oninput: (e) => { cue.title = e.target.value; touch(cls); refresh(); },
        }),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `Remove music cue ${cue.title}`.trim(),
          onclick: () => {
            block.music = block.music.filter((c) => c.id !== cue.id);
            touch(cls);
            rerenderList();
          },
        }, '×')),
      h('div', { class: 'cue-bottom' },
        h('span', { class: 'field-label' }, 'Time into this segment'),
        timeField({
          legend: 'Time into this segment',
          seconds: cue.atSeconds,
          onChange: (s) => { cue.atSeconds = s; touch(cls); refresh(); },
        }),
        h('span', { class: 'cue-clock' }))));

  return h('div', { class: 'music' },
    h('h3', { class: 'field-label' }, 'Music cues'),
    rows,
    h('button', {
      type: 'button', class: 'btn btn-quiet btn-small',
      onclick: () => {
        const cue = createCue();
        block.music.push(cue);
        touch(cls);
        pendingFocus = `[data-cue="${cue.id}"] .cue-title`;
        rerenderList();
        applyFocus();
      },
    }, 'Add music cue'));
}

function updateSuggestions(cls) {
  let datalist = document.getElementById('segment-suggestions');
  if (!datalist) {
    datalist = h('datalist', { id: 'segment-suggestions' });
    document.body.append(datalist);
  }
  const names = SUGGESTIONS[cls.discipline] ?? SUGGESTIONS.Other;
  datalist.replaceChildren(...names.map((value) => h('option', { value })));
}

/* ---------- Start mode screen ---------- */

function showPlayer(run) {
  player = mountPlayer(app, run, {
    save: saveRun,
    onStopped: (stopped) => {
      player = null;
      location.hash = classHref(stopped.classId);
    },
    onFinished: clearRun,
    onExit: () => {
      const id = player.classId;
      player = null;
      location.hash = classHref(id);
    },
    onRestart: () => {
      const cls = findClass(player.classId);
      const id = player.classId;
      player = null;
      if (cls) {
        location.hash = classHref(id);
        startClass(cls);
      } else {
        location.hash = '#/';
      }
    },
  });
}

/* ---------- Routing ---------- */

// A program that was opened and never filled in shouldn't clutter the list.
function dropBlankClasses(currentId) {
  const before = library.classes.length;
  library.classes = library.classes.filter((c) => c.id === currentId || c.name.trim() || c.blocks.length);
  if (library.classes.length !== before) persist();
}

function parseRoute() {
  if (location.hash === '#/account') return { name: 'account', id: null };
  const runMatch = location.hash.match(/^#\/run\/(.+)$/);
  if (runMatch) return { name: 'run', id: decodeURIComponent(runMatch[1]) };
  const classMatch = location.hash.match(/^#\/class\/(.+)$/);
  if (classMatch) return { name: 'class', id: decodeURIComponent(classMatch[1]) };
  return { name: 'home', id: null };
}

function render() {
  currentHash = location.hash;
  const route = parseRoute();
  document.body.classList.toggle('is-running', route.name === 'run');
  dropBlankClasses(route.id);
  window.scrollTo(0, 0);

  if (route.name === 'run') {
    const run = loadRun();
    if (!run || run.classId !== route.id || run.stopped) {
      location.replace(classHref(route.id));
      return;
    }
    document.title = `${run.className.trim() || 'Class'} · FlowState`;
    // A freshly started or resumed run carries its running state; one reopened after closing comes back paused.
    const stored = rawRun();
    if (stored.running && stored.lastSeenMs === undefined) {
      resumeRun(run, Date.now());
    }
    showPlayer(run);
    return;
  }

  if (route.name === 'account') {
    renderAccount(app, sync);
    return;
  }

  const cls = route.name === 'class' ? findClass(route.id) : null;
  if (cls) {
    renderEditor(cls);
  } else {
    expandedId = null;
    if (route.name === 'class') history.replaceState(null, '', '#/');
    renderHome();
  }
}

window.addEventListener('hashchange', () => {
  // Back button during a live class: stay on the timer and ask first. Editing stays locked.
  if (player?.isLive()) {
    const route = parseRoute();
    if (route.name !== 'run' || route.id !== player.classId) {
      history.pushState(null, '', runHref(player.classId));
      player.requestStop();
    }
    return;
  }
  // Returning to the home screen ends a guest's program, so they get to choose first.
  if (parseRoute().name === 'home' && guestHasProgram()) {
    history.pushState(null, '', currentHash);
    confirmDialog({
      title: 'Leave without saving?',
      body: ['Guest programs aren’t kept. Create a free account to save this one.'],
      confirmLabel: 'Leave and discard',
      cancelLabel: 'Keep editing',
      danger: true,
    }).then((leave) => {
      if (!leave) return;
      discardGuestWork();
      player?.destroy();
      player = null;
      location.hash = '#/';
    });
    return;
  }
  player?.destroy();
  player = null;
  expandedId = null;
  sync.routeChanged();
  render();
});

// A sync update never redraws a running class or a form someone is typing in.
function refreshFromSync() {
  if (player?.isLive()) return;
  const { name } = parseRoute();
  if (name === 'home' || (name === 'account' && sync.getUser())) render();
}

let authSettled = false;
let lastUserId = null;

function handleRemoteChange() {
  if (!sync) return;
  const id = sync.getUser()?.uid ?? null;
  const changedUser = id !== lastUserId;
  const signedInJustNow = authSettled && id && changedUser;
  const signedOutJustNow = authSettled && !id && changedUser;
  authSettled = true;
  lastUserId = id;
  // Finishing sign-in on the account screen returns to the programs.
  if (signedInJustNow && parseRoute().name === 'account') {
    location.hash = '#/';
    return;
  }
  if (signedOutJustNow && parseRoute().name === 'account') {
    render();
    return;
  }
  refreshFromSync();
}

sync = createSync({
  backend,
  getClasses: () => library.classes,
  setClasses: (classes) => {
    library.classes = classes;
    writeLibrary();
  },
  getProtectedIds: () => {
    const route = parseRoute();
    return new Set(route.name === 'class' ? [route.id] : []);
  },
  onStatus: () => {
    if (!sync) return;
    const label = sync.statusLabel();
    for (const el of document.querySelectorAll('.saved')) el.textContent = label;
  },
  onRemoteChange: handleRemoteChange,
  onNotice: showToast,
});

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app still works online without offline support.
  });
}
