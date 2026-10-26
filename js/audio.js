// Synthesised UI sounds (no audio files) and the navigator voice.

let ctx = null;
let enabled = true;
let voice = null;

export function initAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
  pickVoice();
  window.speechSynthesis?.addEventListener?.('voiceschanged', pickVoice);
}

export function setAudio(on) {
  enabled = on;
  if (!on) window.speechSynthesis?.cancel();
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang?.startsWith('en'));
  voice = en.find((v) => /samantha|google us english|zira|aria|jenny/i.test(v.name)) || en[0] || null;
}

function tone(freq, dur, { type = 'square', vol = 0.035, delay = 0, slide = 0 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, vol = 0.03) {
  if (!ctx || !enabled) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() > 0.7 ? 1 : 0.2);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

export const sfx = {
  click: () => tone(2200, 0.035, { vol: 0.018 }),
  tick: () => tone(3200, 0.02, { vol: 0.01, type: 'triangle' }),
  confirm: () => { tone(660, 0.07); tone(990, 0.11, { delay: 0.07 }); },
  cancel: () => { tone(500, 0.07); tone(330, 0.12, { delay: 0.06 }); },
  alert: () => { tone(880, 0.09, { type: 'sawtooth' }); tone(440, 0.16, { type: 'sawtooth', delay: 0.1 }); },
  glitch: () => noise(0.18, 0.05),
  boot: () => { tone(55, 1.4, { type: 'sawtooth', vol: 0.045, slide: 4 }); tone(1320, 0.08, { delay: 1.2 }); tone(1760, 0.14, { delay: 1.3 }); },
  lock: () => { tone(1200, 0.05, { type: 'triangle', vol: 0.03 }); tone(1600, 0.05, { type: 'triangle', vol: 0.03, delay: 0.06 }); tone(2400, 0.12, { type: 'triangle', vol: 0.03, delay: 0.12 }); },
  arrive: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.05, delay: i * 0.09 })),
};

export function speak(text) {
  if (!enabled || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = 1.03;
  u.pitch = 0.75;
  speechSynthesis.speak(u);
}
