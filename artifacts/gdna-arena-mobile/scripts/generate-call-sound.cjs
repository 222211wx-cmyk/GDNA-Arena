// Original two-pulse ringtone; deterministic PCM WAV, no external audio rights.
const fs = require('node:fs');
const path = require('node:path');
const rate = 24000;
const seconds = 3;
const samples = rate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const local = t < 0.6 ? t : t >= 0.85 && t < 1.45 ? t - 0.85 : -1;
  const envelope = local < 0 ? 0 : Math.min(1, local / 0.02, (0.6 - local) / 0.04);
  const tone = (Math.sin(2 * Math.PI * 660 * t) + Math.sin(2 * Math.PI * 880 * t)) / 2;
  wav.writeInt16LE(Math.round(16000 * envelope * tone), 44 + i * 2);
}
const out = path.join(__dirname, '../assets/sounds/gdna_call.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, wav);