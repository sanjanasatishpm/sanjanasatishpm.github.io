// Sounds and vibration for Start mode. Browsers only allow sound after a tap,
// so unlock() must be called from a click, such as the Start button.

let context = null;

export function unlockAudio() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;
  context ??= new AudioContextClass();
  if (context.state !== 'running') context.resume().catch(() => {});
}

function tone(frequency, startIn, length) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const at = context.currentTime + startIn;
  // A square wave cuts through class music better than a soft sine tone.
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
  gain.gain.setValueAtTime(0.5, at + length - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

function play(notes) {
  if (!context) return;
  if (context.state !== 'running') context.resume().catch(() => {});
  notes.forEach(([frequency, startIn, length]) => tone(frequency, startIn, length));
}

function vibrate(pattern) {
  navigator.vibrate?.(pattern);
}

export function warningAlert() {
  play([[880, 0, 0.16], [880, 0.26, 0.16]]);
  vibrate([200, 100, 200]);
}

export function transitionAlert() {
  play([[660, 0, 0.14], [880, 0.16, 0.14], [1175, 0.32, 0.28]]);
  vibrate([400]);
}

export function testAlert() {
  unlockAudio();
  warningAlert();
}

// Asks the browser to keep the screen on. Reports false where that isn't possible.
export async function requestWakeLock() {
  if (!navigator.wakeLock) return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}
