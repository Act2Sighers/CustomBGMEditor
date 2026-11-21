#!/usr/bin/env node
/*
 * 楽譜（*.bgm.json）の概要と制約違反を表示する。
 *   node tools/score-info.js 曲.bgm.json
 */
'use strict';
var fs = require('fs');
var path = require('path');
var BGM = require(path.join(__dirname, '..', 'engine', 'bgm-engine.js'));
var file = process.argv[2];
if (!file) { console.error('使い方: node tools/score-info.js <score.bgm.json>'); process.exit(1); }
var score = BGM.normalizeScore(fs.readFileSync(file, 'utf8'));
var tm = BGM.timing(score);
function fmt(s) { var m = Math.floor(s / 60), x = (s % 60).toFixed(2); return m + '分' + x + '秒'; }
console.log('タイトル: ' + score.title);
console.log('BPM: ' + score.bpm + ' / 調: ' + score.key.tonic + ' ' + (score.key.mode === 'minor' ? '短調' : '長調'));
console.log('イントロ: ' + (score.intro.enabled ? score.intro.bars + '小節（' + fmt(tm.introSeconds) + '）' : 'なし'));
console.log('ループ: ' + score.loopBars + '小節（' + fmt(tm.loopSeconds) + '）');
console.log('セクション: ' + score.sections.map(function (s) { return (s.bar + 1) + '小節目 ' + s.name; }).join(' / '));
score.parts.forEach(function (p, i) {
  var preset = BGM.PRESETS[p.instrument];
  console.log('パート' + (i + 1) + ': ' + p.name + ' [' + p.instrument + ' = ' + preset.label + '] 音符 ' + p.notes.length + (p.mute ? ' (ミュート)' : ''));
});
var problems = BGM.validateScore(score);
if (tm.loopSeconds < 180) problems.push('ループが3分未満です');
if (tm.loopSeconds >= 600) problems.push('ループが10分以上です');
console.log(problems.length ? '注意:\n  ' + problems.join('\n  ') : '制約違反なし');
