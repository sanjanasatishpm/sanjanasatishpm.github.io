// Class-program data and timing rules. No DOM or browser storage in here, so a
// future native app can reuse this file as is.

export const DISCIPLINES = ['Pilates', 'Strength', 'Yoga', 'Cycling', 'Barre', 'HIIT', 'Other'];

// Offered as autocomplete on the workout name. Instructors can always type their own.
export const SUGGESTIONS = {
  Pilates: ['Warm-up', 'Footwork', 'The Hundred', 'Abdominals', 'Leg springs', 'Side-lying series', 'Back extension', 'Cool-down'],
  Strength: ['Warm-up', 'Squat', 'Deadlift', 'Bench press', 'Row', 'Overhead press', 'Accessory circuit', 'Core finisher', 'Cool-down'],
  Yoga: ['Centering', 'Sun salutations', 'Standing flow', 'Balance', 'Hip openers', 'Backbends', 'Seated poses', 'Savasana'],
  Cycling: ['Warm-up', 'Seated climb', 'Standing climb', 'Sprints', 'Tempo ride', 'Intervals', 'Recovery ride', 'Cool-down'],
  Barre: ['Warm-up', 'Arms', 'Thighs', 'Seat', 'Core', 'Stretch', 'Cool-down'],
  HIIT: ['Warm-up', 'Burpees', 'Tabata round', 'AMRAP', 'EMOM', 'Sled push', 'Finisher', 'Cool-down'],
  Other: ['Warm-up', 'Main set', 'Finisher', 'Cool-down'],
};

const MAX_SECONDS = 24 * 60 * 60;
const MAX_TEXT = 2000;

export function uid() {
  // crypto.randomUUID only exists on https/localhost; phones testing over LAN need the fallback.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampSeconds(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_SECONDS);
}

export function formatTime(seconds) {
  const s = clampSeconds(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createClass(overrides = {}) {
  return {
    id: uid(),
    name: '',
    discipline: '',
    customDiscipline: '',
    targetSeconds: 45 * 60,
    musicEnabled: false,
    blocks: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createBlock(type = 'workout', overrides = {}) {
  return {
    id: uid(),
    type,
    name: type === 'break' ? 'Break' : '',
    seconds: type === 'break' ? 30 : 5 * 60,
    notes: '',
    music: [],
    ...overrides,
  };
}

export function createCue(overrides = {}) {
  return { id: uid(), atSeconds: 0, title: '', ...overrides };
}

export function disciplineLabel(cls) {
  if (cls.discipline === 'Other') return cls.customDiscipline.trim() || 'Other';
  return cls.discipline;
}

export function totalSeconds(cls) {
  return cls.blocks.reduce((sum, block) => sum + block.seconds, 0);
}

// Where each block and music change falls on the class clock. Music is stored
// relative to its block so it travels with the block when the class is reordered.
export function buildTimeline(cls) {
  let clock = 0;
  return cls.blocks.map((block) => {
    const start = clock;
    clock += block.seconds;
    const cues = [...block.music]
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map((cue) => ({
        cue,
        at: start + cue.atSeconds,
        pastEnd: cue.atSeconds > 0 && cue.atSeconds >= block.seconds,
      }));
    return { block, start, end: clock, cues };
  });
}

export function timingStatus(cls) {
  const total = totalSeconds(cls);
  const target = cls.targetSeconds;
  const diff = target - total;
  if (target <= 0) return { total, target, state: 'unset', label: 'Set a class length' };
  if (diff > 0) return { total, target, state: 'under', label: `${formatTime(diff)} left to plan` };
  if (diff < 0) return { total, target, state: 'over', label: `${formatTime(-diff)} over` };
  return { total, target, state: 'exact', label: 'Fills the class exactly' };
}

export function moveBlock(cls, blockId, delta) {
  const from = cls.blocks.findIndex((b) => b.id === blockId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= cls.blocks.length) return false;
  const [block] = cls.blocks.splice(from, 1);
  cls.blocks.splice(to, 0, block);
  return true;
}

function cloneBlock(block) {
  return {
    ...block,
    id: uid(),
    music: block.music.map((cue) => ({ ...cue, id: uid() })),
  };
}

export function duplicateBlock(cls, blockId) {
  const index = cls.blocks.findIndex((b) => b.id === blockId);
  if (index < 0) return null;
  const copy = cloneBlock(cls.blocks[index]);
  cls.blocks.splice(index + 1, 0, copy);
  return copy;
}

export function duplicateClass(cls) {
  return {
    ...cls,
    id: uid(),
    name: cls.name ? `${cls.name} copy` : '',
    blocks: cls.blocks.map(cloneBlock),
    updatedAt: Date.now(),
  };
}

function text(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

function validId(value) {
  return typeof value === 'string' && value ? value.slice(0, 100) : uid();
}

function normalizeCue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { id: validId(raw.id), atSeconds: clampSeconds(raw.atSeconds), title: text(raw.title) };
}

function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: validId(raw.id),
    type: raw.type === 'break' ? 'break' : 'workout',
    name: text(raw.name),
    seconds: clampSeconds(raw.seconds),
    notes: text(raw.notes),
    music: Array.isArray(raw.music) ? raw.music.map(normalizeCue).filter(Boolean) : [],
  };
}

export function normalizeClass(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return null;
  return {
    id: validId(raw.id),
    name: text(raw.name),
    discipline: DISCIPLINES.includes(raw.discipline) ? raw.discipline : '',
    customDiscipline: text(raw.customDiscipline),
    targetSeconds: clampSeconds(raw.targetSeconds),
    musicEnabled: Boolean(raw.musicEnabled),
    blocks: raw.blocks.map(normalizeBlock).filter(Boolean),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

// Reads saved or imported data. Anything malformed is dropped, never trusted.
export function normalizeLibrary(raw) {
  const classes = Array.isArray(raw?.classes) ? raw.classes : [];
  return { version: 1, classes: classes.map(normalizeClass).filter(Boolean) };
}

// Imports add new classes and replace a saved copy only when the import is newer.
export function mergeLibraries(current, incoming) {
  const classes = [...current.classes];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const cls of incoming.classes) {
    const index = classes.findIndex((c) => c.id === cls.id);
    if (index < 0) {
      classes.push(cls);
      added += 1;
    } else if (cls.updatedAt > classes[index].updatedAt) {
      classes[index] = cls;
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  return { library: { version: 1, classes }, added, updated, skipped };
}

/* ---------- Account sync ---------- */

export function isBlankClass(cls) {
  return !cls.name.trim() && !cls.blocks.length;
}

// A deleted program leaves a marker in the account, so other devices remove it too.
export function normalizeRemote(raw) {
  if (raw?.deleted === true && typeof raw.id === 'string' && Number.isFinite(raw.updatedAt)) {
    return { id: raw.id, deleted: true, updatedAt: raw.updatedAt };
  }
  return normalizeClass(raw);
}

// Folds account changes into this device. The most recent save wins, program by program.
// `synced` records the save time of each program the account is known to hold, which is
// also how a change or deletion made here is recognised as not yet uploaded.
export function applyRemote({ classes, synced, protectedIds = new Set() }, docs) {
  const nextClasses = [...classes];
  const nextSynced = { ...synced };
  const replaced = [];
  const deferred = [];
  let changed = false;

  for (const remote of docs) {
    const index = nextClasses.findIndex((c) => c.id === remote.id);
    const local = index < 0 ? null : nextClasses[index];

    if (local && remote.updatedAt > local.updatedAt && protectedIds.has(remote.id)) {
      deferred.push(remote);
      continue;
    }

    if (remote.deleted) {
      if (local && remote.updatedAt > local.updatedAt) {
        nextClasses.splice(index, 1);
        changed = true;
      }
      delete nextSynced[remote.id];
    } else if (!local) {
      // Known to the account but missing here means it was deleted here and not uploaded yet.
      const deletedHere = remote.id in nextSynced && remote.updatedAt <= nextSynced[remote.id];
      if (!deletedHere) {
        nextClasses.push(remote);
        nextSynced[remote.id] = remote.updatedAt;
        changed = true;
      }
    } else if (remote.updatedAt > local.updatedAt) {
      if (nextSynced[remote.id] !== local.updatedAt) replaced.push(local.name.trim() || 'Untitled program');
      nextClasses[index] = remote;
      nextSynced[remote.id] = remote.updatedAt;
      changed = true;
    } else {
      nextSynced[remote.id] = remote.updatedAt;
    }
  }
  return { classes: nextClasses, synced: nextSynced, replaced, deferred, changed };
}

// What this device still needs to send to the account.
export function pendingChanges(classes, synced) {
  const present = new Set(classes.map((c) => c.id));
  return {
    upserts: classes.filter((c) => !isBlankClass(c) && synced[c.id] !== c.updatedAt),
    deletes: Object.keys(synced).filter((id) => !present.has(id)),
  };
}

/* ---------- Start mode ---------- */

const RESTART_WINDOW_MS = 3000;
export const WARNING_MS = 10000;
export const EXTEND_MS = 30000;

// What stands between a program and pressing Start.
export function startCheck(cls) {
  if (!cls.blocks.length) {
    return { ok: false, message: 'Add a segment to start this class.' };
  }
  const missing = cls.blocks.filter((block) => block.seconds === 0).length;
  if (missing) {
    return {
      ok: false,
      message: missing === 1
        ? 'One segment has no time. Set it to start this class.'
        : `${missing} segments have no time. Set them to start this class.`,
    };
  }
  const { total, target, state } = timingStatus(cls);
  let warning = null;
  if (state === 'under') warning = `This plan is ${formatTime(target - total)} shorter than your ${formatTime(target)} class.`;
  if (state === 'over') warning = `This plan is ${formatTime(total - target)} longer than your ${formatTime(target)} class.`;
  return { ok: true, warning };
}

// A run keeps its own copy of the plan, so +30 seconds never changes the saved program.
// Time is always worked out from the clock, never counted, so it cannot drift and it
// stays correct after the phone locks or the browser suspends the page.
export function createRun(cls, now) {
  return {
    classId: cls.id,
    className: cls.name,
    discipline: cls.discipline,
    blocks: cls.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      name: block.name,
      notes: block.notes,
      ms: block.seconds * 1000,
    })),
    positionMs: 0,
    anchorAt: now,
    running: true,
    stopped: false,
  };
}

function runTotalMs(run) {
  return run.blocks.reduce((sum, block) => sum + block.ms, 0);
}

export function runPosition(run, now) {
  const moved = run.running ? Math.max(0, now - run.anchorAt) : 0;
  return Math.min(runTotalMs(run), run.positionMs + moved);
}

export function runView(run, now) {
  const positionMs = runPosition(run, now);
  const totalMs = runTotalMs(run);
  let start = 0;
  for (let index = 0; index < run.blocks.length; index += 1) {
    const current = run.blocks[index];
    if (positionMs < start + current.ms) {
      const segmentElapsedMs = positionMs - start;
      return {
        done: false,
        index,
        current,
        next: run.blocks[index + 1] ?? null,
        positionMs,
        segmentElapsedMs,
        segmentRemainingMs: current.ms - segmentElapsedMs,
        classRemainingMs: totalMs - positionMs,
      };
    }
    start += current.ms;
  }
  return { done: true, index: run.blocks.length, current: null, next: null, positionMs, classRemainingMs: 0 };
}

function setPosition(run, positionMs, now) {
  run.positionMs = positionMs;
  run.anchorAt = now;
}

export function pauseRun(run, now) {
  setPosition(run, runPosition(run, now), now);
  run.running = false;
}

export function resumeRun(run, now) {
  run.anchorAt = now;
  run.running = true;
  run.stopped = false;
}

function blockStart(run, index) {
  return run.blocks.slice(0, index).reduce((sum, block) => sum + block.ms, 0);
}

export function skipRun(run, now) {
  const { done, index } = runView(run, now);
  if (!done) setPosition(run, blockStart(run, index + 1), now);
}

// Like a music player: back restarts the segment, or goes to the previous one if it only just began.
export function backRun(run, now) {
  const { done, index, segmentElapsedMs } = runView(run, now);
  if (done) return;
  const target = segmentElapsedMs > RESTART_WINDOW_MS ? index : Math.max(0, index - 1);
  setPosition(run, blockStart(run, target), now);
}

export function extendRun(run, now) {
  const { done, index } = runView(run, now);
  if (done) return;
  setPosition(run, runPosition(run, now), now);
  run.blocks[index].ms += EXTEND_MS;
}

// A saved run comes back paused at the last moment the app saw, so nothing is lost if it closed.
export function restoreRun(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks) || !raw.blocks.length) return null;
  const blocks = raw.blocks
    .filter((block) => block && typeof block === 'object')
    .map((block) => ({
      id: validId(block.id),
      type: block.type === 'break' ? 'break' : 'workout',
      name: text(block.name),
      notes: text(block.notes),
      ms: clampSeconds(block.ms / 1000) * 1000,
    }));
  if (!blocks.length) return null;
  const saved = Number.isFinite(raw.lastSeenMs) ? raw.lastSeenMs : raw.positionMs;
  return {
    classId: validId(raw.classId),
    className: text(raw.className),
    discipline: DISCIPLINES.includes(raw.discipline) ? raw.discipline : '',
    blocks,
    positionMs: Number.isFinite(saved) ? Math.max(0, saved) : 0,
    anchorAt: 0,
    running: false,
    stopped: Boolean(raw.stopped),
  };
}
