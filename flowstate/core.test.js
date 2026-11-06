import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRemote, backRun, buildTimeline, createBlock, createClass, createCue, createRun, duplicateBlock,
  duplicateClass, extendRun, formatTime, mergeLibraries, moveBlock, normalizeLibrary, normalizeRemote,
  pauseRun, pendingChanges, restoreRun, resumeRun, runPosition, runView, skipRun, startCheck, timingStatus,
} from './core.js';

function sampleClass() {
  return createClass({
    targetSeconds: 600,
    blocks: [
      createBlock('workout', { name: 'Warm-up', seconds: 300, music: [createCue({ atSeconds: 60, title: 'Song A' })] }),
      createBlock('break', { seconds: 30 }),
      createBlock('workout', { name: 'Squats', seconds: 120, music: [createCue({ atSeconds: 30, title: 'Song B' })] }),
    ],
  });
}

test('formatTime shows minutes past an hour and pads seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '62:05');
  assert.equal(formatTime(-5), '0:00');
});

test('timeline includes breaks in start times and places music on the class clock', () => {
  const [warmup, rest, squats] = buildTimeline(sampleClass());
  assert.equal(warmup.start, 0);
  assert.equal(rest.start, 300);
  assert.equal(squats.start, 330);
  assert.equal(warmup.cues[0].at, 60);
  assert.equal(squats.cues[0].at, 360);
});

test('music follows its block when the class is reordered', () => {
  const cls = sampleClass();
  assert.equal(moveBlock(cls, cls.blocks[2].id, -2), true);
  const [squats] = buildTimeline(cls);
  assert.equal(squats.block.name, 'Squats');
  assert.equal(squats.cues[0].at, 30);
});

test('moveBlock refuses to move past either end', () => {
  const cls = sampleClass();
  assert.equal(moveBlock(cls, cls.blocks[0].id, -1), false);
  assert.equal(moveBlock(cls, cls.blocks[2].id, 1), false);
});

test('music at or past the end of a shortened block is flagged', () => {
  const cls = sampleClass();
  cls.blocks[0].seconds = 60;
  assert.equal(buildTimeline(cls)[0].cues[0].pastEnd, true);
  cls.blocks[0].seconds = 61;
  assert.equal(buildTimeline(cls)[0].cues[0].pastEnd, false);
});

test('timing status covers under, exact, over and no length set', () => {
  const cls = sampleClass();
  assert.equal(timingStatus(cls).state, 'under');
  assert.equal(timingStatus(cls).label, '2:30 left to plan');
  cls.targetSeconds = 450;
  assert.equal(timingStatus(cls).state, 'exact');
  cls.targetSeconds = 400;
  assert.equal(timingStatus(cls).state, 'over');
  assert.equal(timingStatus(cls).label, '0:50 over');
  cls.targetSeconds = 0;
  assert.equal(timingStatus(cls).state, 'unset');
});

test('duplicates are independent of the original', () => {
  const cls = sampleClass();
  const blockCopy = duplicateBlock(cls, cls.blocks[0].id);
  assert.equal(cls.blocks[1], blockCopy);
  assert.notEqual(blockCopy.id, cls.blocks[0].id);
  assert.notEqual(blockCopy.music[0].id, cls.blocks[0].music[0].id);
  blockCopy.music[0].title = 'Changed';
  assert.equal(cls.blocks[0].music[0].title, 'Song A');

  const classCopy = duplicateClass(cls);
  classCopy.blocks[0].music[0].title = 'Changed again';
  assert.equal(cls.blocks[0].music[0].title, 'Song A');
});

test('normalizeLibrary drops malformed data', () => {
  assert.deepEqual(normalizeLibrary(null).classes, []);
  assert.deepEqual(normalizeLibrary({ classes: 'nope' }).classes, []);
  const { classes } = normalizeLibrary({
    classes: [
      { name: 'no blocks' },
      { name: 42, targetSeconds: 'x', discipline: 'Fake', blocks: [null, { type: 'odd', seconds: -5, music: [7] }] },
    ],
  });
  assert.equal(classes.length, 1);
  assert.equal(classes[0].name, '');
  assert.equal(classes[0].targetSeconds, 0);
  assert.equal(classes[0].discipline, '');
  assert.equal(classes[0].blocks.length, 1);
  assert.equal(classes[0].blocks[0].type, 'workout');
  assert.equal(classes[0].blocks[0].seconds, 0);
  assert.deepEqual(classes[0].blocks[0].music, []);
});

test('import adds new classes and keeps the newer copy of existing ones', () => {
  const older = createClass({ id: 'a', name: 'Old', updatedAt: 100 });
  const newer = createClass({ id: 'a', name: 'New', updatedAt: 200 });
  const fresh = createClass({ id: 'b', name: 'Fresh', updatedAt: 50 });

  const first = mergeLibraries({ classes: [older] }, { classes: [newer, fresh] });
  assert.deepEqual([first.added, first.updated, first.skipped], [1, 1, 0]);
  assert.equal(first.library.classes[0].name, 'New');

  const second = mergeLibraries({ classes: [newer] }, { classes: [older] });
  assert.deepEqual([second.added, second.updated, second.skipped], [0, 0, 1]);
  assert.equal(second.library.classes[0].name, 'New');
});

function program(id, name, updatedAt) {
  return createClass({ id, name, updatedAt, blocks: [createBlock('workout', { name: 'Warm-up' })] });
}

test('a program from the account is added on a new device', () => {
  const result = applyRemote({ classes: [], synced: {} }, [program('a', 'A', 100)]);
  assert.equal(result.classes.length, 1);
  assert.equal(result.synced.a, 100);
  assert.equal(result.changed, true);
});

test('the most recent save wins in both directions', () => {
  const newerThere = applyRemote({ classes: [program('a', 'Old', 100)], synced: { a: 100 } }, [program('a', 'New', 200)]);
  assert.equal(newerThere.classes[0].name, 'New');
  assert.deepEqual(newerThere.replaced, []);

  const newerHere = applyRemote({ classes: [program('a', 'New', 200)], synced: { a: 100 } }, [program('a', 'Old', 100)]);
  assert.equal(newerHere.classes[0].name, 'New');
  assert.equal(pendingChanges(newerHere.classes, newerHere.synced).upserts.length, 1);
});

test('the user is told when a newer version replaces unsynced edits', () => {
  const result = applyRemote({ classes: [program('a', 'Mine', 150)], synced: { a: 100 } }, [program('a', 'Theirs', 200)]);
  assert.deepEqual(result.replaced, ['Mine']);
  assert.equal(result.classes[0].name, 'Theirs');
});

test('a program being edited is left alone until it is closed', () => {
  const result = applyRemote(
    { classes: [program('a', 'Open', 100)], synced: { a: 100 }, protectedIds: new Set(['a']) },
    [program('a', 'Newer', 200)],
  );
  assert.equal(result.classes[0].name, 'Open');
  assert.equal(result.deferred.length, 1);
  assert.equal(result.changed, false);
});

test('a deletion reaches other devices unless the program was edited afterward', () => {
  const marker = normalizeRemote({ id: 'a', deleted: true, updatedAt: 200 });
  const removed = applyRemote({ classes: [program('a', 'A', 100)], synced: { a: 100 } }, [marker]);
  assert.equal(removed.classes.length, 0);
  assert.equal('a' in removed.synced, false);

  const kept = applyRemote({ classes: [program('a', 'A', 300)], synced: { a: 100 } }, [marker]);
  assert.equal(kept.classes.length, 1);
  assert.equal(pendingChanges(kept.classes, kept.synced).upserts.length, 1);
});

test('a program deleted here is not brought back, and the deletion is queued', () => {
  const result = applyRemote({ classes: [], synced: { a: 100 } }, [program('a', 'A', 100)]);
  assert.equal(result.classes.length, 0);
  assert.deepEqual(pendingChanges(result.classes, result.synced).deletes, ['a']);
});

test('guest programs are queued for upload and blank drafts are not', () => {
  const blank = createClass({ id: 'blank' });
  const { upserts, deletes } = pendingChanges([program('a', 'A', 100), blank], {});
  assert.deepEqual(upserts.map((c) => c.id), ['a']);
  assert.deepEqual(deletes, []);
});

test('malformed account data is rejected', () => {
  assert.equal(normalizeRemote(null), null);
  assert.equal(normalizeRemote({ name: 'no blocks' }), null);
  assert.equal(normalizeRemote({ id: 'a', deleted: true }), null);
});

function sampleRun(now = 1000) {
  return createRun(sampleClass(), now); // 300s workout, 30s break, 120s workout
}

test('startCheck blocks an empty program or a segment with no time, and warns on a mismatch', () => {
  assert.equal(startCheck(createClass()).ok, false);
  const noTime = sampleClass();
  noTime.blocks[0].seconds = 0;
  assert.equal(startCheck(noTime).ok, false);
  const under = startCheck(sampleClass());
  assert.equal(under.ok, true);
  assert.equal(under.warning, 'This plan is 2:30 shorter than your 10:00 class.');
  const exact = sampleClass();
  exact.targetSeconds = 450;
  assert.equal(startCheck(exact).warning, null);
});

test('a run works out its place from the clock and moves through segments on time', () => {
  const run = sampleRun();
  assert.equal(runView(run, 1000).index, 0);
  assert.equal(runView(run, 1000 + 299999).index, 0);
  assert.equal(runView(run, 1000 + 300000).index, 1);
  assert.equal(runView(run, 1000 + 300000).current.type, 'break');
  const later = runView(run, 1000 + 330000);
  assert.equal(later.index, 2);
  assert.equal(later.next, null);
  assert.equal(later.segmentRemainingMs, 120000);
  assert.equal(later.classRemainingMs, 120000);
  assert.equal(runView(run, 1000 + 450000).done, true);
});

test('a long gap such as a locked phone lands in exactly the right place', () => {
  const run = sampleRun();
  const view = runView(run, 1000 + 400000);
  assert.equal(view.index, 2);
  assert.equal(view.segmentElapsedMs, 70000);
});

test('pausing freezes both timers and resuming loses no time', () => {
  const run = sampleRun();
  pauseRun(run, 1000 + 60000);
  assert.equal(runPosition(run, 1000 + 500000), 60000);
  resumeRun(run, 1000 + 500000);
  assert.equal(runPosition(run, 1000 + 505000), 65000);
});

test('skip moves on, back restarts first and then steps to the previous segment', () => {
  const run = sampleRun();
  skipRun(run, 2000);
  assert.equal(runView(run, 2000).index, 1);
  assert.equal(runView(run, 2000).classRemainingMs, 150000);
  backRun(run, 2000);
  assert.equal(runView(run, 2000).index, 0);

  skipRun(run, 2000);
  backRun(run, 12000);
  assert.equal(runView(run, 12000).index, 1);
  assert.equal(runView(run, 12000).segmentElapsedMs, 0);

  skipRun(run, 12000);
  skipRun(run, 12000);
  assert.equal(runView(run, 12000).done, true);
});

test('adding 30 seconds extends this run only and keeps the current position', () => {
  const cls = sampleClass();
  const run = createRun(cls, 1000);
  extendRun(run, 1000 + 295000);
  const view = runView(run, 1000 + 295000);
  assert.equal(view.segmentRemainingMs, 35000);
  assert.equal(view.classRemainingMs, 185000);
  assert.equal(cls.blocks[0].seconds, 300);
});

test('a saved run comes back paused at the last moment seen, and bad data is rejected', () => {
  const run = sampleRun();
  const saved = JSON.parse(JSON.stringify({ ...run, lastSeenMs: 42000 }));
  const restored = restoreRun(saved);
  assert.equal(restored.running, false);
  assert.equal(runPosition(restored, 99999999), 42000);
  assert.equal(restoreRun(null), null);
  assert.equal(restoreRun({ blocks: [] }), null);
});
