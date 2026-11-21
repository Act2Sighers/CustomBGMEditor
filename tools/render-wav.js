#!/usr/bin/env node
/*
 * 楽譜（*.bgm.json）を WAV に書き出すコマンド。Node.js 18 以上。依存なし。
 *
 *   node tools/render-wav.js 曲.bgm.json                    … 試聴用（イントロ＋ループ1回＋フェードアウト）
 *   node tools/render-wav.js 曲.bgm.json --mode game        … ゲーム用1ファイル（イントロ＋ループ1周、smplチャンク付き）
 *   node tools/render-wav.js 曲.bgm.json --mode split       … ゲーム用2ファイル（_intro.wav と _loop.wav）
 *   node tools/render-wav.js 曲.bgm.json --mode loop        … ループ部分だけ（単体で継ぎ目なくループ可能）
 *
 * オプション: -o 出力パス / --loops 回数（listen のみ）/ --fade 秒（listen のみ）/ --rate サンプリング周波数
 * 終了時に、ループ位置などの情報を JSON で標準出力に表示します。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var BGM = require(path.join(__dirname, '..', 'engine', 'bgm-engine.js'));

function usage(msg) {
  if (msg) console.error('エラー: ' + msg);
  console.error('使い方: node tools/render-wav.js <score.bgm.json> [-o out.wav] [--mode listen|game|split|intro|loop] [--loops N] [--fade 秒] [--rate 44100]');
  process.exit(1);
}

var args = process.argv.slice(2);
var input = null, out = null, mode = 'listen', loops = 1, fade = 8, rate = 44100;
for (var i = 0; i < args.length; i++) {
  var a = args[i];
  if (a === '-o' || a === '--out') out = args[++i];
  else if (a === '--mode') mode = args[++i];
  else if (a === '--loops') loops = Number(args[++i]);
  else if (a === '--fade') fade = Number(args[++i]);
  else if (a === '--rate') rate = Number(args[++i]);
  else if (a === '-h' || a === '--help') usage();
  else if (!input) input = a;
  else usage('引数が多すぎます: ' + a);
}
if (!input) usage('楽譜ファイルを指定してください');
if (['listen', 'game', 'split', 'intro', 'loop'].indexOf(mode) < 0) usage('不明なモード: ' + mode);

var score = BGM.normalizeScore(fs.readFileSync(input, 'utf8'));
var problems = BGM.validateScore(score);
problems.forEach(function (p) { console.error('注意: ' + p); });
var base = out ? out.replace(/\.wav$/i, '') : input.replace(/\.bgm\.json$|\.json$/i, '') + (mode === 'listen' ? '' : '_' + mode);

var t0 = Date.now();
BGM.renderPCM(score, { mode: mode === 'split' ? 'game' : mode, loops: loops, fadeOut: fade, sampleRate: rate }).then(function (pcm) {
  var tm = BGM.timing(score);
  var result = {
    title: score.title, bpm: score.bpm, sampleRate: pcm.sampleRate,
    introSeconds: tm.introSeconds, loopSeconds: tm.loopSeconds, files: []
  };
  function write(file, p) {
    fs.writeFileSync(file, BGM.encodeWAV(p));
    result.files.push({ path: file, frames: p.frames, seconds: p.frames / p.sampleRate, loopStartSample: p.loopStart, loopEndSample: p.loopEnd });
  }
  if (mode === 'split') {
    var ls = pcm.loopStart;
    if (ls > 0) write(base.replace(/_split$/, '') + '_intro.wav', { sampleRate: pcm.sampleRate, frames: ls, data: pcm.data.subarray(0, ls * 2), loopStart: -1, loopEnd: -1 });
    write(base.replace(/_split$/, '') + '_loop.wav', { sampleRate: pcm.sampleRate, frames: pcm.frames - ls, data: pcm.data.subarray(ls * 2), loopStart: 0, loopEnd: pcm.frames - ls });
  } else {
    write(base + '.wav', pcm);
  }
  result.renderMs = Date.now() - t0;
  console.log(JSON.stringify(result, null, 2));
}).catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
