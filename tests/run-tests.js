#!/usr/bin/env node
/* 依存なしのテスト。 node tests/run-tests.js */
'use strict';
var path = require('path');
var BGM = require(path.join(__dirname, '..', 'engine', 'bgm-engine.js'));
var Arr = require(path.join(__dirname, '..', 'js', 'arranger.js'));

var passed = 0, failed = 0, queue = [];
function test(name, fn) { queue.push({ name: name, fn: fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

test('空の楽譜は8パート・制約違反なし', function () {
  var s = BGM.createEmptyScore();
  assert(s.parts.length === 8);
  assert(BGM.validateScore(s).length === 0);
  var t = BGM.timing(s);
  assert(t.loopSeconds === 96 * 2, 'BPM120・96小節は192秒');
});

test('normalizeScore は欠けた値を補い、不正な音符を捨てる', function () {
  var s = BGM.normalizeScore({ bpm: 'abc', parts: [{ instrument: 'nope', notes: [[0, 48, 60, 100], [0, -1, 60, 100], { t: 48, d: 24, p: 62 }, 'x'] }] });
  assert(s.bpm === 120);
  assert(s.parts.length === 8);
  assert(s.parts[0].instrument === 'pulse25');
  assert(s.parts[0].notes.length === 2, 'notes: ' + JSON.stringify(s.parts[0].notes));
  assert(s.parts[0].notes[1][3] === 100, '強さの既定値は100');
});

test('validateScore は重なり・ドラム4音・複数ドラムを検出する', function () {
  var s = BGM.createEmptyScore();
  s.parts[0].notes = [[0, 96, 60, 100], [48, 48, 62, 100]];
  s.parts[7].notes = [[0, 12, 36, 100], [0, 12, 38, 100], [0, 12, 42, 100], [0, 12, 49, 100]];
  s.parts[6].instrument = 'drumChip';
  var p = BGM.validateScore(s);
  assert(p.some(function (x) { return x.indexOf('重なって') >= 0; }), '重なり');
  assert(p.some(function (x) { return x.indexOf('3個を超え') >= 0; }), 'ドラム4音');
  assert(p.some(function (x) { return x.indexOf('1つまで') >= 0; }), '複数ドラム');
});

test('全プリセットが NaN なく鳴る', function () {
  var ids = Object.keys(BGM.PRESETS);
  return ids.reduce(function (pr, id) {
    return pr.then(function () {
      var s = BGM.createEmptyScore(); s.loopBars = 1;
      s.parts[0].instrument = id;
      s.parts[0].notes = BGM.isDrumInstrument(id)
        ? Object.keys(BGM.DRUM_MAP).map(function (k, i) { return [i * 12, 12, Number(k), 110]; })
        : [[0, 96, 48, 127], [96, 96, 84, 127]];
      s.parts[7].notes = [];
      return BGM.renderPCM(s, { mode: 'listen', fadeOut: 0 }).then(function (pcm) {
        var peak = 0;
        for (var i = 0; i < pcm.data.length; i++) { var v = pcm.data[i]; if (v !== v) throw new Error(id + ': NaN'); if (Math.abs(v) > peak) peak = Math.abs(v); }
        assert(peak > 300, id + ' の音が小さすぎる（' + peak + '）');
      });
    });
  }, Promise.resolve());
});

test('ゲーム用書き出し: イントロ＋ループの長さとループ位置', function () {
  var s = BGM.createEmptyScore();
  s.bpm = 120; s.intro = { enabled: true, bars: 2 }; s.loopBars = 4;
  s.parts[0].notes = [[0, 96, 60, 100], [384, 96, 64, 100], [384 + 4 * 192 - 48, 48, 67, 100]];
  return BGM.renderPCM(s, { mode: 'game' }).then(function (pcm) {
    assert(pcm.loopStart === 4 * 44100, 'イントロ4秒: ' + pcm.loopStart);
    assert(pcm.loopEnd === 12 * 44100, 'ループ8秒: ' + pcm.loopEnd);
    assert(pcm.frames === pcm.loopEnd);
    var wav = BGM.encodeWAV(pcm);
    var tag = String.fromCharCode.apply(null, wav.subarray(44 + pcm.frames * 4, 44 + pcm.frames * 4 + 4));
    assert(tag === 'smpl', 'smpl チャンク');
  });
});

test('ループの継ぎ目: 2周目と3周目がほぼ一致する（決定的な音色で）', function () {
  var s = BGM.createEmptyScore();
  s.bpm = 120; s.loopBars = 4;
  s.parts.forEach(function (p) { p.notes = []; });
  s.parts[0].instrument = 'pulse25';
  s.parts[1].instrument = 'triBass';
  for (var b = 0; b < 16; b++) { s.parts[0].notes.push([b * 48, 40, 60 + (b % 5), 100]); s.parts[1].notes.push([b * 48, 46, 36 + (b % 3), 100]); }
  // 最後の音はループ末尾まで伸ばし、余韻が先頭にかかるようにする
  s.parts[0].notes[15][1] = 48;
  return BGM.renderPCM(s, { mode: 'listen', loops: 3, fadeOut: 0 }).then(function (pcm) {
    var L = 8 * 44100, maxDiff = 0;
    for (var i = 0; i < L; i++) {
      for (var c = 0; c < 2; c++) {
        var a = pcm.data[(L + i) * 2 + c], b2 = pcm.data[(2 * L + i) * 2 + c];
        var d = Math.abs(a - b2); if (d > maxDiff) maxDiff = d;
      }
    }
    assert(maxDiff < 32768 * 0.02, '2周目と3周目の差が大きい: ' + maxDiff);
  });
});

test('コード記号の解析', function () {
  var c = Arr.parseChord('F#m7b5/C');
  assert(c.root === 6 && c.bass === 0 && c.intervals.join() === '0,3,6,10');
  assert(Arr.parseChord('N.C.') === null);
  assert(Arr.parseChord('Bbmaj7').intervals.join() === '0,4,7,11');
  var w = []; Arr.parseChord('Cxyz'); Arr.parseProgression('C | Hm | G', w);
  assert(w.length === 1, '読めないコードの警告');
  var prog = Arr.parseProgression('Am F | % | G');
  assert(prog.length === 3 && prog[1].length === 2);
});

test('設計図の整形: 不正な値を直し、警告を出す', function () {
  var r = Arr.normalizePlan({
    bpm: 999, key: { tonic: 'H', mode: 'minor' },
    sections: [{ name: 'A', bars: 8, chords: 'Am' }, { name: 'I', intro: true, bars: 4, chords: 'C' }],
    layers: [
      { role: 'drums', parts: [8], instrument: 'pad', pattern: 'bass_eighth' },
      { role: 'drums', parts: [7] },
      { role: 'chords', parts: [8, 4, 5, 6, 7, 2] },
      { role: 'unknown', parts: [3] }
    ]
  });
  var p = r.plan;
  assert(p.bpm === 260);
  assert(p.sections[1].intro === false, 'ループの後のイントロは無効');
  assert(p.layers.length === 2);
  assert(p.layers[0].instrument === 'drumElectro' && p.layers[0].pattern === 'drums_eight_beat');
  assert(p.layers[1].parts.join() === '4,5,6,7', '和音は最大4パート・重複除外: ' + p.layers[1].parts.join());
  assert(r.warnings.length >= 4);
});

test('全奏法 × ノリで生成しても制約違反なし', function () {
  var roles = {};
  Object.keys(Arr.PATTERNS).forEach(function (k) { var r = Arr.PATTERNS[k].role; (roles[r] = roles[r] || []).push(k); });
  var maxLen = Math.max.apply(null, Object.keys(roles).map(function (r) { return roles[r].length; }));
  ['straight', 'shuffle'].forEach(function (feel) {
    for (var i = 0; i < maxLen; i++) {
      var plan = {
        title: 't', bpm: 150, key: { tonic: 'E', mode: i % 2 ? 'minor' : 'major' }, feel: feel,
        sections: [
          { name: 'I', intro: true, bars: 3, energy: 2, chords: 'C | G7/B | Am7 E7', ending: 'fill' },
          { name: 'A', bars: 8, energy: 1, chords: 'C Am | F G | Em7b5 A7 | Dm7 G7', ending: 'build' },
          { name: 'B', bars: 7, energy: 5, chords: 'F | Fm6 | C/E | A7sus4 | Dm9 | N.C. | G', ending: 'break' },
          { name: 'C', bars: 5, energy: 3, chords: 'Ab | Bb | C5 C D E', ending: 'fill' }
        ],
        layers: [
          { role: 'bass', parts: [3], pattern: roles.bass[i % roles.bass.length], instrument: 'synthBass', octave: -1 },
          { role: 'chords', parts: [4, 5, 6], pattern: roles.chords[i % roles.chords.length], instrument: 'pad', sections: ['A', 'B'] },
          { role: 'arpeggio', parts: [7], pattern: roles.arpeggio[i % roles.arpeggio.length], instrument: 'pulse12', octave: 1 },
          { role: 'ostinato', parts: [2], pattern: roles.ostinato[i % roles.ostinato.length], instrument: 'pluck' },
          { role: 'drums', parts: [8], pattern: roles.drums[i % roles.drums.length], instrument: 'drumChip' }
        ]
      };
      var r = Arr.generate(plan);
      var probs = BGM.validateScore(r.score);
      assert(probs.length === 0, feel + ' #' + i + ': ' + probs.join(' / '));
      assert(r.score.intro.enabled && r.score.intro.bars === 3 && r.score.loopBars === 20);
      [2, 3, 4, 7].forEach(function (pi) { assert(r.score.parts[pi - 1].notes.length > 0, feel + ' #' + i + ' パート' + pi + 'が空'); });
      r.score.parts.forEach(function (p) { p.notes.forEach(function (n) { assert(n[2] >= 0 && n[2] <= 127 && n[1] > 0); }); });
    }
  });
});

test('設計図で使わないパートの音符は残る', function () {
  var base = BGM.createEmptyScore();
  base.parts[0].notes = [[0, 48, 72, 100], [200 * 192, 48, 72, 100]];
  var r = Arr.generate(Arr.samplePlan(), base);
  assert(r.score.parts[0].notes.length === 1, '曲の長さを越えた音符は消える');
  assert(r.score.parts[7].notes.length > 0);
  assert(BGM.validateScore(r.score).length === 0);
});

test('同じ設計図からは同じ音符が生成される', function () {
  var a = JSON.stringify(Arr.generate(Arr.samplePlan()).score.parts);
  var b = JSON.stringify(Arr.generate(Arr.samplePlan()).score.parts);
  assert(a === b);
});

(function run(i) {
  if (i >= queue.length) {
    console.log('\n' + passed + ' 件成功 / ' + failed + ' 件失敗');
    process.exit(failed ? 1 : 0);
  }
  var t = queue[i];
  Promise.resolve().then(t.fn).then(function () { passed++; console.log('✓ ' + t.name); }, function (e) { failed++; console.log('✗ ' + t.name + '\n    ' + (e && e.message || e)); })
    .then(function () { run(i + 1); });
})(0);
