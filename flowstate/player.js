// Start mode: the full-screen class timer. Editing is impossible from here by design.
import {
  EXTEND_MS, WARNING_MS, backRun, extendRun, formatTime, pauseRun, resumeRun, runView, skipRun,
} from './core.js';
import { requestWakeLock, transitionAlert, unlockAudio, warningAlert } from './alerts.js';
import { confirmDialog, h, icon } from './ui.js';

const TICK_MS = 200;
const SAVE_EVERY_MS = 1000;
// After a longer gap the page was asleep, so catching up shouldn't set off stale alerts.
const AWAKE_GAP_MS = 2000;

const clock = (ms) => formatTime(Math.ceil(ms / 1000));
const blockName = (block) => block.name.trim() || (block.type === 'break' ? 'Break' : 'Untitled segment');

export function mountPlayer(container, run, { save, onStopped, onFinished, onRestart, onExit }) {
  let lastIndex = null;
  let lastTick = Date.now();
  let lastSave = 0;
  let warned = false;
  let live = true;
  let wakeLock = null;

  /* ---------- Static layout, built once so ticks only change text ---------- */

  const strip = run.blocks.map((block) => h('span', {
    class: `strip-seg strip-${block.type}`,
    style: `flex-grow:${Math.max(block.ms, 1)}`,
  }, h('span', { class: 'strip-fill' })));

  const status = h('p', { class: 'now-label' });
  const name = h('h1', { class: 'now-name' });
  const countdown = h('p', { class: 'countdown', role: 'timer' });
  const warning = h('p', { class: 'now-warning' });
  const notes = h('p', { class: 'now-notes' });
  const classLeft = h('strong', {});
  const nextName = h('strong', {});
  const nextTime = h('span', { class: 'next-time' });
  const nextCard = h('p', { class: 'next-card' }, h('span', { class: 'next-label' }, 'Next'), nextName, nextTime);
  const wakeNote = h('p', { class: 'wake-note', hidden: true }, 'Keep your screen on. This browser can’t do it for you.');

  const playButton = h('button', { type: 'button', class: 'ctrl ctrl-main', onclick: togglePlay });
  const listItems = run.blocks.map((block) => {
    const mark = h('span', { class: 'list-mark' });
    const length = h('span', { class: 'list-time' });
    const item = h('li', { class: `list-item list-${block.type}` },
      mark,
      h('span', { class: 'list-name' }, blockName(block)),
      length);
    return { item, mark, length, block };
  });

  const root = h('div', { class: 'player', 'data-type': run.discipline || 'none' },
    h('div', { class: 'strip', 'aria-hidden': 'true' }, strip),
    h('header', { class: 'player-top' },
      h('div', { class: 'player-title' },
        h('p', { class: 'player-class' }, run.className.trim() || 'Untitled program'),
        h('p', { class: 'player-left' }, classLeft, ' left in class')),
      h('button', { type: 'button', class: 'btn btn-stop', onclick: requestStop }, 'Stop')),
    h('div', { class: 'player-body' },
      h('main', { class: 'player-main' },
        status, name, countdown, warning, notes, nextCard, wakeNote,
        h('div', { class: 'controls' },
          h('button', { type: 'button', class: 'ctrl', 'aria-label': 'Go back', onclick: () => act(backRun) }, icon('back')),
          playButton,
          h('button', { type: 'button', class: 'ctrl', 'aria-label': 'Skip to next segment', onclick: () => act(skipRun) }, icon('next')),
          h('button', { type: 'button', class: 'ctrl ctrl-add', 'aria-label': 'Add 30 seconds', onclick: () => act(extendRun) }, `+${EXTEND_MS / 1000}s`))),
      h('aside', { class: 'player-list' },
        h('h2', { class: 'list-heading' }, 'Class plan'),
        h('ol', {}, listItems.map(({ item }) => item)))));

  container.replaceChildren(root);

  /* ---------- Actions ---------- */

  function persist(now) {
    save({ ...run, lastSeenMs: runView(run, now).positionMs });
    lastSave = now;
  }

  // Tapped changes are quiet: the instructor already knows, so only timed changes make a sound.
  function act(action) {
    unlockAudio();
    const now = Date.now();
    action(run, now);
    const view = runView(run, now);
    if (!view.done && view.index !== lastIndex) showSegment(view);
    warned = false;
    persist(now);
    tick();
  }

  function togglePlay() {
    act(run.running ? pauseRun : resumeRun);
    keepAwake();
  }

  async function requestStop() {
    if (!live) return;
    const stop = await confirmDialog({
      title: 'Stop this class?',
      body: ['The timer keeps running until you choose. You can resume from where you stopped.'],
      confirmLabel: 'Stop class',
      cancelLabel: 'Keep going',
      danger: true,
    });
    if (!stop || !live) return;
    pauseRun(run, Date.now());
    run.stopped = true;
    persist(Date.now());
    teardown();
    onStopped(run);
  }

  /* ---------- Display ---------- */

  function showSegment(view) {
    lastIndex = view.index;
    const isBreak = view.current.type === 'break';
    root.dataset.block = view.current.type;
    name.textContent = blockName(view.current);
    notes.textContent = view.current.notes.trim();
    notes.hidden = !notes.textContent;
    nextCard.hidden = false;
    if (view.next) {
      nextName.textContent = blockName(view.next);
    } else {
      nextName.textContent = 'Last one. Finish strong.';
    }
    status.dataset.kind = isBreak ? 'break' : 'segment';
    listItems.forEach(({ item, mark }, index) => {
      const state = index < view.index ? 'done' : index === view.index ? 'now' : index === view.index + 1 ? 'next' : 'later';
      item.dataset.state = state;
      mark.textContent = { done: '✓', now: 'Now', next: 'Next', later: '' }[state];
    });
    listItems[view.index].item.scrollIntoView?.({ block: 'nearest' });
    root.classList.remove('flash');
    void root.offsetWidth;
    root.classList.add('flash');
  }

  function update(view) {
    const text = clock(view.segmentRemainingMs);
    if (countdown.textContent !== text) countdown.textContent = text;
    countdown.classList.toggle('countdown-long', text.length > 5);
    classLeft.textContent = clock(view.classRemainingMs);
    nextTime.textContent = view.next ? clock(view.next.ms) : '';

    run.blocks.forEach((block, index) => {
      const fill = strip[index].firstChild;
      strip[index].style.flexGrow = Math.max(block.ms, 1);
      let width = 0;
      if (index < view.index) width = 100;
      if (index === view.index) width = (view.segmentElapsedMs / block.ms) * 100;
      fill.style.width = `${width}%`;
      listItems[index].length.textContent = clock(block.ms);
    });

    const inWarning = view.current.ms > WARNING_MS && view.segmentRemainingMs <= WARNING_MS;
    root.dataset.warning = String(inWarning);
    warning.hidden = !inWarning;
    const secondsLeft = Math.ceil(view.segmentRemainingMs / 1000);
    warning.textContent = inWarning ? `${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'} left` : '';

    root.dataset.paused = String(!run.running);
    const isBreak = view.current.type === 'break';
    status.textContent = run.running ? (isBreak ? 'Break' : 'Now') : 'Paused';
    playButton.replaceChildren(icon(run.running ? 'pause' : 'play'));
    playButton.setAttribute('aria-label', run.running ? 'Pause' : 'Play');
    return inWarning;
  }

  function showFinished() {
    live = false;
    const total = clock(run.blocks.reduce((sum, block) => sum + block.ms, 0));
    const count = run.blocks.length;
    root.replaceChildren(h('main', { class: 'finish' },
      h('p', { class: 'now-label' }, 'Class complete'),
      h('h1', { class: 'finish-title' }, 'That’s a wrap.'),
      h('p', { class: 'finish-meta' }, `${total} · ${count} ${count === 1 ? 'block' : 'blocks'}`),
      h('div', { class: 'finish-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: onExit }, 'Back to program'),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: onRestart }, 'Run it again'))));
    root.dataset.warning = 'false';
    root.dataset.paused = 'false';
    root.dataset.block = 'finish';
    root.classList.add('flash');
  }

  /* ---------- Clock ---------- */

  function tick() {
    if (!live) return;
    const now = Date.now();
    const awake = now - lastTick < AWAKE_GAP_MS;
    lastTick = now;
    const view = runView(run, now);

    if (view.done) {
      if (awake) transitionAlert();
      teardown();
      showFinished();
      onFinished();
      return;
    }
    if (view.index !== lastIndex) {
      if (lastIndex !== null && awake && run.running) transitionAlert();
      warned = false;
      showSegment(view);
    }
    const inWarning = update(view);
    if (!inWarning) warned = false;
    if (inWarning && !warned && run.running) {
      warned = true;
      if (awake) warningAlert();
    }
    if (now - lastSave >= SAVE_EVERY_MS) persist(now);
  }

  async function keepAwake() {
    if (!live || wakeLock || document.visibilityState !== 'visible') return;
    wakeLock = await requestWakeLock();
    wakeNote.hidden = Boolean(wakeLock);
    wakeLock?.addEventListener('release', () => { wakeLock = null; });
  }

  function onVisibility() {
    tick();
    if (document.visibilityState === 'visible') keepAwake();
  }

  function onPageHide() {
    if (live) persist(Date.now());
  }

  const interval = setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  function teardown() {
    live = false;
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  keepAwake();
  tick();

  return { classId: run.classId, isLive: () => live, requestStop, destroy: teardown };
}
