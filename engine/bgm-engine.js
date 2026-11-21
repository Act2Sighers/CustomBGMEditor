/*!
 * CustomBGM Engine v1
 * CustomBGMEditor で作った楽譜 (*.bgm.json) を再生・WAV書き出しするための単体ライブラリ。
 * 依存なし。ブラウザでは <script src="bgm-engine.js"> で window.CustomBGM に、
 * Node.js では require('./bgm-engine.js') で読み込めます。
 * 仕様: docs/FORMAT.md / 使い方: docs/FOR_CLAUDE.md
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CustomBGM = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===================================================================
  // DSP 本体。AudioWorklet 内でも同じコードを動かすため、この関数の中身は
  // 外側の変数を一切参照しない（toString() して Worklet に埋め込む）。
  // ===================================================================
  function BGM_DSP() {
    'use strict';

    var PPQ = 48;
    var BEATS_PER_BAR = 4;
    var TICKS_PER_BAR = PPQ * BEATS_PER_BAR;
    var NUM_PARTS = 8;
    var DRUM_MAX_POLY = 3;
    var FORMAT_NAME = 'CustomBGM';
    var FORMAT_VERSION = 1;
    var NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

    // ---------------------------------------------------------------
    // 音色プリセット
    // ---------------------------------------------------------------
    var SYNTH_DEFAULTS = {
      osc: 'pulse', duty: 0.5, pwmDepth: 0, pwmRate: 2,
      detune: 0, transpose: 0, unison: 1, spread: 12,
      fmRatio: 2, fmIndex: 2, fmDecay: 0.5, fmSustain: 0.2,
      attack: 0.003, decay: 0.2, sustain: 0.7, release: 0.1,
      cutoff: 20000, resonance: 0, filterEnv: 0, filterDecay: 0.3, keyTrack: 0,
      vibratoRate: 5, vibratoDepth: 0, vibratoDelay: 0.3,
      drive: 0, gain: 0.25
    };
    var DRUM_DEFAULTS = { kit: 'electro', tune: 0, decay: 1, tone: 0.5, gain: 0.8 };

    var PRESETS = {
      pulse12:   { label: '矩形波 12.5%', category: 'lead', kind: 'synth', params: { osc: 'pulse', duty: 0.125, attack: 0.002, decay: 0.15, sustain: 0.7, release: 0.08, gain: 0.2 } },
      pulse25:   { label: '矩形波 25%', category: 'lead', kind: 'synth', params: { osc: 'pulse', duty: 0.25, attack: 0.002, decay: 0.15, sustain: 0.7, release: 0.08, gain: 0.2 } },
      pulse50:   { label: '矩形波 50%', category: 'lead', kind: 'synth', params: { osc: 'pulse', duty: 0.5, attack: 0.002, decay: 0.15, sustain: 0.7, release: 0.08, gain: 0.18 } },
      pwmLead:   { label: 'PWM矩形波', category: 'lead', kind: 'synth', params: { osc: 'pulse', duty: 0.3, pwmDepth: 0.15, pwmRate: 3, attack: 0.005, decay: 0.2, sustain: 0.75, release: 0.12, vibratoDepth: 12, gain: 0.18 } },
      softSquare:{ label: 'ソフト矩形波', category: 'lead', kind: 'synth', params: { osc: 'pulse', duty: 0.5, cutoff: 1800, resonance: 0.1, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.15, gain: 0.25 } },
      triangle:  { label: '三角波', category: 'lead', kind: 'synth', params: { osc: 'tri', attack: 0.002, decay: 0.1, sustain: 0.9, release: 0.06, gain: 0.32 } },
      saw:       { label: 'ノコギリ波', category: 'lead', kind: 'synth', params: { osc: 'saw', cutoff: 6000, attack: 0.003, decay: 0.2, sustain: 0.7, release: 0.1, gain: 0.24 } },
      sine:      { label: 'サイン波', category: 'lead', kind: 'synth', params: { osc: 'sine', attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.12, gain: 0.3 } },
      brass:     { label: 'シンセブラス', category: 'lead', kind: 'synth', params: { osc: 'saw', cutoff: 900, resonance: 0.15, filterEnv: 2, filterDecay: 0.35, attack: 0.03, decay: 0.3, sustain: 0.7, release: 0.15, gain: 0.28 } },
      fmBell:    { label: 'FMベル', category: 'lead', kind: 'synth', params: { osc: 'fm', fmRatio: 3.5, fmIndex: 4, fmDecay: 0.6, fmSustain: 0.1, attack: 0.001, decay: 1.5, sustain: 0, release: 0.5, gain: 0.32 } },
      fmEPiano:  { label: 'FMエレピ', category: 'chord', kind: 'synth', params: { osc: 'fm', fmRatio: 1, fmIndex: 2.2, fmDecay: 0.4, fmSustain: 0.15, attack: 0.002, decay: 1.2, sustain: 0.25, release: 0.3, gain: 0.32 } },
      pluck:     { label: 'プラック', category: 'chord', kind: 'synth', params: { osc: 'saw', cutoff: 450, resonance: 0.2, filterEnv: 4, filterDecay: 0.15, attack: 0.001, decay: 0.35, sustain: 0, release: 0.15, gain: 0.4 } },
      pad:       { label: 'シンセパッド', category: 'chord', kind: 'synth', params: { osc: 'supersaw', unison: 3, spread: 14, cutoff: 1800, resonance: 0.1, attack: 0.4, decay: 0.5, sustain: 0.85, release: 0.8, gain: 0.22 } },
      warmPad:   { label: 'やわらかパッド', category: 'chord', kind: 'synth', params: { osc: 'pulse', duty: 0.4, pwmDepth: 0.2, pwmRate: 0.7, cutoff: 1200, attack: 0.6, decay: 0.5, sustain: 0.9, release: 1.0, gain: 0.2 } },
      triBass:   { label: '三角波ベース', category: 'bass', kind: 'synth', params: { osc: 'tri', attack: 0.002, decay: 0.15, sustain: 0.85, release: 0.05, gain: 0.48 } },
      subBass:   { label: 'サブベース', category: 'bass', kind: 'synth', params: { osc: 'sine', drive: 0.35, attack: 0.004, decay: 0.2, sustain: 0.9, release: 0.07, gain: 0.45 } },
      synthBass: { label: 'シンセベース', category: 'bass', kind: 'synth', params: { osc: 'saw', cutoff: 380, resonance: 0.4, filterEnv: 3, filterDecay: 0.12, attack: 0.002, decay: 0.25, sustain: 0.6, release: 0.06, drive: 0.2, gain: 0.4 } },
      pulseBass: { label: '矩形波ベース', category: 'bass', kind: 'synth', params: { osc: 'pulse', duty: 0.25, cutoff: 1500, attack: 0.002, decay: 0.2, sustain: 0.7, release: 0.05, gain: 0.25 } },
      fmBass:    { label: 'FMベース', category: 'bass', kind: 'synth', params: { osc: 'fm', fmRatio: 1, fmIndex: 3, fmDecay: 0.2, fmSustain: 0.2, attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.06, gain: 0.32 } },
      drumChip:  { label: 'ドラム（チップ）', category: 'drum', kind: 'drum', params: { kit: 'chip', gain: 0.8 } },
      drumElectro:{ label: 'ドラム（エレクトロ）', category: 'drum', kind: 'drum', params: { kit: 'electro', gain: 0.85 } }
    };

    // ドラムの音高割り当て（General MIDI に近い番号）
    var DRUM_MAP = {
      36: { id: 'kick', label: 'キック' },
      37: { id: 'rim', label: 'リム' },
      38: { id: 'snare', label: 'スネア' },
      39: { id: 'clap', label: 'クラップ' },
      42: { id: 'hat', label: 'クローズドハット' },
      46: { id: 'openhat', label: 'オープンハット' },
      45: { id: 'tomL', label: 'タム（低）' },
      47: { id: 'tomM', label: 'タム（中）' },
      50: { id: 'tomH', label: 'タム（高）' },
      49: { id: 'crash', label: 'クラッシュ' },
      51: { id: 'ride', label: 'ライド' }
    };

    // ---------------------------------------------------------------
    // ユーティリティ
    // ---------------------------------------------------------------
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function num(v, def) { v = Number(v); return isFinite(v) ? v : def; }
    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    function isDrumInstrument(id) {
      var p = PRESETS[id];
      return !!(p && p.kind === 'drum');
    }

    function resolveParams(instrument, overrides) {
      var preset = PRESETS[instrument] || PRESETS.pulse25;
      var base = preset.kind === 'drum' ? DRUM_DEFAULTS : SYNTH_DEFAULTS;
      var out = {}, k;
      for (k in base) out[k] = base[k];
      for (k in preset.params) out[k] = preset.params[k];
      if (overrides && typeof overrides === 'object') {
        for (k in overrides) {
          if (!(k in base)) continue;
          var v = overrides[k];
          if (typeof base[k] === 'number') { v = Number(v); if (!isFinite(v)) continue; }
          else if (typeof v !== 'string') continue;
          out[k] = v;
        }
      }
      return out;
    }

    function defaultPart(i) {
      var inst = ['pulse25', 'pulse12', 'pulse50', 'triangle', 'pad', 'triBass', 'fmBell', 'drumElectro'][i] || 'pulse25';
      return {
        name: 'パート' + (i + 1), instrument: inst, params: {},
        volume: 0.8, pan: 0, reverb: 0.15, delay: 0, mute: false, solo: false, notes: []
      };
    }

    function createEmptyScore() {
      var parts = [];
      for (var i = 0; i < NUM_PARTS; i++) parts.push(defaultPart(i));
      return {
        format: FORMAT_NAME, version: FORMAT_VERSION,
        title: '無題', bpm: 120, ppq: PPQ, beatsPerBar: BEATS_PER_BAR,
        key: { tonic: 'C', mode: 'major' },
        intro: { enabled: false, bars: 4 },
        loopBars: 96,
        sections: [{ bar: 0, name: 'A' }],
        master: { volume: 0.8, reverb: { size: 0.6, damp: 0.5, level: 0.35 }, delay: { beats: 0.75, feedback: 0.35, level: 0.3 } },
        parts: parts,
        meta: {}
      };
    }

    function introBarsOf(score) { return score.intro && score.intro.enabled ? score.intro.bars : 0; }
    function totalBarsOf(score) { return introBarsOf(score) + score.loopBars; }

    // 音符を [開始tick, 長さtick, 音高, 強さ] に統一
    function normalizeNote(n) {
      var t, d, p, v;
      if (Array.isArray(n)) { t = n[0]; d = n[1]; p = n[2]; v = n[3]; }
      else if (n && typeof n === 'object') {
        t = n.t != null ? n.t : n.start; d = n.d != null ? n.d : n.length;
        p = n.p != null ? n.p : n.pitch; v = n.v != null ? n.v : n.velocity;
      } else return null;
      t = Math.round(num(t, NaN)); d = Math.round(num(d, NaN)); p = Math.round(num(p, NaN)); v = Math.round(num(v, 100));
      if (!isFinite(t) || !isFinite(d) || !isFinite(p)) return null;
      if (t < 0 || d <= 0 || p < 0 || p > 127) return null;
      return [t, d, p, clamp(v, 1, 127)];
    }

    // 外部から来た楽譜を安全な形に整える（足りない値は既定値で補う）
    function normalizeScore(input) {
      if (typeof input === 'string') input = JSON.parse(input);
      if (!input || typeof input !== 'object') throw new Error('楽譜データがオブジェクトではありません');
      var s = createEmptyScore();
      s.title = typeof input.title === 'string' ? input.title : s.title;
      s.bpm = clamp(num(input.bpm, 120), 30, 300);
      var key = input.key || {};
      s.key = {
        tonic: NOTE_NAMES.indexOf(key.tonic) >= 0 ? key.tonic : 'C',
        mode: key.mode === 'minor' ? 'minor' : 'major'
      };
      var intro = input.intro || {};
      s.intro = { enabled: !!intro.enabled, bars: clamp(Math.round(num(intro.bars, 4)), 1, 64) };
      s.loopBars = clamp(Math.round(num(input.loopBars, 96)), 1, 1000);
      if (Array.isArray(input.sections)) {
        s.sections = input.sections.filter(function (x) { return x && isFinite(Number(x.bar)); })
          .map(function (x) { return { bar: Math.max(0, Math.round(Number(x.bar))), name: String(x.name == null ? '' : x.name) }; })
          .sort(function (a, b) { return a.bar - b.bar; });
      }
      var m = input.master || {};
      var mr = m.reverb || {}, md = m.delay || {};
      s.master = {
        volume: clamp(num(m.volume, 0.8), 0, 1.5),
        reverb: { size: clamp(num(mr.size, 0.6), 0, 1), damp: clamp(num(mr.damp, 0.5), 0, 1), level: clamp(num(mr.level, 0.35), 0, 1) },
        delay: { beats: clamp(num(md.beats, 0.75), 0.0625, 4), feedback: clamp(num(md.feedback, 0.35), 0, 0.9), level: clamp(num(md.level, 0.3), 0, 1) }
      };
      var parts = Array.isArray(input.parts) ? input.parts : [];
      for (var i = 0; i < NUM_PARTS; i++) {
        var src = parts[i] || {}, dst = s.parts[i];
        if (typeof src.name === 'string') dst.name = src.name;
        if (PRESETS[src.instrument]) dst.instrument = src.instrument;
        dst.params = {};
        if (src.params && typeof src.params === 'object') {
          var base = isDrumInstrument(dst.instrument) ? DRUM_DEFAULTS : SYNTH_DEFAULTS;
          for (var k in src.params) if (k in base) dst.params[k] = src.params[k];
        }
        dst.volume = clamp(num(src.volume, 0.8), 0, 1.5);
        dst.pan = clamp(num(src.pan, 0), -1, 1);
        dst.reverb = clamp(num(src.reverb, 0.15), 0, 1);
        dst.delay = clamp(num(src.delay, 0), 0, 1);
        dst.mute = !!src.mute;
        dst.solo = !!src.solo;
        var notes = [];
        if (Array.isArray(src.notes)) {
          for (var j = 0; j < src.notes.length; j++) {
            var nn = normalizeNote(src.notes[j]);
            if (nn) notes.push(nn);
          }
        }
        notes.sort(function (a, b) { return a[0] - b[0] || a[2] - b[2]; });
        dst.notes = notes;
      }
      s.meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
      return s;
    }

    // 楽譜の制約違反を調べる（日本語メッセージの配列を返す）
    function validateScore(score) {
      var problems = [];
      var total = totalBarsOf(score) * TICKS_PER_BAR;
      var introTicks = introBarsOf(score) * TICKS_PER_BAR;
      var drumParts = 0;
      for (var i = 0; i < score.parts.length; i++) {
        var part = score.parts[i];
        var drum = isDrumInstrument(part.instrument);
        if (drum) drumParts++;
        var notes = part.notes.slice().sort(function (a, b) { return a[0] - b[0]; });
        var label = 'パート' + (i + 1);
        for (var j = 0; j < notes.length; j++) {
          var n = notes[j];
          if (n[0] + n[1] > total) { problems.push(label + ': 曲の終わりを越える音符があります（tick ' + n[0] + '）'); break; }
        }
        if (introTicks > 0) {
          for (j = 0; j < notes.length; j++) {
            if (notes[j][0] < introTicks && notes[j][0] + notes[j][1] > introTicks) { problems.push(label + ': イントロとループの境目をまたぐ音符があります（tick ' + notes[j][0] + '）'); break; }
          }
        }
        if (drum) {
          var count = {};
          for (j = 0; j < notes.length; j++) {
            count[notes[j][0]] = (count[notes[j][0]] || 0) + 1;
            if (count[notes[j][0]] === DRUM_MAX_POLY + 1) problems.push(label + ': ドラムの同時発音が' + DRUM_MAX_POLY + '個を超えています（tick ' + notes[j][0] + '）');
          }
        } else {
          for (j = 1; j < notes.length; j++) {
            if (notes[j][0] < notes[j - 1][0] + notes[j - 1][1]) { problems.push(label + ': 音符が重なっています（1パートは同時に1音まで。tick ' + notes[j][0] + '）'); break; }
          }
        }
      }
      if (drumParts > 1) problems.push('ドラム音源のパートは1つまでです（現在 ' + drumParts + ' パート）');
      return problems;
    }

    // DSP 用の内部表現へ変換
    function compileScore(score) {
      var introTicks = introBarsOf(score) * TICKS_PER_BAR;
      var totalTicks = totalBarsOf(score) * TICKS_PER_BAR;
      var anySolo = score.parts.some(function (p) { return p.solo; });
      var parts = score.parts.map(function (p) {
        var drum = isDrumInstrument(p.instrument);
        var notes = [];
        var perTick = {};
        for (var j = 0; j < p.notes.length; j++) {
          var n = p.notes[j];
          var t = n[0], d = n[1];
          if (t >= totalTicks) continue;
          var limit = (introTicks > 0 && t < introTicks) ? introTicks : totalTicks;
          if (t + d > limit) d = limit - t;
          if (d <= 0) continue;
          if (drum) {
            perTick[t] = (perTick[t] || 0) + 1;
            if (perTick[t] > DRUM_MAX_POLY) continue;
          }
          notes.push([t, d, n[2], n[3]]);
        }
        notes.sort(function (a, b) { return a[0] - b[0]; });
        return {
          drum: drum,
          params: resolveParams(p.instrument, p.params),
          volume: p.volume, pan: p.pan, reverb: p.reverb, delay: p.delay,
          audible: anySolo ? p.solo : !p.mute,
          notes: notes
        };
      });
      return {
        bpm: score.bpm, introTicks: introTicks, totalTicks: totalTicks,
        master: score.master, parts: parts
      };
    }

    // ---------------------------------------------------------------
    // DSP 部品
    // ---------------------------------------------------------------
    function SVF() { this.ic1 = 0; this.ic2 = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 2; }
    SVF.prototype.set = function (fc, res, sr) {
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 10) fc = 10;
      var g = Math.tan(Math.PI * fc / sr);
      var k = 2 - 2 * clamp(res, 0, 0.97);
      this.k = k;
      this.a1 = 1 / (1 + g * (g + k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    };
    // mode: 0=LP 1=BP 2=HP
    SVF.prototype.run = function (v0, mode) {
      var v3 = v0 - this.ic2;
      var v1 = this.a1 * this.ic1 + this.a2 * v3;
      var v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
      this.ic1 = 2 * v1 - this.ic1;
      this.ic2 = 2 * v2 - this.ic2;
      if (mode === 0) return v2;
      if (mode === 1) return v1;
      return v0 - this.k * v1 - v2;
    };
    SVF.prototype.reset = function () { this.ic1 = 0; this.ic2 = 0; };

    function polyblep(t, dt) {
      if (t < dt) { t /= dt; return t + t - t * t - 1; }
      if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
      return 0;
    }

    var TWO_PI = Math.PI * 2;
    var CTRL = 16; // 制御レート（サンプル数）

    // 決定的な乱数（同じ楽譜からは毎回同じ音）
    function Rand(seed) { this.s = seed >>> 0 || 1; }
    Rand.prototype.next = function () {
      var t = (this.s += 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // ---- シンセボイス ----
    function SynthVoice(sr) {
      this.sr = sr; this.active = false; this.filter = new SVF();
      this.phases = new Float64Array(7); this.mphase = 0;
      this.rand = new Rand(12345);
    }
    SynthVoice.prototype.start = function (p, pitch, vel, gateSamples) {
      var sr = this.sr;
      this.p = p; this.active = true;
      this.freq0 = mtof(pitch + p.transpose) * Math.pow(2, p.detune / 1200);
      this.amp = Math.pow(vel / 127, 1.5) * p.gain;
      this.gate = Math.max(1, gateSamples | 0);
      this.age = 0; this.stage = 0; this.env = 0; this.fenv = 1; this.fmenv = 1;
      this.atkInc = 1 / (Math.max(p.attack, 0.0005) * sr);
      this.decCoef = Math.exp(-4.6 / (Math.max(p.decay, 0.001) * sr));
      this.relCoef = Math.exp(-4.6 / (Math.max(p.release, 0.003) * sr));
      this.fenvCoef = Math.exp(-4.6 * CTRL / (Math.max(p.filterDecay, 0.005) * sr));
      this.fmCoef = Math.exp(-4.6 / (Math.max(p.fmDecay, 0.005) * sr));
      this.useFilter = p.cutoff < 19000 || p.filterEnv > 0;
      this.filter.reset();
      this.mphase = 0;
      var n = p.osc === 'supersaw' ? clamp(Math.round(p.unison), 1, 7) : 1;
      this.nuni = n;
      for (var i = 0; i < 7; i++) this.phases[i] = n > 1 ? this.rand.next() : 0;
      this.vibDelay = p.vibratoDelay * sr;
    };
    SynthVoice.prototype.release = function () { if (this.stage < 3) this.stage = 3; };
    SynthVoice.prototype.kill = function () { this.stage = 4; this.relCoef = Math.exp(-4.6 / (0.004 * this.sr)); };
    SynthVoice.prototype.render = function (buf, off, n) {
      var p = this.p, sr = this.sr, osc = p.osc;
      var phases = this.phases;
      var i = 0;
      while (i < n && this.active) {
        var m = Math.min(CTRL, n - i);
        // 制御レートの計算
        var cents = 0;
        if (p.vibratoDepth > 0 && this.age > this.vibDelay) {
          var vt = (this.age - this.vibDelay) / sr;
          var fade = vt < 0.3 ? vt / 0.3 : 1;
          cents = Math.sin(TWO_PI * p.vibratoRate * this.age / sr) * p.vibratoDepth * fade;
        }
        var freq = this.freq0 * (cents ? Math.pow(2, cents / 1200) : 1);
        var dt = freq / sr;
        var duty = p.duty;
        if (p.pwmDepth > 0) duty = clamp(duty + Math.sin(TWO_PI * p.pwmRate * this.age / sr) * p.pwmDepth, 0.05, 0.95);
        if (this.useFilter) {
          var fc = p.cutoff * Math.pow(2, p.filterEnv * this.fenv);
          if (p.keyTrack > 0) fc *= Math.pow(freq / 261.63, p.keyTrack);
          this.filter.set(fc, p.resonance, sr);
          this.fenv *= this.fenvCoef;
        }
        var uniDt = null;
        if (osc === 'supersaw' && this.nuni > 1) {
          uniDt = [];
          for (var u = 0; u < this.nuni; u++) {
            var c = (u / (this.nuni - 1) - 0.5) * 2 * p.spread;
            uniDt.push(dt * Math.pow(2, c / 1200));
          }
        }
        for (var j = 0; j < m; j++) {
          var y, t = phases[0];
          if (osc === 'pulse') {
            y = (t < duty ? 1 : -1) + polyblep(t, dt) - polyblep((t + 1 - duty) % 1, dt) - (2 * duty - 1);
            t += dt; if (t >= 1) t -= 1; phases[0] = t;
          } else if (osc === 'saw') {
            y = 2 * t - 1 - polyblep(t, dt);
            t += dt; if (t >= 1) t -= 1; phases[0] = t;
          } else if (osc === 'tri') {
            y = 1 - 4 * Math.abs(t - 0.5);
            t += dt; if (t >= 1) t -= 1; phases[0] = t;
          } else if (osc === 'sine') {
            y = Math.sin(TWO_PI * t);
            t += dt; if (t >= 1) t -= 1; phases[0] = t;
          } else if (osc === 'fm') {
            var idx = p.fmIndex * (p.fmSustain + (1 - p.fmSustain) * this.fmenv);
            this.fmenv *= this.fmCoef;
            y = Math.sin(TWO_PI * t + idx * Math.sin(TWO_PI * this.mphase));
            this.mphase += dt * p.fmRatio; if (this.mphase >= 1) this.mphase -= Math.floor(this.mphase);
            t += dt; if (t >= 1) t -= 1; phases[0] = t;
          } else if (osc === 'supersaw') {
            if (uniDt) {
              y = 0;
              for (var k = 0; k < this.nuni; k++) {
                var tk = phases[k], dk = uniDt[k];
                y += 2 * tk - 1 - polyblep(tk, dk);
                tk += dk; if (tk >= 1) tk -= 1; phases[k] = tk;
              }
              y /= Math.sqrt(this.nuni);
            } else {
              y = 2 * t - 1 - polyblep(t, dt);
              t += dt; if (t >= 1) t -= 1; phases[0] = t;
            }
          } else { // noise
            y = this.rand.next() * 2 - 1;
          }
          // エンベロープ
          var st = this.stage;
          if (st === 0) { this.env += this.atkInc; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
          else if (st === 1) { this.env = p.sustain + (this.env - p.sustain) * this.decCoef; }
          else { this.env *= this.relCoef; }
          if (this.stage < 3 && --this.gate <= 0) this.stage = 3;
          if (p.drive > 0) y = Math.tanh(y * (1 + 3 * p.drive)) / (1 + p.drive * 0.5);
          if (this.useFilter) y = this.filter.run(y, 0);
          buf[off + i + j] += y * this.env * this.amp;
        }
        this.age += m;
        i += m;
        if (this.stage >= 3 && this.env < 1e-4) this.active = false;
        else if (this.stage === 1 && p.sustain <= 0 && this.env < 1e-4) this.active = false;
      }
    };

    // ---- ドラムボイス ----
    var DRUM_DEFS = {
      kick:    { f1: 160, f2: 46, pd: 0.035, ad: 0.32, tl: 1.0, nl: 0.12, nd: 0.008, nm: 2, nf: 2500, hold: 1 },
      snare:   { f1: 230, f2: 175, pd: 0.03, ad: 0.09, tl: 0.45, nl: 0.75, nd: 0.15, nm: 2, nf: 1400, hold: 2 },
      rim:     { f1: 820, f2: 790, pd: 0.01, ad: 0.025, tl: 0.6, nl: 0.25, nd: 0.015, nm: 2, nf: 3000, hold: 1 },
      clap:    { f1: 0, ad: 0, tl: 0, nl: 0.9, nd: 0.16, nm: 1, nf: 1300, hold: 2, clap: true },
      hat:     { f1: 0, ad: 0, tl: 0, nl: 0.42, nd: 0.04, nm: 2, nf: 7500, hold: 1 },
      openhat: { f1: 0, ad: 0, tl: 0, nl: 0.38, nd: 0.32, nm: 2, nf: 6800, hold: 1 },
      tomL:    { f1: 140, f2: 88, pd: 0.06, ad: 0.32, tl: 0.9, nl: 0.1, nd: 0.04, nm: 1, nf: 900, hold: 2 },
      tomM:    { f1: 195, f2: 125, pd: 0.06, ad: 0.28, tl: 0.9, nl: 0.1, nd: 0.04, nm: 1, nf: 1200, hold: 2 },
      tomH:    { f1: 260, f2: 170, pd: 0.06, ad: 0.24, tl: 0.9, nl: 0.1, nd: 0.04, nm: 1, nf: 1500, hold: 2 },
      crash:   { f1: 0, ad: 0, tl: 0, nl: 0.42, nd: 1.3, nm: 2, nf: 4500, hold: 1 },
      ride:    { f1: 3100, f2: 3100, pd: 1, ad: 0.5, tl: 0.05, nl: 0.25, nd: 0.7, nm: 2, nf: 6000, hold: 1 }
    };
    function DrumVoice(sr) { this.sr = sr; this.active = false; this.filter = new SVF(); this.rand = new Rand(777); }
    DrumVoice.prototype.start = function (kp, pitch, vel) {
      var info = DRUM_MAP[pitch];
      var def = DRUM_DEFS[info ? info.id : 'snare'];
      var sr = this.sr;
      this.kind = info ? info.id : 'snare';
      this.def = def; this.active = true; this.age = 0;
      this.chip = kp.kit === 'chip';
      var tune = Math.pow(2, kp.tune / 12);
      var dec = clamp(kp.decay, 0.2, 4);
      var toneMul = Math.pow(2, (kp.tone - 0.5) * 2);
      this.amp = Math.pow(vel / 127, 1.4) * kp.gain;
      this.f1 = def.f1 * tune; this.f2 = (def.f2 || def.f1) * tune;
      this.pdCoef = Math.exp(-1 / (Math.max(def.pd, 0.001) * sr));
      this.tEnv = def.tl; this.tCoef = def.ad > 0 ? Math.exp(-4.6 / (def.ad * dec * sr)) : 0;
      this.nEnv = def.nl; this.nCoef = Math.exp(-4.6 / (def.nd * dec * sr));
      this.pitchEnv = 1; this.phase = 0;
      this.filter.reset();
      this.filter.set(def.nf * toneMul, 0.2, sr);
      this.hold = this.chip ? def.hold * 3 : 1;
      this.holdCount = 0; this.nval = 0;
      this.lfsr = 1;
      this.clapT = 0;
      this.maxAge = sr * 3;
    };
    DrumVoice.prototype.choke = function () { this.nCoef = Math.exp(-4.6 / (0.01 * this.sr)); this.tCoef = this.nCoef; };
    DrumVoice.prototype.render = function (buf, off, n) {
      var def = this.def, sr = this.sr;
      for (var i = 0; i < n; i++) {
        var y = 0;
        if (def.tl > 0 && this.tEnv > 1e-5) {
          var f = this.f2 + (this.f1 - this.f2) * this.pitchEnv;
          this.pitchEnv *= this.pdCoef;
          this.phase += f / sr; if (this.phase >= 1) this.phase -= 1;
          var w = this.chip ? (1 - 4 * Math.abs(this.phase - 0.5)) : Math.sin(TWO_PI * this.phase);
          y += w * this.tEnv;
          this.tEnv *= this.tCoef;
        }
        if (this.nEnv > 1e-5) {
          if (this.holdCount-- <= 0) {
            this.holdCount = this.hold - 1;
            if (this.chip) {
              var bit = ((this.lfsr >> 0) ^ (this.lfsr >> 1)) & 1;
              this.lfsr = (this.lfsr >> 1) | (bit << 14);
              this.nval = (this.lfsr & 1) ? 1 : -1;
            } else this.nval = this.rand.next() * 2 - 1;
          }
          var ne = this.nEnv;
          if (def.clap) {
            var ms = this.age / sr;
            if (ms < 0.03) ne = def.nl * (1 - ((ms * 100) % 1) * 0.8);
          }
          y += this.filter.run(this.nval, def.nm) * ne;
          if (!def.clap || this.age / sr >= 0.03) this.nEnv *= this.nCoef;
        }
        if (this.chip) y = Math.round(y * 6) / 6;
        buf[off + i] += y * this.amp;
        this.age++;
      }
      if ((this.tEnv <= 1e-5 || def.tl === 0) && this.nEnv <= 1e-5) this.active = false;
      if (this.age > this.maxAge) this.active = false;
    };

    // ---- エフェクト ----
    function Comb(len) { this.buf = new Float32Array(len); this.i = 0; this.store = 0; }
    function Allpass(len) { this.buf = new Float32Array(len); this.i = 0; }
    function Reverb(sr) {
      var sc = sr / 44100;
      var cl = [1116, 1188, 1277, 1356], al = [556, 441];
      this.cL = cl.map(function (l) { return new Comb(Math.round(l * sc)); });
      this.cR = cl.map(function (l) { return new Comb(Math.round((l + 23) * sc)); });
      this.aL = al.map(function (l) { return new Allpass(Math.round(l * sc)); });
      this.aR = al.map(function (l) { return new Allpass(Math.round((l + 23) * sc)); });
      this.fb = 0.84; this.damp = 0.5;
    }
    Reverb.prototype.set = function (size, damp) { this.fb = 0.7 + size * 0.28; this.damp = damp * 0.6; };
    Reverb.prototype.process = function (inp, outL, outR, n) {
      var fb = this.fb, d = this.damp, d1 = 1 - d;
      for (var s = 0; s < n; s++) {
        var x = inp[s] * 0.03, yl = 0, yr = 0, c, o, k;
        for (k = 0; k < 4; k++) {
          c = this.cL[k]; o = c.buf[c.i]; c.store = o * d1 + c.store * d; c.buf[c.i] = x + c.store * fb; if (++c.i >= c.buf.length) c.i = 0; yl += o;
          c = this.cR[k]; o = c.buf[c.i]; c.store = o * d1 + c.store * d; c.buf[c.i] = x + c.store * fb; if (++c.i >= c.buf.length) c.i = 0; yr += o;
        }
        for (k = 0; k < 2; k++) {
          var a = this.aL[k]; o = a.buf[a.i]; a.buf[a.i] = yl + o * 0.5; yl = o - yl; if (++a.i >= a.buf.length) a.i = 0;
          a = this.aR[k]; o = a.buf[a.i]; a.buf[a.i] = yr + o * 0.5; yr = o - yr; if (++a.i >= a.buf.length) a.i = 0;
        }
        outL[s] = yl; outR[s] = yr;
      }
    };
    function Delay(sr) { this.sr = sr; this.len = Math.ceil(sr * 4); this.L = new Float32Array(this.len); this.R = new Float32Array(this.len); this.w = 0; this.d = sr / 2; this.fb = 0.35; this.lpL = 0; this.lpR = 0; }
    Delay.prototype.set = function (seconds, fb) { this.d = clamp(Math.round(seconds * this.sr), 1, this.len - 1); this.fb = fb; };
    Delay.prototype.process = function (inp, outL, outR, n) {
      var len = this.len, fb = this.fb;
      for (var s = 0; s < n; s++) {
        var r = this.w - this.d; if (r < 0) r += len;
        var dl = this.L[r], dr = this.R[r];
        this.lpL += (dl - this.lpL) * 0.35; this.lpR += (dr - this.lpR) * 0.35;
        // ピンポン
        this.L[this.w] = inp[s] + this.lpR * fb;
        this.R[this.w] = this.lpL * fb;
        if (++this.w >= len) this.w = 0;
        outL[s] = dl; outR[s] = dr;
      }
    };

    // ---- パート ----
    var MAX_SYNTH_VOICES = 4, MAX_DRUM_VOICES = 8;
    function PartState(sr) { this.sr = sr; this.voices = []; this.cur = null; this.isDrum = false; this.params = null; }
    PartState.prototype.noteOn = function (pitch, vel, gateSamples) {
      var v, i;
      if (this.isDrum) {
        var kind = DRUM_MAP[pitch] ? DRUM_MAP[pitch].id : '';
        if (kind === 'hat' || kind === 'openhat') {
          for (i = 0; i < this.voices.length; i++) {
            var ov = this.voices[i];
            if (ov.active && (ov.kind === 'openhat' || (kind === 'openhat' && ov.kind === 'hat'))) ov.choke();
          }
        }
        v = this._alloc(MAX_DRUM_VOICES, DrumVoice);
        v.start(this.params, pitch, vel);
      } else {
        if (this.cur && this.cur.active) this.cur.release();
        v = this._alloc(MAX_SYNTH_VOICES, SynthVoice);
        v.start(this.params, pitch, vel, gateSamples);
        this.cur = v;
      }
    };
    PartState.prototype._alloc = function (max, Ctor) {
      for (var i = 0; i < this.voices.length; i++) if (!this.voices[i].active && this.voices[i] instanceof Ctor) return this.voices[i];
      if (this.voices.length < max) { var nv = new Ctor(this.sr); this.voices.push(nv); return nv; }
      // 最も古いボイスを再利用
      var oldest = null;
      for (i = 0; i < this.voices.length; i++) if (this.voices[i] instanceof Ctor && (!oldest || this.voices[i].age > oldest.age)) oldest = this.voices[i];
      return oldest;
    };
    PartState.prototype.releaseAll = function () { for (var i = 0; i < this.voices.length; i++) if (this.voices[i].release) this.voices[i].release(); };
    PartState.prototype.killAll = function () { for (var i = 0; i < this.voices.length; i++) this.voices[i].active = false; this.cur = null; };
    PartState.prototype.render = function (buf, n) {
      var any = false;
      for (var i = 0; i < this.voices.length; i++) {
        var v = this.voices[i];
        if (v.active) { v.render(buf, 0, n); any = true; }
      }
      return any;
    };

    // ---------------------------------------------------------------
    // エンジン（シーケンサ＋ミキサ）
    // ---------------------------------------------------------------
    var BLOCK = 128;
    function Engine(sampleRate) {
      this.sr = sampleRate;
      this.parts = [];
      for (var i = 0; i < NUM_PARTS; i++) this.parts.push(new PartState(sampleRate));
      this.reverb = new Reverb(sampleRate);
      this.delay = new Delay(sampleRate);
      this.compiled = null;
      this.playing = false;
      this.tick = 0;
      this.idx = new Int32Array(NUM_PARTS);
      this.loop = true; this.loopStart = 0; this.loopEnd = 0;
      this.loopCount = 0;
      this.partBuf = new Float32Array(BLOCK);
      this.revIn = new Float32Array(BLOCK); this.delIn = new Float32Array(BLOCK);
      this.revL = new Float32Array(BLOCK); this.revR = new Float32Array(BLOCK);
      this.delL = new Float32Array(BLOCK); this.delR = new Float32Array(BLOCK);
      this.panL = new Float32Array(NUM_PARTS); this.panR = new Float32Array(NUM_PARTS);
      this.onPosition = null;
      this.posEvery = Math.round(sampleRate / 30);
      this.posCounter = 0;
      this.tps = 0; // tick / sample
      this.masterGain = 0.8;
    }
    Engine.prototype.setScore = function (score) {
      var s = normalizeScore(score);
      var c = compileScore(s);
      this.compiled = c;
      this.tps = c.bpm * PPQ / 60 / this.sr;
      for (var i = 0; i < NUM_PARTS; i++) {
        var cp = c.parts[i], ps = this.parts[i];
        if (ps.isDrum !== cp.drum) ps.killAll();
        ps.isDrum = cp.drum; ps.params = cp.params;
        var a = (cp.pan + 1) * Math.PI / 4;
        this.panL[i] = Math.cos(a) * cp.volume; this.panR[i] = Math.sin(a) * cp.volume;
      }
      var m = c.master;
      this.reverb.set(m.reverb.size, m.reverb.damp);
      this.delay.set(m.delay.beats * 60 / c.bpm, m.delay.feedback);
      this.masterGain = m.volume;
      if (this.playing) {
        if (this._autoLoop) { this.loopStart = c.introTicks; this.loopEnd = c.totalTicks; }
        this.loopEnd = Math.min(this.loopEnd, c.totalTicks);
        if (this.loopStart >= this.loopEnd) this.loopStart = 0;
        if (this.tick >= c.totalTicks) this.tick = this.loopStart;
        this._seek(this.tick);
      }
    };
    Engine.prototype._seek = function (tick) {
      var c = this.compiled;
      for (var i = 0; i < NUM_PARTS; i++) {
        var notes = c.parts[i].notes, lo = 0, hi = notes.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (notes[mid][0] < tick - 1e-6) lo = mid + 1; else hi = mid; }
        this.idx[i] = lo;
      }
    };
    // opts: { startTick, loop(bool), loopStart, loopEnd }
    Engine.prototype.play = function (opts) {
      if (!this.compiled) return;
      opts = opts || {};
      var c = this.compiled;
      this.loop = opts.loop !== false;
      this._autoLoop = opts.loopStart == null && opts.loopEnd == null;
      this.loopStart = opts.loopStart != null ? clamp(opts.loopStart, 0, c.totalTicks) : c.introTicks;
      this.loopEnd = opts.loopEnd != null ? clamp(opts.loopEnd, 0, c.totalTicks) : c.totalTicks;
      if (this.loopEnd <= this.loopStart) { this.loopStart = 0; this.loopEnd = c.totalTicks; }
      this.tick = clamp(opts.startTick || 0, 0, c.totalTicks - 1e-6);
      this.loopCount = 0;
      this._seek(this.tick);
      this.playing = true;
      this.posCounter = 0;
    };
    Engine.prototype.stop = function (hard) {
      this.playing = false;
      for (var i = 0; i < NUM_PARTS; i++) { if (hard) this.parts[i].killAll(); else this.parts[i].releaseAll(); }
      if (this.onPosition) this.onPosition(this.tick, false, this.loopCount);
    };
    Engine.prototype.preview = function (partIndex, pitch, vel, seconds) {
      if (!this.compiled) return;
      var ps = this.parts[partIndex];
      if (!ps || !ps.params) return;
      ps.noteOn(pitch, vel || 100, Math.round((seconds || 0.3) * this.sr));
    };
    Engine.prototype.handle = function (msg) {
      if (!msg) return;
      if (msg.type === 'score') this.setScore(msg.score);
      else if (msg.type === 'play') this.play(msg.opts);
      else if (msg.type === 'stop') this.stop(msg.hard);
      else if (msg.type === 'preview') this.preview(msg.part, msg.pitch, msg.vel, msg.seconds);
    };
    Engine.prototype._trigger = function () {
      var c = this.compiled, tick = this.tick;
      var spt = 1 / this.tps;
      for (var i = 0; i < NUM_PARTS; i++) {
        var cp = c.parts[i], notes = cp.notes, j = this.idx[i];
        while (j < notes.length && notes[j][0] <= tick + 1e-6) {
          var n = notes[j];
          if (n[0] >= this.loopEnd - 1e-6) break;
          if (cp.audible) {
            var dur = Math.min(n[0] + n[1], this.loopEnd) - n[0];
            this.parts[i].noteOn(n[2], n[3], dur * spt);
          }
          j++;
        }
        this.idx[i] = j;
      }
    };
    Engine.prototype._nextEventTick = function () {
      var c = this.compiled, next = this.loopEnd;
      for (var i = 0; i < NUM_PARTS; i++) {
        var notes = c.parts[i].notes, j = this.idx[i];
        if (j < notes.length && notes[j][0] < next) next = notes[j][0];
      }
      return next;
    };
    // L, R に n サンプル書き込む（加算ではなく上書き）
    Engine.prototype.process = function (L, R, offset, n) {
      offset = offset || 0;
      var pos = 0;
      while (pos < n) {
        var frames = Math.min(BLOCK, n - pos);
        if (this.playing && this.compiled) {
          if (this.tick >= this.loopEnd - 1e-6) {
            if (this.loop) {
              this.tick = this.loopStart + (this.tick - this.loopEnd);
              this.loopCount++;
              this._seek(this.loopStart);
            } else { this.stop(); continue; }
          }
          this._trigger();
          var nt = this._nextEventTick();
          var f = Math.ceil((nt - this.tick) / this.tps - 1e-9);
          if (f < 1) f = 1;
          if (f < frames) frames = f;
        }
        this._renderBlock(L, R, offset + pos, frames);
        if (this.playing) this.tick += frames * this.tps;
        pos += frames;
        this.posCounter += frames;
        if (this.posCounter >= this.posEvery) {
          this.posCounter = 0;
          if (this.onPosition) this.onPosition(this.tick, this.playing, this.loopCount);
        }
      }
    };
    Engine.prototype._renderBlock = function (L, R, off, n) {
      var pb = this.partBuf, ri = this.revIn, di = this.delIn, i, s;
      for (s = 0; s < n; s++) { L[off + s] = 0; R[off + s] = 0; ri[s] = 0; di[s] = 0; }
      var c = this.compiled;
      for (i = 0; i < NUM_PARTS; i++) {
        var ps = this.parts[i];
        if (!ps.voices.length) continue;
        for (s = 0; s < n; s++) pb[s] = 0;
        if (!ps.render(pb, n)) continue;
        var gl = this.panL[i], gr = this.panR[i];
        var cp = c ? c.parts[i] : null;
        var rv = cp ? cp.reverb * cp.volume : 0, dl = cp ? cp.delay * cp.volume : 0;
        for (s = 0; s < n; s++) {
          var x = pb[s];
          L[off + s] += x * gl; R[off + s] += x * gr;
          ri[s] += x * rv; di[s] += x * dl;
        }
      }
      if (!c) return;
      this.reverb.process(ri, this.revL, this.revR, n);
      this.delay.process(di, this.delL, this.delR, n);
      var rl = c.master.reverb.level, dlv = c.master.delay.level, g = this.masterGain;
      for (s = 0; s < n; s++) {
        L[off + s] = softclip((L[off + s] + this.revL[s] * rl + this.delL[s] * dlv) * g);
        R[off + s] = softclip((R[off + s] + this.revR[s] * rl + this.delR[s] * dlv) * g);
      }
    };
    function softclip(x) {
      var a = x < 0 ? -x : x;
      if (a <= 0.6) return x;
      var y = 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4);
      return x < 0 ? -y : y;
    }

    return {
      PPQ: PPQ, BEATS_PER_BAR: BEATS_PER_BAR, TICKS_PER_BAR: TICKS_PER_BAR,
      NUM_PARTS: NUM_PARTS, DRUM_MAX_POLY: DRUM_MAX_POLY,
      FORMAT_NAME: FORMAT_NAME, FORMAT_VERSION: FORMAT_VERSION, NOTE_NAMES: NOTE_NAMES,
      PRESETS: PRESETS, SYNTH_DEFAULTS: SYNTH_DEFAULTS, DRUM_DEFAULTS: DRUM_DEFAULTS, DRUM_MAP: DRUM_MAP,
      resolveParams: resolveParams, isDrumInstrument: isDrumInstrument,
      createEmptyScore: createEmptyScore, normalizeScore: normalizeScore, validateScore: validateScore,
      compileScore: compileScore, introBarsOf: introBarsOf, totalBarsOf: totalBarsOf,
      Engine: Engine
    };
  }

  var DSP = BGM_DSP();

  // ===================================================================
  // 時間計算
  // ===================================================================
  function timing(score) {
    var s = DSP.normalizeScore(score);
    var secPerTick = 60 / (s.bpm * DSP.PPQ);
    var introTicks = DSP.introBarsOf(s) * DSP.TICKS_PER_BAR;
    var loopTicks = s.loopBars * DSP.TICKS_PER_BAR;
    return {
      bpm: s.bpm, secPerTick: secPerTick,
      introTicks: introTicks, loopTicks: loopTicks, totalTicks: introTicks + loopTicks,
      introSeconds: introTicks * secPerTick, loopSeconds: loopTicks * secPerTick,
      totalSeconds: (introTicks + loopTicks) * secPerTick
    };
  }

  // ===================================================================
  // オフライン書き出し
  // ===================================================================
  // opts.mode:
  //   'listen' : イントロ + ループ×loops + フェードアウト（試聴・保存用）
  //   'game'   : イントロ + ループ1周。ループ部分は「2周目」を使うので、ループの
  //              先頭に前の周の余韻が入っていて継ぎ目なくループできる。
  //   'intro'  : 'game' のイントロ部分だけ
  //   'loop'   : 'game' のループ部分だけ（単体で継ぎ目なくループ可能）
  // 戻り値: { sampleRate, frames, data: Int16Array(ステレオ交互), loopStart, loopEnd }
  //   loopStart/loopEnd はこのデータ内でのループ範囲（サンプル位置、loopEnd は含まない）
  function renderPCM(score, opts, onProgress) {
    return new Promise(function (resolve, reject) {
      try {
        opts = opts || {};
        var s = DSP.normalizeScore(score);
        var sr = opts.sampleRate || 44100;
        var mode = opts.mode || 'listen';
        var loops = Math.max(1, Math.round(opts.loops || 1));
        var fadeSec = opts.fadeOut != null ? opts.fadeOut : 8;
        var tm = timing(s);
        var spt = sr * tm.secPerTick;
        var I = Math.round(tm.introTicks * spt);
        var Lf = Math.round(tm.loopTicks * spt);
        // 出力に使う範囲 [srcStart, srcEnd) の列（レンダリング上の位置）
        var ranges, renderTotal, loopStart = -1, loopEnd = -1, fadeFrames = 0;
        if (mode === 'listen') {
          fadeFrames = Math.round(fadeSec * sr);
          renderTotal = I + Lf * loops + fadeFrames;
          ranges = [[0, renderTotal]];
        } else if (mode === 'game' || mode === 'intro' || mode === 'loop') {
          renderTotal = I + Lf * 2;
          if (mode === 'game') { ranges = [[0, I], [I + Lf, I + 2 * Lf]]; loopStart = I; loopEnd = I + Lf; }
          else if (mode === 'intro') { ranges = [[0, I]]; }
          else { ranges = [[I + Lf, I + 2 * Lf]]; loopStart = 0; loopEnd = Lf; }
        } else throw new Error('不明な書き出しモード: ' + mode);
        var outFrames = 0;
        ranges.forEach(function (r) { outFrames += r[1] - r[0]; });
        var data = new Int16Array(outFrames * 2);
        var eng = new DSP.Engine(sr);
        eng.setScore(s);
        eng.play({ startTick: 0 });
        var CH = 4096;
        var bl = new Float32Array(CH), br = new Float32Array(CH);
        var rpos = 0, wpos = 0;
        var fadeStart = renderTotal - fadeFrames;
        var step = function () {
          var deadline = Date.now() + 40;
          while (rpos < renderTotal) {
            var n = Math.min(CH, renderTotal - rpos);
            eng.process(bl, br, 0, n);
            for (var i = 0; i < n; i++) {
              var p = rpos + i;
              var use = false;
              for (var k = 0; k < ranges.length; k++) if (p >= ranges[k][0] && p < ranges[k][1]) { use = true; break; }
              if (!use) continue;
              var g = 1;
              if (fadeFrames > 0 && p >= fadeStart) g = 1 - (p - fadeStart) / fadeFrames;
              var l = bl[i] * g, r = br[i] * g;
              data[wpos * 2] = l >= 1 ? 32767 : (l <= -1 ? -32768 : Math.round(l * 32767));
              data[wpos * 2 + 1] = r >= 1 ? 32767 : (r <= -1 ? -32768 : Math.round(r * 32767));
              wpos++;
            }
            rpos += n;
            if (Date.now() > deadline) break;
          }
          if (onProgress) onProgress(rpos / renderTotal);
          if (rpos < renderTotal) setTimeout(step, 0);
          else resolve({ sampleRate: sr, frames: outFrames, data: data, loopStart: loopStart, loopEnd: loopEnd });
        };
        step();
      } catch (e) { reject(e); }
    });
  }

  // 16bit ステレオ WAV。loop を渡すと smpl チャンク（ループ情報）を付ける
  function encodeWAV(pcm) {
    var sr = pcm.sampleRate, frames = pcm.frames;
    var hasLoop = pcm.loopStart >= 0 && pcm.loopEnd > pcm.loopStart;
    var dataBytes = frames * 4;
    var smplBytes = hasLoop ? 8 + 60 : 0;
    var buf = new ArrayBuffer(44 + dataBytes + smplBytes);
    var v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes + smplBytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataBytes, true);
    var out = new Int16Array(buf, 44, frames * 2);
    out.set(pcm.data);
    if (hasLoop) {
      var o = 44 + dataBytes;
      str(o, 'smpl'); v.setUint32(o + 4, 60, true);
      var f = [0, 0, Math.round(1e9 / sr), 60, 0, 0, 0, 1, 0, 0, 0, pcm.loopStart, pcm.loopEnd - 1, 0, 0];
      for (var i = 0; i < f.length; i++) v.setUint32(o + 8 + i * 4, f[i] >>> 0, true);
    }
    return new Uint8Array(buf);
  }

  function renderWAV(score, opts, onProgress) {
    return renderPCM(score, opts, onProgress).then(function (pcm) {
      return { wav: encodeWAV(pcm), sampleRate: pcm.sampleRate, frames: pcm.frames, loopStart: pcm.loopStart, loopEnd: pcm.loopEnd };
    });
  }

  // ===================================================================
  // ブラウザ用のリアルタイムプレイヤー
  // ===================================================================
  var WORKLET_SOURCE =
    'var DSP = (' + BGM_DSP.toString() + ')();\n' +
    'class CustomBGMProcessor extends AudioWorkletProcessor {\n' +
    '  constructor() { super(); var self = this; this.engine = new DSP.Engine(sampleRate);\n' +
    '    this.engine.onPosition = function (t, pl, lc) { self.port.postMessage({ type: "pos", tick: t, playing: pl, loops: lc }); };\n' +
    '    this.port.onmessage = function (e) { try { self.engine.handle(e.data); } catch (err) { self.port.postMessage({ type: "error", message: String(err && err.message || err) }); } }; }\n' +
    '  process(inputs, outputs) { var o = outputs[0]; var L = o[0]; var R = o[1] || new Float32Array(L.length); this.engine.process(L, R, 0, L.length); return true; }\n' +
    '}\n' +
    'registerProcessor("custombgm-processor", CustomBGMProcessor);\n';

  function Player(opts) {
    opts = opts || {};
    this.ctx = opts.audioContext || null;
    this.destination = opts.destination || null;
    this._volume = opts.volume != null ? opts.volume : 0.8;
    this.forceScriptProcessor = !!opts.forceScriptProcessor;
    this.score = null;
    this.tick = 0;
    this.playing = false;
    this.loops = 0;
    this.onPosition = null;
    this.onError = null;
    this.backend = null;
    this._ready = null;
    this._posTime = 0;
  }
  Player.prototype._ensure = function () {
    var self = this;
    if (this._ready) return this._ready;
    this._ready = (async function () {
      var AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!self.ctx) {
        if (!AC) throw new Error('この環境では Web Audio API が使えません');
        self.ctx = new AC();
      }
      var ctx = self.ctx;
      self.gain = ctx.createGain();
      self.gain.gain.value = self._volume;
      self.gain.connect(self.destination || ctx.destination);
      var onMsg = function (d) {
        if (d.type === 'pos') {
          self.tick = d.tick; self.playing = d.playing; self.loops = d.loops;
          self._posTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (self.onPosition) self.onPosition(d.tick, d.playing);
        } else if (d.type === 'error' && self.onError) self.onError(new Error(d.message));
      };
      var ok = false;
      if (!self.forceScriptProcessor && ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          // blob: URL（http(s) で開いた場合）→ data: URL（file:// で開いた場合）の順に試す
          var loaded = false, lastErr = null;
          var makers = [
            function () { return URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' })); },
            function () { return 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(WORKLET_SOURCE))); }
          ];
          for (var mi = 0; mi < makers.length && !loaded; mi++) {
            var url = null;
            try { url = makers[mi](); await ctx.audioWorklet.addModule(url); loaded = true; }
            catch (err) { lastErr = err; }
            if (url && url.indexOf('blob:') === 0) URL.revokeObjectURL(url);
          }
          if (!loaded) throw lastErr || new Error('worklet');
          var node = new AudioWorkletNode(ctx, 'custombgm-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
          node.port.onmessage = function (e) { onMsg(e.data); };
          node.connect(self.gain);
          self.node = node;
          self._send = function (m) { node.port.postMessage(m); };
          self.backend = 'audioworklet';
          ok = true;
        } catch (e) { ok = false; }
      }
      if (!ok) {
        var eng = new DSP.Engine(ctx.sampleRate);
        eng.onPosition = function (t, pl, lc) { onMsg({ type: 'pos', tick: t, playing: pl, loops: lc }); };
        var sp = ctx.createScriptProcessor(2048, 0, 2);
        sp.onaudioprocess = function (e) {
          var L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
          try { eng.process(L, R, 0, L.length); } catch (err) { if (self.onError) self.onError(err); }
        };
        sp.connect(self.gain);
        self.node = sp;
        self._send = function (m) { try { eng.handle(m); } catch (err) { if (self.onError) self.onError(err); } };
        self.backend = 'scriptprocessor';
      }
      if (self.score) self._send({ type: 'score', score: self.score });
    })();
    return this._ready;
  };
  // 楽譜を読み込む（オブジェクトまたは JSON 文字列）
  Player.prototype.load = function (score) {
    this.score = DSP.normalizeScore(score);
    var self = this;
    return this._ensure().then(function () { self._send({ type: 'score', score: self.score }); });
  };
  // 再生中でも楽譜を差し替え可能（エディタ用）
  Player.prototype.update = function (score) {
    this.score = DSP.normalizeScore(score);
    if (this._send) this._send({ type: 'score', score: this.score });
  };
  // 再生開始。opts: { startTick, loop, loopStart, loopEnd, fadeIn(秒) }
  // 既定では「イントロ → ループ部分を無限に繰り返す」
  Player.prototype.play = function (opts) {
    opts = opts || {};
    var self = this;
    return this._ensure().then(function () {
      var ctx = self.ctx;
      var resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      return resume.then(function () {
        var g = self.gain.gain, now = ctx.currentTime;
        if (self._stopTimer) { clearTimeout(self._stopTimer); self._stopTimer = null; }
        g.cancelScheduledValues(now);
        if (opts.fadeIn > 0) { g.setValueAtTime(0, now); g.linearRampToValueAtTime(self._volume, now + opts.fadeIn); }
        else g.setValueAtTime(self._volume, now);
        self._send({ type: 'play', opts: { startTick: opts.startTick || 0, loop: opts.loop, loopStart: opts.loopStart, loopEnd: opts.loopEnd } });
        self.playing = true;
      });
    });
  };
  // 停止。opts: { fadeOut(秒) }
  Player.prototype.stop = function (opts) {
    opts = opts || {};
    if (!this._send) return;
    var self = this, ctx = this.ctx, g = this.gain.gain, now = ctx.currentTime;
    if (opts.fadeOut > 0) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + opts.fadeOut);
      if (this._stopTimer) clearTimeout(this._stopTimer);
      this._stopTimer = setTimeout(function () {
        self._stopTimer = null;
        self._send({ type: 'stop', hard: true });
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(self._volume, ctx.currentTime);
      }, opts.fadeOut * 1000 + 30);
    } else {
      this._send({ type: 'stop' });
    }
    this.playing = false;
  };
  Player.prototype.setVolume = function (v, seconds) {
    this._volume = v;
    if (!this.gain) return;
    var g = this.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    if (seconds > 0) { g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(v, now + seconds); }
    else g.setValueAtTime(v, now);
  };
  // 1音だけ鳴らす（エディタの試し弾き用）
  Player.prototype.preview = function (part, pitch, vel, seconds) {
    var self = this;
    return this._ensure().then(function () {
      if (self.ctx.state === 'suspended') return self.ctx.resume();
    }).then(function () {
      if (!self.playing) { var g = self.gain.gain; g.cancelScheduledValues(self.ctx.currentTime); g.setValueAtTime(self._volume, self.ctx.currentTime); }
      self._send({ type: 'preview', part: part, pitch: pitch, vel: vel || 100, seconds: seconds || 0.3 });
    });
  };
  // 現在位置（tick）を推定（表示用に補間）
  Player.prototype.currentTick = function () {
    if (!this.playing || !this.score) return this.tick;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var dt = Math.min(0.1, (now - this._posTime) / 1000);
    return this.tick + dt * this.score.bpm * DSP.PPQ / 60;
  };
  Player.prototype.dispose = function () {
    try { if (this.node) this.node.disconnect(); if (this.gain) this.gain.disconnect(); } catch (e) { /* noop */ }
    this.node = null; this._send = null; this._ready = null;
  };

  var api = {};
  for (var k in DSP) api[k] = DSP[k];
  api.version = '1.0.0';
  api.timing = timing;
  api.renderPCM = renderPCM;
  api.encodeWAV = encodeWAV;
  api.renderWAV = renderWAV;
  api.Player = Player;
  api._WORKLET_SOURCE = WORKLET_SOURCE;
  return api;
});
