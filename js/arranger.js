/*
 * 設計図（プラン）→ 音符 のルールベース生成器。
 * 設計図は AI が作っても、手で書いてもよい。メロディは作らない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../engine/bgm-engine.js'));
  else root.CustomBGMArranger = factory(root.CustomBGM);
})(typeof self !== 'undefined' ? self : this, function (BGM) {
  'use strict';

  var TPB = BGM.TICKS_PER_BAR; // 192
  var BEAT = BGM.PPQ;          // 48
  var NOTE_NAMES = BGM.NOTE_NAMES;

  var ROLES = {
    bass:     { label: 'ベース', maxParts: 1, defaultPattern: 'bass_eighth', defaultInstrument: 'triBass', volume: 0.85, reverb: 0.05, delay: 0 },
    chords:   { label: '和音', maxParts: 4, defaultPattern: 'chords_sustain', defaultInstrument: 'pad', volume: 0.6, reverb: 0.35, delay: 0 },
    arpeggio: { label: 'アルペジオ', maxParts: 1, defaultPattern: 'arp_up16', defaultInstrument: 'pulse12', volume: 0.55, reverb: 0.3, delay: 0.3 },
    ostinato: { label: '刻み', maxParts: 1, defaultPattern: 'ost_pulse8', defaultInstrument: 'pluck', volume: 0.5, reverb: 0.25, delay: 0.15 },
    drums:    { label: 'ドラム', maxParts: 1, defaultPattern: 'drums_eight_beat', defaultInstrument: 'drumElectro', volume: 0.85, reverb: 0.12, delay: 0 }
  };

  var PATTERNS = {
    bass_whole:        { role: 'bass', label: 'コードごとに伸ばす' },
    bass_half:         { role: 'bass', label: '2分音符' },
    bass_quarter:      { role: 'bass', label: '4分音符でルート' },
    bass_eighth:       { role: 'bass', label: '8分音符でルート刻み' },
    bass_octave:       { role: 'bass', label: '8分でオクターブ跳躍' },
    bass_root_fifth:   { role: 'bass', label: '4分でルートと5度' },
    bass_walking:      { role: 'bass', label: '4分のウォーキング（次のコードへ経過音）' },
    bass_syncopated:   { role: 'bass', label: 'シンコペーション（3+3+2）' },
    bass_gallop:       { role: 'bass', label: 'ギャロップ（8分+16分×2）' },
    chords_sustain:    { role: 'chords', label: 'コードごとに伸ばす' },
    chords_half:       { role: 'chords', label: '2分音符で弾き直す' },
    chords_offbeat:    { role: 'chords', label: '裏拍の8分（裏打ち）' },
    chords_eighth:     { role: 'chords', label: '8分音符で刻む' },
    chords_syncopated: { role: 'chords', label: 'シンコペーション（3+3+2）' },
    chords_stab:       { role: 'chords', label: '短く切るスタブ（3+3+2）' },
    arp_up8:           { role: 'arpeggio', label: '8分で上昇' },
    arp_up16:          { role: 'arpeggio', label: '16分で上昇' },
    arp_updown16:      { role: 'arpeggio', label: '16分で上昇→下降' },
    arp_down8:         { role: 'arpeggio', label: '8分で下降' },
    arp_broken8:       { role: 'arpeggio', label: '8分の分散和音（1-5-8-5）' },
    ost_pulse8:        { role: 'ostinato', label: 'コード構成音を8分で刻む' },
    ost_pulse16:       { role: 'ostinato', label: 'コード構成音を16分で刻む' },
    ost_pedal8:        { role: 'ostinato', label: '主音を8分で刻む（ペダル）' },
    drums_four_on_floor:{ role: 'drums', label: '4つ打ち' },
    drums_eight_beat:  { role: 'drums', label: '8ビート' },
    drums_half_time:   { role: 'drums', label: 'ハーフタイム' },
    drums_breakbeat:   { role: 'drums', label: 'ブレイクビーツ' },
    drums_sixteen_beat:{ role: 'drums', label: '16ビート' },
    drums_sparse:      { role: 'drums', label: '控えめ（キックと軽いハット）' }
  };

  var ENDINGS = {
    none:  'なし',
    fill:  'フィル（最後の小節にドラムのおかず）',
    break: 'ブレイク（最後の小節の1拍目以降を止める）',
    build: 'ビルドアップ（最後の2小節で盛り上げる）'
  };

  // ---------------------------------------------------------------
  // コード記号
  // ---------------------------------------------------------------
  var QUALITIES = [
    ['', [0, 4, 7]], ['maj', [0, 4, 7]], ['M', [0, 4, 7]],
    ['m', [0, 3, 7]], ['min', [0, 3, 7]], ['-', [0, 3, 7]],
    ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['M7', [0, 4, 7, 11]], ['△7', [0, 4, 7, 11]],
    ['m7', [0, 3, 7, 10]], ['min7', [0, 3, 7, 10]], ['-7', [0, 3, 7, 10]],
    ['mM7', [0, 3, 7, 11]], ['mmaj7', [0, 3, 7, 11]],
    ['dim', [0, 3, 6]], ['o', [0, 3, 6]], ['dim7', [0, 3, 6, 9]], ['o7', [0, 3, 6, 9]],
    ['m7b5', [0, 3, 6, 10]], ['m7-5', [0, 3, 6, 10]], ['ø', [0, 3, 6, 10]],
    ['aug', [0, 4, 8]], ['+', [0, 4, 8]],
    ['sus4', [0, 5, 7]], ['sus', [0, 5, 7]], ['sus2', [0, 2, 7]], ['7sus4', [0, 5, 7, 10]],
    ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
    ['add9', [0, 4, 7, 14]], ['madd9', [0, 3, 7, 14]],
    ['9', [0, 4, 7, 10, 14]], ['m9', [0, 3, 7, 10, 14]], ['maj9', [0, 4, 7, 11, 14]], ['M9', [0, 4, 7, 11, 14]],
    ['5', [0, 7]]
  ];
  var QMAP = {};
  QUALITIES.forEach(function (q) { QMAP[q[0]] = q[1]; });

  function pcOf(name) {
    var m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name);
    if (!m) return -1;
    var base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    if (m[2] === '#' || m[2] === '♯') base += 1;
    if (m[2] === 'b' || m[2] === '♭') base -= 1;
    return (base + 12) % 12;
  }

  // 戻り値: null（休み）/ { root, bass, intervals, symbol, unknown }
  function parseChord(sym) {
    sym = String(sym || '').trim();
    if (!sym || /^(N\.?C\.?|rest|x|休)$/i.test(sym)) return null;
    var m = /^([A-Ga-g][#b♯♭]?)(.*)$/.exec(sym);
    if (!m) return { error: true, symbol: sym };
    var root = pcOf(m[1]);
    var rest = m[2].replace(/[()\s]/g, '');
    var bass = root;
    var sm = /\/([A-Ga-g][#b♯♭]?)$/.exec(rest);
    if (sm) { bass = pcOf(sm[1]); rest = rest.slice(0, rest.length - sm[0].length); }
    var iv = QMAP[rest], unknown = false;
    if (!iv) {
      unknown = true;
      iv = (/^m(?!aj)/.test(rest) || /^min/.test(rest)) ? [0, 3, 7] : [0, 4, 7];
    }
    return { root: root, bass: bass, intervals: iv, symbol: sym, unknown: unknown };
  }

  // "Am F | G E7" → [[Am, F], [G, E7]]（"%" や空の小節は前の小節の繰り返し）
  function parseProgression(str, warnings) {
    var bars = String(str || '').split('|');
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var tokens = bars[i].trim().split(/[\s,、]+/).filter(Boolean);
      if (!tokens.length || (tokens.length === 1 && tokens[0] === '%')) {
        if (out.length) out.push(out[out.length - 1]);
        else if (i < bars.length - 1 || bars.length === 1) out.push([null]);
        continue;
      }
      var chords = tokens.map(function (t) {
        var c = parseChord(t);
        if (c && c.error) { if (warnings) warnings.push('コード「' + t + '」を読めなかったので休みにしました'); return null; }
        if (c && c.unknown && warnings) warnings.push('コード「' + t + '」の種類が不明なので三和音として扱いました');
        return c;
      });
      out.push(chords);
    }
    if (!out.length) out.push([null]);
    return out;
  }

  // ---------------------------------------------------------------
  // 設計図の整形
  // ---------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function toInt(v, def) { v = Math.round(Number(v)); return isFinite(v) ? v : def; }

  function normalizePlan(input) {
    var warnings = [];
    var p = input && typeof input === 'object' ? input : {};
    var plan = {
      title: typeof p.title === 'string' && p.title ? p.title : '無題',
      bpm: clamp(toInt(p.bpm, 120), 40, 260),
      key: {
        tonic: p.key && NOTE_NAMES.indexOf(p.key.tonic) >= 0 ? p.key.tonic : 'C',
        mode: p.key && p.key.mode === 'minor' ? 'minor' : 'major'
      },
      feel: p.feel === 'shuffle' ? 'shuffle' : 'straight',
      sections: [],
      layers: [],
      summary: typeof p.summary === 'string' ? p.summary : ''
    };
    if (p.key && typeof p.key.tonic === 'string' && NOTE_NAMES.indexOf(p.key.tonic) < 0) {
      var pc = pcOf(p.key.tonic);
      if (pc >= 0) plan.key.tonic = NOTE_NAMES[pc];
      else warnings.push('調の主音「' + p.key.tonic + '」が不明なので C にしました');
    }
    var secs = Array.isArray(p.sections) ? p.sections : [];
    var seenLoop = false;
    secs.forEach(function (s, i) {
      if (!s || typeof s !== 'object') return;
      var sec = {
        name: typeof s.name === 'string' && s.name ? s.name : String.fromCharCode(65 + (i % 26)),
        intro: !!s.intro,
        bars: clamp(toInt(s.bars, 8), 1, 256),
        energy: clamp(toInt(s.energy, 3), 1, 5),
        chords: typeof s.chords === 'string' ? s.chords : '',
        ending: ENDINGS[s.ending] ? s.ending : 'none'
      };
      if (sec.intro && seenLoop) { sec.intro = false; warnings.push('セクション「' + sec.name + '」: イントロは曲の先頭にのみ置けるのでループ側に入れました'); }
      if (!sec.intro) seenLoop = true;
      plan.sections.push(sec);
    });
    if (!plan.sections.some(function (s) { return !s.intro; })) {
      plan.sections.push({ name: 'A', intro: false, bars: 16, energy: 3, chords: 'C', ending: 'none' });
      warnings.push('ループ部分のセクションが無かったので仮のセクションを追加しました');
    }
    var usedParts = {};
    var drumsSeen = false;
    var lays = Array.isArray(p.layers) ? p.layers : [];
    lays.forEach(function (l, i) {
      if (!l || typeof l !== 'object') return;
      var role = ROLES[l.role] ? l.role : null;
      if (!role) { warnings.push('レイヤー' + (i + 1) + ': 役割「' + l.role + '」が不明なので無視しました'); return; }
      var R = ROLES[role];
      if (role === 'drums') {
        if (drumsSeen) { warnings.push('ドラムのレイヤーは1つまでなので2つ目以降を無視しました'); return; }
        drumsSeen = true;
      }
      var parts = (Array.isArray(l.parts) ? l.parts : [l.parts]).map(function (x) { return toInt(x, 0); })
        .filter(function (x) { return x >= 1 && x <= 8; });
      var ok = [];
      parts.forEach(function (x) {
        if (usedParts[x]) { warnings.push('パート' + x + 'が複数のレイヤーで使われていたので、後のほうを外しました'); return; }
        if (ok.length >= R.maxParts) return;
        ok.push(x); usedParts[x] = true;
      });
      if (!ok.length) { warnings.push(R.label + 'のレイヤーに使えるパートが無いので無視しました'); return; }
      var pattern = PATTERNS[l.pattern] && PATTERNS[l.pattern].role === role ? l.pattern : R.defaultPattern;
      if (l.pattern && pattern !== l.pattern) warnings.push(R.label + ': 奏法「' + l.pattern + '」は使えないので「' + PATTERNS[pattern].label + '」にしました');
      var inst = BGM.PRESETS[l.instrument] ? l.instrument : R.defaultInstrument;
      if ((role === 'drums') !== BGM.isDrumInstrument(inst)) inst = R.defaultInstrument;
      plan.layers.push({
        role: role, parts: ok, instrument: inst, pattern: pattern,
        octave: clamp(toInt(l.octave, 0), -2, 2),
        volume: clamp(Number(l.volume != null ? l.volume : R.volume) || R.volume, 0, 1),
        sections: Array.isArray(l.sections) ? l.sections.filter(function (x) { return typeof x === 'string' && x; }) : []
      });
    });
    return { plan: plan, warnings: warnings };
  }

  function planLength(plan) {
    var intro = 0, loop = 0;
    (plan.sections || []).forEach(function (s) { if (s.intro) intro += s.bars; else loop += s.bars; });
    var secPerBar = 4 * 60 / (plan.bpm || 120);
    return { introBars: intro, loopBars: loop, introSeconds: intro * secPerBar, loopSeconds: loop * secPerBar };
  }

  // ---------------------------------------------------------------
  // 音符生成
  // ---------------------------------------------------------------
  function Rand(seed) { this.s = seed >>> 0 || 1; }
  Rand.prototype.next = function () {
    var t = (this.s += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function nearestPitch(pc, target, lo, hi) {
    var best = null;
    for (var p = lo; p <= hi; p++) {
      if (((p % 12) + 12) % 12 !== pc) continue;
      if (best === null || Math.abs(p - target) < Math.abs(best - target)) best = p;
    }
    if (best === null) { best = lo + ((pc - lo) % 12 + 12) % 12; }
    return best;
  }

  // 全小節のタイムライン
  function buildTimeline(plan, warnings) {
    var bars = [];
    plan.sections.forEach(function (sec, si) {
      var prog = parseProgression(sec.chords, warnings);
      for (var b = 0; b < sec.bars; b++) {
        var chords = prog[b % prog.length];
        var segs = [];
        var n = chords.length;
        for (var k = 0; k < n; k++) {
          var st = Math.round(k * TPB / n), en = Math.round((k + 1) * TPB / n);
          segs.push({ start: st, end: en, chord: chords[k] });
        }
        bars.push({ section: sec, sectionIndex: si, bar: b, segs: segs });
      }
    });
    // 連続する同じコードは1つのセグメントとして扱えるよう印をつける
    return bars;
  }
  function chordAt(bars, barIdx, t) {
    var bar = bars[barIdx];
    if (!bar) return null;
    for (var i = 0; i < bar.segs.length; i++) if (t >= bar.segs[i].start && t < bar.segs[i].end) return bar.segs[i];
    return bar.segs[bar.segs.length - 1];
  }
  function layerActive(layer, sec) {
    return !layer.sections.length || layer.sections.indexOf(sec.name) >= 0;
  }
  function baseVel(energy) { return 64 + energy * 10; }

  // 小節内のイベント（t, len, sel）
  var BASS_PAT = {
    bass_half: [[0, 92, 'r'], [96, 92, 'r']],
    bass_quarter: [[0, 44, 'r'], [48, 44, 'r'], [96, 44, 'r'], [144, 44, 'r']],
    bass_eighth: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return [i * 24, 20, 'r']; }),
    bass_octave: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return [i * 24, 20, i % 2 ? 'o' : 'r']; }),
    bass_root_fifth: [[0, 44, 'r'], [48, 44, '5'], [96, 44, 'r'], [144, 44, '5']],
    bass_walking: [[0, 44, 'r'], [48, 44, '3'], [96, 44, '5'], [144, 44, 'a']],
    bass_syncopated: [[0, 66, 'r'], [72, 66, 'r'], [144, 44, 'r']],
    bass_gallop: [0, 1, 2, 3].reduce(function (a, i) { return a.concat([[i * 48, 22, 'r'], [i * 48 + 24, 10, 'r'], [i * 48 + 36, 10, 'r']]); }, [])
  };
  var CHORD_PAT = {
    chords_half: [[0, 92], [96, 92]],
    chords_offbeat: [0, 1, 2, 3].map(function (i) { return [i * 48 + 24, 18]; }),
    chords_eighth: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return [i * 24, 20]; }),
    chords_syncopated: [[0, 66], [72, 66], [144, 44]],
    chords_stab: [[0, 16], [72, 16], [144, 16]]
  };
  var ARP_PAT = {
    arp_up8: { step: 24, seq: [0, 1, 2, 3] },
    arp_up16: { step: 12, seq: [0, 1, 2, 3] },
    arp_updown16: { step: 12, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
    arp_down8: { step: 24, seq: [3, 2, 1, 0] },
    arp_broken8: { step: 24, seq: [0, 2, 3, 2] }
  };

  // 最後の小節の扱い（ending）に応じてイベントを調整
  function endingFilter(bars, bi, events) {
    var bar = bars[bi], sec = bar.section;
    var last = bar.bar === sec.bars - 1;
    if (sec.ending === 'break' && last) {
      return events.filter(function (e) { return e[0] < BEAT; }).map(function (e) { return [e[0], Math.min(e[1], BEAT - e[0]), e[2]]; });
    }
    return events;
  }
  function isBuildBar(bars, bi) {
    var bar = bars[bi], sec = bar.section;
    return sec.ending === 'build' && bar.bar >= sec.bars - 2;
  }

  function genBass(layer, bars, out, rnd, ctx) {
    var lo = 33 + 12 * layer.octave, hi = 52 + 12 * layer.octave;
    var prev = 40 + 12 * layer.octave;
    function rootPitch(seg) { return nearestPitch(seg.chord.bass, prev, lo, hi); }
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi], sec = bar.section;
      if (!layerActive(layer, sec)) continue;
      var off = bi * TPB;
      var events;
      var pat = layer.pattern;
      if (isBuildBar(bars, bi)) pat = 'bass_eighth';
      if (pat === 'bass_whole') events = bar.segs.map(function (s) { return [s.start, s.end - s.start - 4, 'r']; });
      else events = BASS_PAT[pat] || BASS_PAT.bass_eighth;
      events = endingFilter(bars, bi, events);
      var lastSegStart = -1, segRoot = prev;
      for (var i = 0; i < events.length; i++) {
        var e = events[i], t = e[0];
        var seg = chordAt(bars, bi, t);
        if (!seg || !seg.chord) continue;
        if (seg.start !== lastSegStart) { segRoot = rootPitch(seg); prev = segRoot; lastSegStart = seg.start; }
        var len = Math.min(e[1], seg.end - t - 2);
        if (len < 6) len = Math.min(e[1], seg.end - t);
        var iv = seg.chord.intervals, pitch = segRoot, sel = e[2];
        if (sel === 'o') pitch = segRoot + 12 <= hi + 7 ? segRoot + 12 : segRoot - 12;
        else if (sel === '5') pitch = segRoot + 7 <= hi + 5 ? segRoot + 7 : segRoot - 5;
        else if (sel === '3') pitch = segRoot + (iv[1] != null && iv[1] < 12 ? iv[1] : 7);
        else if (sel === 'a') {
          // 次のコードのルートへ半音で近づく
          var nb = t + BEAT >= TPB ? bi + 1 : bi, nt = (t + BEAT) % TPB;
          var nseg = nb < bars.length ? chordAt(bars, nb, nt) : (ctx.loopFirst || null);
          if (nseg && nseg.chord) {
            var target = nearestPitch(nseg.chord.bass, segRoot, lo, hi);
            if (target === segRoot) pitch = segRoot + 7 <= hi + 5 ? segRoot + 7 : segRoot - 5;
            else pitch = target > segRoot ? target - 1 : target + 1;
          } else pitch = segRoot + 7;
        }
        var v = baseVel(sec.energy) + (t === 0 ? 6 : 0) + Math.round((rnd.next() - 0.5) * 8);
        var lastB = out[out.length - 1];
        if (pat === 'bass_whole' && lastB && lastB[2] === pitch && off + t - (lastB[0] + lastB[1]) <= 4 && off + t + len - lastB[0] <= TPB * 2) {
          lastB[1] = off + t + len - lastB[0];
        } else out.push([off + t, Math.max(4, len), pitch, clamp(v, 1, 127)]);
      }
    }
  }

  // 和音のボイシング（前のボイシングから最小移動）
  function voiceCandidates(chord, n, lo, hi) {
    var iv = chord.intervals;
    var order;
    if (iv.length <= 2) order = [0, 1, 0, 1];
    else if (iv.length === 3) order = [0, 1, 2, 0];
    else if (iv.length === 4) order = [1, 3, 0, 2];
    else order = [1, 3, 4, 2, 0];
    var pcs = [];
    for (var i = 0; i < n; i++) pcs.push((chord.root + iv[order[i % order.length]]) % 12);
    var options = pcs.map(function (pc) {
      var a = [];
      for (var p = lo; p <= hi; p++) if (p % 12 === pc) a.push(p);
      return a;
    });
    var res = [];
    (function rec(k, acc) {
      if (k === options.length) {
        var s = acc.slice().sort(function (a, b) { return a - b; });
        for (var j = 1; j < s.length; j++) if (s[j] === s[j - 1]) return;
        if (s[s.length - 1] - s[0] > 19) return;
        res.push(s);
        return;
      }
      for (var q = 0; q < options[k].length; q++) { acc.push(options[k][q]); rec(k + 1, acc); acc.pop(); }
    })(0, []);
    return res;
  }
  function chooseVoicing(chord, n, prevV, lo, hi) {
    var cands = voiceCandidates(chord, n, lo, hi);
    if (!cands.length) return null;
    var center = (lo + hi) / 2;
    var best = null, bestCost = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], cost = 0;
      if (prevV) { for (var j = 0; j < n; j++) cost += Math.abs(c[j] - prevV[j]); }
      else { var avg = c.reduce(function (a, b) { return a + b; }, 0) / n; cost = Math.abs(avg - center) * 2; }
      cost += Math.max(0, c[n - 1] - c[0] - 12) * 0.6;
      // 低音域での密集を避ける
      for (j = 1; j < n; j++) if (c[j] - c[j - 1] < 3 && c[j - 1] < 55) cost += 4;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return best;
  }

  function genChords(layer, bars, outs, rnd) {
    var n = layer.parts.length;
    var lo = 53 + 12 * layer.octave, hi = 79 + 12 * layer.octave;
    var prevV = null;
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi], sec = bar.section;
      if (!layerActive(layer, sec)) { continue; }
      var off = bi * TPB;
      var pat = isBuildBar(bars, bi) ? 'chords_eighth' : layer.pattern;
      var events = pat === 'chords_sustain' ? bar.segs.map(function (s) { return [s.start, s.end - s.start - 2]; }) : CHORD_PAT[pat];
      events = endingFilter(bars, bi, events);
      var voicings = {};
      for (var i = 0; i < events.length; i++) {
        var t = events[i][0];
        var seg = chordAt(bars, bi, t);
        if (!seg || !seg.chord) continue;
        var v = voicings[seg.start];
        if (!v) { v = chooseVoicing(seg.chord, n, prevV, lo, hi); voicings[seg.start] = v; if (v) prevV = v; }
        if (!v) continue;
        var len = Math.min(events[i][1], seg.end - t - 1);
        if (len < 4) continue;
        var vel = baseVel(sec.energy) - 8 + (t === 0 ? 5 : 0) + Math.round((rnd.next() - 0.5) * 6);
        for (var k = 0; k < n; k++) {
          var lastN = outs[k][outs[k].length - 1];
          // 伸ばす奏法では同じ音が続くとき弾き直さずにつなげる（最長2小節）
          if (pat === 'chords_sustain' && lastN && lastN[2] === v[k] && off + t - (lastN[0] + lastN[1]) <= 4 && off + t + len - lastN[0] <= TPB * 2) {
            lastN[1] = off + t + len - lastN[0];
          } else outs[k].push([off + t, len, v[k], clamp(vel, 1, 127)]);
        }
      }
    }
  }

  function arpTones(chord, base) {
    var root = nearestPitch(chord.root, base, base - 6, base + 6);
    var iv = chord.intervals.filter(function (x) { return x < 12; });
    var tones = [];
    for (var o = 0; o < 2; o++) for (var i = 0; i < iv.length; i++) tones.push(root + iv[i] + 12 * o);
    tones.push(root + 24);
    return tones;
  }

  function genArp(layer, bars, out, rnd) {
    var base = 64 + 12 * layer.octave;
    var spec = ARP_PAT[layer.pattern] || ARP_PAT.arp_up16;
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi], sec = bar.section;
      if (!layerActive(layer, sec)) continue;
      var off = bi * TPB;
      var events = [];
      for (var t = 0; t < TPB; t += spec.step) events.push([t, Math.round(spec.step * 0.8), 'x']);
      events = endingFilter(bars, bi, events);
      for (var i = 0; i < events.length; i++) {
        var et = events[i][0];
        var seg = chordAt(bars, bi, et);
        if (!seg || !seg.chord) continue;
        var tones = arpTones(seg.chord, base);
        var stepIdx = Math.floor((et - seg.start) / spec.step);
        var idx = spec.seq[stepIdx % spec.seq.length];
        var pitch = tones[Math.min(idx, tones.length - 1)];
        var len = Math.min(events[i][1], seg.end - et);
        var vel = baseVel(sec.energy) - 10 + (stepIdx % 4 === 0 ? 8 : 0) + Math.round((rnd.next() - 0.5) * 6);
        out.push([off + et, Math.max(3, len), pitch, clamp(vel, 1, 127)]);
      }
    }
  }

  function genOstinato(layer, bars, out, rnd, ctx) {
    var lo = 62 + 12 * layer.octave, hi = 76 + 12 * layer.octave;
    var prev = 67 + 12 * layer.octave;
    var step = layer.pattern === 'ost_pulse16' ? 12 : 24;
    var tonicPc = pcOf(ctx.plan.key.tonic);
    var pedal = nearestPitch(tonicPc, 64 + 12 * layer.octave, lo - 2, hi);
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi], sec = bar.section;
      if (!layerActive(layer, sec)) continue;
      var off = bi * TPB;
      var events = [];
      var st = isBuildBar(bars, bi) ? 12 : step;
      for (var t = 0; t < TPB; t += st) events.push([t, Math.round(st * 0.7), 'x']);
      events = endingFilter(bars, bi, events);
      var segPitch = {};
      for (var i = 0; i < events.length; i++) {
        var et = events[i][0];
        var seg = chordAt(bars, bi, et);
        if (!seg || !seg.chord) continue;
        var pitch;
        if (layer.pattern === 'ost_pedal8') pitch = pedal;
        else {
          pitch = segPitch[seg.start];
          if (pitch == null) {
            // 前の音に最も近いコード構成音（共通音を保ちやすい）
            var best = null;
            seg.chord.intervals.forEach(function (iv) {
              var cand = nearestPitch((seg.chord.root + iv) % 12, prev, lo, hi);
              if (best === null || Math.abs(cand - prev) < Math.abs(best - prev)) best = cand;
            });
            pitch = best; segPitch[seg.start] = pitch; prev = pitch;
          }
        }
        var len = Math.min(events[i][1], seg.end - et);
        var vel = baseVel(sec.energy) - 14 + ((et % BEAT) === 0 ? 8 : 0) + Math.round((rnd.next() - 0.5) * 6);
        out.push([off + et, Math.max(3, len), pitch, clamp(vel, 1, 127)]);
      }
    }
  }

  // ---- ドラム ----
  var K = 36, S = 38, RIM = 37, CH = 42, OH = 46, TL = 45, TM = 47, TH = 50, CR = 49;
  var DRUM_PAT = {
    drums_four_on_floor: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
    drums_eight_beat:    { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    drums_half_time:     { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
    drums_breakbeat:     { k: 'x.x.......x..x..', s: '....X..g.g..X..g', h: 'x.x.x.x.x.x.x.x.' },
    drums_sixteen_beat:  { k: 'x..x..x...x.....', s: '....X.......X...', h: 'xxxxxxxxxxxxxxxx' },
    drums_sparse:        { k: 'x.........x.....', s: '', r: '........x.......', h: 'x...x...x...x...' }
  };
  var DRUM_PRIORITY = {}; DRUM_PRIORITY[CR] = 6; DRUM_PRIORITY[K] = 5; DRUM_PRIORITY[S] = 4; DRUM_PRIORITY[RIM] = 4;
  DRUM_PRIORITY[TL] = 3; DRUM_PRIORITY[TM] = 3; DRUM_PRIORITY[TH] = 3; DRUM_PRIORITY[OH] = 2; DRUM_PRIORITY[CH] = 1;

  function genDrums(layer, bars, out, rnd) {
    var pat = DRUM_PAT[layer.pattern] || DRUM_PAT.drums_eight_beat;
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi], sec = bar.section;
      if (!layerActive(layer, sec)) continue;
      var off = bi * TPB, e = sec.energy, hits = [];
      var lastBar = bar.bar === sec.bars - 1;
      var bv = baseVel(e);
      var add = function (step, drum, vel) { hits.push([step, drum, clamp(Math.round(vel + (rnd.next() - 0.5) * 8), 1, 127)]); };
      var put = function (str, drum, vel) {
        for (var i = 0; i < 16 && i < str.length; i++) {
          var c = str[i];
          if (c === 'x') add(i, drum, vel); else if (c === 'X') add(i, drum, vel + 10); else if (c === 'g') add(i, drum, vel * 0.5);
        }
      };
      if (sec.ending === 'break' && lastBar) {
        add(0, K, bv + 10); add(0, CR, bv + 5);
      } else if (sec.ending === 'build' && bar.bar >= sec.bars - 2) {
        put('x...x...x...x...', K, bv);
        if (bar.bar === sec.bars - 2) for (var s1 = 0; s1 < 16; s1 += 2) add(s1, S, 55 + s1 * 2.5);
        else for (var s2 = 0; s2 < 16; s2++) add(s2, S, 65 + s2 * 3.5);
      } else {
        var hat = pat.h;
        if (e <= 1) hat = 'x...x...x...x...';
        put(pat.k, K, bv + 6);
        if (e >= 2 || layer.pattern === 'drums_sparse') { put(pat.s || '', S, bv + 4); if (pat.r) put(pat.r, RIM, bv - 4); }
        else if (pat.s) put(pat.s.replace(/X/g, 'x').replace(/g/g, '.'), RIM, bv - 10);
        for (var hs = 0; hs < 16; hs++) {
          var c = hat[hs];
          if (c !== 'x') {
            if (e >= 4 && hat === 'x.x.x.x.x.x.x.x.' && hs % 2 === 1) add(hs, CH, bv * 0.45);
            continue;
          }
          var hv = (hs % 4 === 0 ? bv - 4 : (hs % 2 === 0 ? bv - 16 : bv - 26));
          if (e >= 5 && hs === 14) add(hs, OH, bv - 10); else add(hs, CH, hv);
        }
        if (bar.bar === 0 && e >= 3) add(0, CR, bv);
        else if (e >= 5 && bar.bar % 4 === 0) add(0, CR, bv - 6);
        if (sec.ending === 'fill' && lastBar) {
          hits = hits.filter(function (h) { return h[0] < (e <= 2 ? 12 : 8); });
          if (e <= 2) { for (var f1 = 12; f1 < 16; f1++) add(f1, S, 60 + (f1 - 12) * 10); }
          else {
            var seq = [S, S, TH, TH, TM, TM, TL, TL];
            add(8, K, bv);
            for (var f2 = 0; f2 < 8; f2++) add(8 + f2, seq[f2], 70 + f2 * 6);
          }
        }
      }
      // 同時発音は3つまで（優先度の低いものから削る）
      var byStep = {};
      hits.forEach(function (h) { (byStep[h[0]] = byStep[h[0]] || []).push(h); });
      Object.keys(byStep).forEach(function (st) {
        var list = byStep[st];
        var uniq = {};
        list = list.filter(function (h) { if (uniq[h[1]]) return false; uniq[h[1]] = true; return true; });
        list.sort(function (a, b) { return (DRUM_PRIORITY[b[1]] || 0) - (DRUM_PRIORITY[a[1]] || 0); });
        list.slice(0, BGM.DRUM_MAX_POLY).forEach(function (h) { out.push([off + h[0] * 12, 6, h[1], h[2]]); });
      });
    }
  }

  // 8分のスウィング（シャッフル）: 拍内の 24tick 地点を 32tick へ
  function swingTick(t) {
    var p = ((t % BEAT) + BEAT) % BEAT, base = t - p;
    return base + (p <= 24 ? Math.round(p * 32 / 24) : 32 + Math.round((p - 24) * 16 / 24));
  }

  function enforceMono(notes) {
    notes.sort(function (a, b) { return a[0] - b[0] || b[2] - a[2]; });
    var out = [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var prev = out[out.length - 1];
      if (prev && prev[0] === n[0]) continue;
      if (prev && prev[0] + prev[1] > n[0]) prev[1] = n[0] - prev[0];
      out.push(n);
    }
    return out.filter(function (n) { return n[1] > 0; });
  }

  // plan → score
  // baseScore を渡すと、設計図で使わないパート（メロディなど）の音符と設定を引き継ぐ
  function generate(planInput, baseScore) {
    var np = normalizePlan(planInput);
    var plan = np.plan, warnings = np.warnings;
    var len = planLength(plan);
    var introBars = len.introBars, loopBars = len.loopBars;
    var score = baseScore ? BGM.normalizeScore(JSON.parse(JSON.stringify(baseScore))) : BGM.createEmptyScore();
    if (!baseScore) {
      score.parts[0].name = 'メロディ1'; score.parts[0].instrument = 'pulse25';
      score.parts[1].name = 'メロディ2'; score.parts[1].instrument = 'triangle';
      score.parts[0].reverb = 0.2; score.parts[0].delay = 0.15; score.parts[1].reverb = 0.2;
    }
    score.title = plan.title;
    score.bpm = plan.bpm;
    score.key = { tonic: plan.key.tonic, mode: plan.key.mode };
    score.intro = { enabled: introBars > 0, bars: introBars > 0 ? introBars : (score.intro.bars || 4) };
    score.loopBars = loopBars;
    var totalTicks = (introBars + loopBars) * TPB;
    var bar = 0;
    score.sections = plan.sections.map(function (s) { var r = { bar: bar, name: s.name }; bar += s.bars; return r; });

    var used = {};
    plan.layers.forEach(function (l) { l.parts.forEach(function (p) { used[p - 1] = true; }); });
    // 使わないパートは残すが、曲の長さからはみ出す音符は消す
    score.parts.forEach(function (p, i) {
      if (used[i]) return;
      p.notes = p.notes.filter(function (n) { return n[0] < totalTicks; }).map(function (n) { return [n[0], Math.min(n[1], totalTicks - n[0]), n[2], n[3]]; });
      if (BGM.isDrumInstrument(p.instrument) && plan.layers.some(function (l) { return l.role === 'drums'; })) {
        p.instrument = 'pulse25'; p.params = {};
        warnings.push('パート' + (i + 1) + 'はドラム音源でしたが、ドラムのレイヤーが別パートにあるため矩形波に変更しました');
      }
    });

    var bars = buildTimeline(plan, warnings);
    var loopFirstBar = introBars < bars.length ? bars[introBars] : null;
    var ctx = { plan: plan, loopFirst: loopFirstBar ? loopFirstBar.segs[0] : null };
    var seed = hashStr(JSON.stringify(plan));

    plan.layers.forEach(function (layer, li) {
      var R = ROLES[layer.role];
      var rnd = new Rand(seed + li * 977);
      var outs = layer.parts.map(function () { return []; });
      if (layer.role === 'bass') genBass(layer, bars, outs[0], rnd, ctx);
      else if (layer.role === 'chords') genChords(layer, bars, outs, rnd);
      else if (layer.role === 'arpeggio') genArp(layer, bars, outs[0], rnd);
      else if (layer.role === 'ostinato') genOstinato(layer, bars, outs[0], rnd, ctx);
      else if (layer.role === 'drums') genDrums(layer, bars, outs[0], rnd);
      layer.parts.forEach(function (pn, k) {
        var part = score.parts[pn - 1];
        var notes = outs[k];
        if (plan.feel === 'shuffle') {
          notes = notes.map(function (n) {
            var s = swingTick(n[0]), e = swingTick(n[0] + n[1]);
            return [s, Math.max(3, e - s), n[2], n[3]];
          });
        }
        notes = notes.filter(function (n) { return n[0] < totalTicks; }).map(function (n) {
          var limit = (introBars > 0 && n[0] < introBars * TPB) ? introBars * TPB : totalTicks;
          return [n[0], Math.max(1, Math.min(n[1], limit - n[0])), n[2], n[3]];
        });
        if (layer.role !== 'drums') notes = enforceMono(notes);
        part.notes = notes;
        part.instrument = layer.instrument;
        part.params = {};
        part.mute = false; part.solo = false;
        part.volume = layer.volume;
        part.reverb = R.reverb; part.delay = R.delay;
        part.name = layer.parts.length > 1 ? R.label + (k + 1) : R.label;
        if (layer.role === 'chords') part.pan = layer.parts.length > 1 ? -0.35 + 0.7 * k / (layer.parts.length - 1) : 0;
        else if (layer.role === 'arpeggio') part.pan = 0.3;
        else if (layer.role === 'ostinato') part.pan = -0.3;
        else part.pan = 0;
      });
    });
    score.meta = score.meta || {};
    score.meta.plan = plan;
    return { score: score, warnings: warnings, plan: plan };
  }

  // 手で設計図を書くときのひな形（約4分、イントロ付き）
  function samplePlan() {
    return {
      title: 'ダンジョン（ひな形）', bpm: 128, key: { tonic: 'A', mode: 'minor' }, feel: 'straight',
      sections: [
        { name: 'イントロ', intro: true, bars: 4, energy: 2, chords: 'Am | Am | F | E', ending: 'fill' },
        { name: 'A', intro: false, bars: 16, energy: 2, chords: 'Am | F | G | Em', ending: 'none' },
        { name: 'B', intro: false, bars: 16, energy: 3, chords: 'Dm | Am | Bb | E7', ending: 'fill' },
        { name: 'C', intro: false, bars: 16, energy: 4, chords: 'F | G | Em | Am | Dm | G | E | E7', ending: 'build' },
        { name: 'A', intro: false, bars: 16, energy: 3, chords: 'Am | F | G | Em', ending: 'none' },
        { name: 'D', intro: false, bars: 16, energy: 1, chords: 'Fmaj7 | Em7 | Dm7 | E7sus4 E7', ending: 'none' },
        { name: 'C', intro: false, bars: 16, energy: 5, chords: 'F | G | Em | Am | Dm | G | E | E7', ending: 'break' },
        { name: 'B', intro: false, bars: 16, energy: 3, chords: 'Dm | Am | Bb | E7', ending: 'fill' }
      ],
      layers: [
        { role: 'bass', parts: [3], instrument: 'triBass', pattern: 'bass_eighth', octave: 0, volume: 0.85, sections: [] },
        { role: 'chords', parts: [4, 5, 6], instrument: 'warmPad', pattern: 'chords_sustain', octave: 0, volume: 0.55, sections: [] },
        { role: 'arpeggio', parts: [7], instrument: 'pulse12', pattern: 'arp_up16', octave: 0, volume: 0.45, sections: ['B', 'C'] },
        { role: 'drums', parts: [8], instrument: 'drumChip', pattern: 'drums_eight_beat', octave: 0, volume: 0.85, sections: ['A', 'B', 'C'] }
      ],
      summary: '手で編集するためのひな形です。'
    };
  }

  return {
    ROLES: ROLES, PATTERNS: PATTERNS, ENDINGS: ENDINGS, QUALITY_NAMES: QUALITIES.map(function (q) { return q[0]; }),
    parseChord: parseChord, parseProgression: parseProgression,
    normalizePlan: normalizePlan, planLength: planLength, generate: generate, samplePlan: samplePlan
  };
});
