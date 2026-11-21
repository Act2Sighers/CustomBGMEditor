/*
 * 画面上部の操作・ショートカット・ダイアログ・起動処理
 */
(function () {
  'use strict';
  var App = window.App, BGM = App.BGM, TPB = App.TPB, PR = window.PianoRoll, Panels = window.Panels;
  var Arr = window.CustomBGMArranger, AI = window.CustomBGMAI;
  var h = Panels.h;
  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------
  // 上部バー
  // ---------------------------------------------------------------
  function refreshTransport() {
    var d = App.doc;
    if (document.activeElement !== $('titleInput')) $('titleInput').value = d.title;
    if (document.activeElement !== $('bpmInput')) $('bpmInput').value = d.bpm;
    $('tonicSelect').value = d.key.tonic;
    $('modeSelect').value = d.key.mode;
    $('chkIntro').checked = d.intro.enabled;
    if (document.activeElement !== $('introBarsInput')) $('introBarsInput').value = d.intro.bars;
    $('introBarsInput').disabled = !d.intro.enabled;
    if (document.activeElement !== $('loopBarsInput')) $('loopBarsInput').value = d.loopBars;
    var spt = App.secPerTick();
    var loopSec = d.loopBars * TPB * spt;
    var txt = 'ループ ' + App.fmtTime(loopSec);
    if (App.introBars()) txt += '（＋イントロ ' + App.fmtTime(App.introTicks() * spt) + '）';
    var el = $('lengthDisplay');
    el.textContent = txt;
    var warn = loopSec < 180 || loopSec >= 600;
    el.classList.toggle('warn', warn);
    el.title = warn ? 'ループ部分の長さは3分以上10分未満を推奨しています' : 'ループ部分の長さ（3分以上10分未満を推奨）';
    if (warn) el.textContent += loopSec < 180 ? '  ⚠ 3分未満' : '  ⚠ 10分以上';
    $('btnUndo').disabled = !App.undoStack.length;
    $('btnRedo').disabled = !App.redoStack.length;
    refreshPos();
    refreshRange();
  }
  function refreshPos() {
    var t = App.playing && App.player ? App.player.currentTick() : App.cursor;
    $('posDisplay').textContent = App.fmtPos(t);
  }
  function refreshPlayButton() {
    var b = $('btnPlay');
    b.textContent = App.playing ? '■ 停止' : '▶ 再生';
    b.classList.toggle('playing', App.playing);
  }
  function refreshRange() {
    var r = App.range;
    $('rangeInfo').textContent = r ? (r.start + 1) + '〜' + r.end + ' 小節（' + (r.end - r.start) + ' 小節）' : 'ルーラー（小節番号の帯）をドラッグして選択';
    document.querySelectorAll('[data-needs-range]').forEach(function (b) { b.disabled = !r; });
  }

  function bindTop() {
    NOTE_SELECT();
    $('titleInput').addEventListener('change', function () { App.edit(function () { App.doc.title = $('titleInput').value; }, { param: true }); });
    $('bpmInput').addEventListener('change', function () {
      var v = Math.max(30, Math.min(300, Math.round(Number($('bpmInput').value) || 120)));
      App.edit(function () { App.doc.bpm = v; }, { param: true });
      refreshTransport();
    });
    $('tonicSelect').addEventListener('change', function () { App.edit(function () { App.doc.key.tonic = $('tonicSelect').value; }, { param: true }); });
    $('modeSelect').addEventListener('change', function () { App.edit(function () { App.doc.key.mode = $('modeSelect').value; }, { param: true }); });
    $('chkIntro').addEventListener('change', function () { App.setIntro($('chkIntro').checked); refreshTransport(); });
    $('introBarsInput').addEventListener('change', function () { App.setIntroBars(Number($('introBarsInput').value)); refreshTransport(); });
    $('loopBarsInput').addEventListener('change', function () { App.setLoopBars(Number($('loopBarsInput').value)); refreshTransport(); });
    $('snapSelect').addEventListener('change', function () { App.snap = Number($('snapSelect').value); PR.dirty = true; });
    $('lenSelect').addEventListener('change', function () { App.lenSetting = Number($('lenSelect').value); });
    $('chkGhost').addEventListener('change', function () { PR.dirty = true; });
    $('zoomInput').addEventListener('input', function () { PR.setZoom(Number($('zoomInput').value)); });

    $('btnPlay').addEventListener('click', function () { App.togglePlay(); });
    $('btnHome').addEventListener('click', function () { App.cursor = 0; App.emit('cursor'); PR.scrollToTick(0); if (App.playing) App.play(); });
    $('btnSeam').addEventListener('click', function () {
      App.play('seam').then(function () { PR.scrollToTick(Math.max(App.introTicks(), App.totalTicks() - 2 * TPB)); });
      App.msg('ループの最後の2小節から再生しています。先頭へ戻る所のつながりを確認してください。');
    });
    $('chkRangeLoop').addEventListener('change', function () { if (App.playing) App.play(); });

    $('btnUndo').addEventListener('click', App.undo);
    $('btnRedo').addEventListener('click', App.redo);
    $('btnNew').addEventListener('click', function () {
      if (!confirm('新しい曲を作りますか？（今の曲は「元に戻す」で戻せます）')) return;
      App.stop();
      App.edit(function () { App.doc = App.fromScore(BGM.createEmptyScore()); App.part = 0; App.cursor = 0; });
      PR.scrollToTick(0);
    });
    $('btnOpen').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      var f = $('fileInput').files[0];
      if (f) openFile(f);
      $('fileInput').value = '';
    });
    $('btnSave').addEventListener('click', saveFile);
    $('btnWav').addEventListener('click', function () { openModal('dlgWav'); $('wavInfo').textContent = ''; $('wavProgress').style.width = '0'; });
    $('btnAI').addEventListener('click', function () { openPlanDialog(true); });
    $('btnPlan').addEventListener('click', function () { openPlanDialog(false); });
    $('btnSettings').addEventListener('click', openSettings);
    $('btnHelp').addEventListener('click', function () { openModal('dlgHelp'); });
    $('btnCheck').addEventListener('click', checkScore);

    $('btnRangeCopyAll').addEventListener('click', function () { App.copyRange(true); });
    $('btnRangeCopyPart').addEventListener('click', function () { App.copyRange(false); });
    $('btnRangePaste').addEventListener('click', App.pasteRange);
    $('btnRangeClear').addEventListener('click', function () { App.clearRange(); });
    $('btnRangeDelete').addEventListener('click', function () {
      var r = App.range;
      if (!r || !confirm((r.start + 1) + '〜' + r.end + ' 小節を削除して後ろを詰めますか？')) return;
      if (App.deleteBars(r.start, r.end - r.start)) { App.range = null; App.emit('range'); }
    });
    $('btnInsertBars').addEventListener('click', function () {
      var bar = Math.floor(App.cursor / TPB);
      var def = App.range ? App.range.end - App.range.start : 4;
      var n = prompt((bar + 1) + ' 小節目の前に、何小節挿入しますか？', String(def));
      if (n == null) return;
      n = Math.round(Number(n));
      if (!(n >= 1 && n <= 256)) { App.msg('1〜256 の数を入力してください', 'warn'); return; }
      App.insertBars(bar, n);
    });
    $('btnRangeTranspose').addEventListener('click', function () {
      var n = prompt('選択中のパートを何半音移調しますか？（例：2、-12）', '0');
      if (n == null) return;
      App.transposeRange(Math.round(Number(n)) || 0);
    });
    $('btnRangeNone').addEventListener('click', function () { App.range = null; App.emit('range'); });
  }
  function NOTE_SELECT() {
    var s = $('tonicSelect');
    BGM.NOTE_NAMES.forEach(function (n) { s.appendChild(h('option', { value: n, text: n })); });
  }

  // ---------------------------------------------------------------
  // ファイル
  // ---------------------------------------------------------------
  function openFile(f) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(String(r.result));
        App.stop();
        App.edit(function () { App.doc = App.fromScore(data); App.cursor = 0; });
        PR.scrollToTick(0);
        var probs = BGM.validateScore(App.toScore());
        App.msg('「' + f.name + '」を開きました' + (probs.length ? '（注意: ' + probs[0] + (probs.length > 1 ? ' ほか' + (probs.length - 1) + '件' : '') + '）' : ''), probs.length ? 'warn' : 'info');
      } catch (e) {
        App.msg('ファイルを読み込めませんでした: ' + e.message, 'error');
      }
    };
    r.readAsText(f);
  }
  function saveFile() {
    var blob = new Blob([App.serialize()], { type: 'application/json' });
    App.saveBlob(blob, App.safeFileName(App.doc.title) + '.bgm.json', 'CustomBGM 楽譜ファイル', '.json').then(function (ok) {
      if (ok) App.msg('楽譜ファイルを保存しました');
    });
  }
  function checkScore() {
    var probs = BGM.validateScore(App.toScore());
    var loopSec = App.doc.loopBars * TPB * App.secPerTick();
    if (loopSec < 180) probs.push('ループ部分が3分未満です（' + App.fmtTime(loopSec) + '）');
    if (loopSec >= 600) probs.push('ループ部分が10分以上です（' + App.fmtTime(loopSec) + '）');
    alert(probs.length ? '見つかった点:\n・' + probs.join('\n・') : '問題は見つかりませんでした。');
  }

  // ---------------------------------------------------------------
  // モーダル
  // ---------------------------------------------------------------
  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }
  function anyModal() { return Array.prototype.some.call(document.querySelectorAll('.modal'), function (m) { return !m.hidden; }); }
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeModal(m.id);
    });
  });

  // ---------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------
  function openSettings() {
    var s = App.settings();
    $('setApiKey').value = s.apiKey || '';
    $('setModel').value = s.model || AI.DEFAULT_MODEL;
    $('setEffort').value = s.effort || 'medium';
    openModal('dlgSettings');
  }
  $('btnSettingsSave').addEventListener('click', function () {
    var s = App.settings();
    s.apiKey = $('setApiKey').value.trim();
    s.model = $('setModel').value.trim() || AI.DEFAULT_MODEL;
    s.effort = $('setEffort').value;
    if (App.saveSettings(s)) { closeModal('dlgSettings'); App.msg('設定を保存しました'); }
  });
  $('btnForgetKey').addEventListener('click', function () {
    var s = App.settings(); s.apiKey = ''; App.saveSettings(s); $('setApiKey').value = ''; App.msg('APIキーを削除しました');
  });

  // ---------------------------------------------------------------
  // WAV 書き出し
  // ---------------------------------------------------------------
  var wavBusy = false;
  function wavButton(label, pcm, filename) {
    var blob = new Blob([BGM.encodeWAV(pcm)], { type: 'audio/wav' });
    return h('button', { class: 'accent', text: label + '（' + (blob.size / 1048576).toFixed(1) + ' MB）', onclick: function () {
      App.saveBlob(blob, filename, 'WAV 音声ファイル', '.wav').then(function (ok) { if (ok) App.msg(filename + ' を保存しました'); });
    } });
  }
  $('btnWav').addEventListener('click', function () { $('wavFiles').innerHTML = ''; });
  $('btnWavRun').addEventListener('click', function () {
    if (wavBusy) return;
    var mode = document.querySelector('input[name=wavMode]:checked').value;
    var loops = Math.max(1, Math.min(4, Math.round(Number($('wavLoops').value) || 1)));
    var fade = Math.max(0, Math.min(30, Number($('wavFade').value) || 0));
    var score = App.toScore();
    var probs = BGM.validateScore(score);
    wavBusy = true;
    $('btnWavRun').disabled = true;
    $('wavFiles').innerHTML = '';
    $('wavInfo').textContent = '書き出し中…（長い曲は少し時間がかかります）';
    var base = App.safeFileName(App.doc.title);
    var t0 = Date.now();
    BGM.renderPCM(score, { mode: mode === 'split' ? 'game' : mode, loops: loops, fadeOut: fade }, function (p) {
      $('wavProgress').style.width = Math.round(p * 100) + '%';
    }).then(function (pcm) {
      var sr = pcm.sampleRate;
      var info = [], files = $('wavFiles');
      if (mode === 'split') {
        var ls = pcm.loopStart;
        if (ls > 0) {
          var intro = { sampleRate: sr, frames: ls, data: pcm.data.subarray(0, ls * 2), loopStart: -1, loopEnd: -1 };
          files.appendChild(wavButton('イントロを保存', intro, base + '_intro.wav'));
        }
        var lp = { sampleRate: sr, frames: pcm.frames - ls, data: pcm.data.subarray(ls * 2), loopStart: 0, loopEnd: pcm.frames - ls };
        files.appendChild(wavButton('ループを保存', lp, base + '_loop.wav'));
        info.push(ls > 0 ? 'イントロ（' + (ls / sr).toFixed(3) + '秒）とループ（' + ((pcm.frames - ls) / sr).toFixed(3) + '秒）ができました。ゲームではイントロを1回流した後、ループを繰り返してください。' : 'イントロが無いのでループのファイルだけです。');
      } else {
        files.appendChild(wavButton('WAVを保存', pcm, base + (mode === 'game' ? '_game' : '') + '.wav'));
        if (mode === 'game') info.push('ループ開始位置: ' + pcm.loopStart + ' サンプル（' + (pcm.loopStart / sr).toFixed(3) + '秒）、ループ終了: ' + pcm.loopEnd + ' サンプル（' + (pcm.loopEnd / sr).toFixed(3) + '秒、ファイルの末尾）。サンプリング周波数 ' + sr + 'Hz。');
        else info.push('長さ ' + App.fmtTime(pcm.frames / sr) + ' の音声ができました。');
      }
      info.push('（' + ((Date.now() - t0) / 1000).toFixed(1) + '秒で処理）');
      if (probs.length) info.push('注意: ' + probs.join(' / '));
      $('wavInfo').textContent = info.join(' ');
    }).catch(function (e) {
      $('wavInfo').textContent = '書き出しに失敗しました: ' + e.message;
    }).then(function () { wavBusy = false; $('btnWavRun').disabled = false; });
  });

  // ---------------------------------------------------------------
  // 設計図ダイアログ
  // ---------------------------------------------------------------
  var draft = null, draftWarnings = [], aiAbort = null;

  function openPlanDialog(focusAI) {
    if (!draft) draft = (App.doc.meta && App.doc.meta.plan) ? JSON.parse(JSON.stringify(App.doc.meta.plan)) : Arr.samplePlan();
    draftWarnings = [];
    renderPlan();
    openModal('dlgPlan');
    if (focusAI) setTimeout(function () { $('aiPrompt').focus(); }, 30);
  }

  function opt(sel, value, label) { sel.appendChild(h('option', { value: value, text: label })); }

  function renderPlan() {
    var host = $('planEditor');
    host.innerHTML = '';
    var p = draft;
    // 基本
    var title = h('input', { type: 'text', value: p.title || '' });
    title.addEventListener('input', function () { p.title = title.value; });
    var bpm = h('input', { type: 'number', min: 40, max: 260, value: p.bpm });
    bpm.addEventListener('input', function () { p.bpm = Number(bpm.value) || 120; updateLen(); });
    var tonic = h('select'); BGM.NOTE_NAMES.forEach(function (n) { opt(tonic, n, n); }); tonic.value = p.key.tonic;
    tonic.addEventListener('change', function () { p.key.tonic = tonic.value; });
    var mode = h('select'); opt(mode, 'major', '長調'); opt(mode, 'minor', '短調'); mode.value = p.key.mode;
    mode.addEventListener('change', function () { p.key.mode = mode.value; });
    var feel = h('select'); opt(feel, 'straight', 'ふつう（イーブン）'); opt(feel, 'shuffle', 'シャッフル（ハネる）'); feel.value = p.feel || 'straight';
    feel.addEventListener('change', function () { p.feel = feel.value; });
    var lenEl = h('span', { class: 'plan-len' });
    host.appendChild(h('div', { class: 'plan-grid' }, [
      h('label', { text: 'タイトル' }), title, h('label', { text: 'BPM' }), bpm,
      h('label', { text: '調' }), h('span', {}, [tonic, mode]), h('label', { text: 'ノリ' }), feel
    ]));
    function updateLen() {
      var L = Arr.planLength(p);
      var t = 'ループ ' + L.loopBars + ' 小節 = ' + App.fmtTime(L.loopSeconds);
      if (L.introBars) t += '　／　イントロ ' + L.introBars + ' 小節 = ' + App.fmtTime(L.introSeconds);
      var warn = L.loopSeconds < 180 || L.loopSeconds >= 600;
      if (warn) t += '　⚠ ループは3分以上10分未満を推奨';
      lenEl.textContent = t;
      lenEl.classList.toggle('warn', warn);
    }

    // セクション
    host.appendChild(h('div', { class: 'panel-h' }, ['セクション（上から順に演奏。イントロは先頭にだけ置けます）', lenEl]));
    var st = h('table', { class: 'plan-table' });
    st.appendChild(h('tr', {}, ['名前', 'イントロ', '小節', '盛り上がり', 'コード進行（| で小節を区切る。1小節に2つなら空白で区切る）', '終わり方', ''].map(function (x) { return h('th', { text: x }); })));
    p.sections.forEach(function (s, i) {
      var name = h('input', { type: 'text', value: s.name }); name.addEventListener('input', function () { s.name = name.value; });
      var intro = h('input', { type: 'checkbox' }); intro.checked = !!s.intro; intro.addEventListener('change', function () { s.intro = intro.checked; updateLen(); });
      var bars = h('input', { type: 'number', min: 1, max: 256, value: s.bars }); bars.addEventListener('input', function () { s.bars = Math.max(1, Math.round(Number(bars.value) || 1)); updateLen(); });
      var en = h('select'); [1, 2, 3, 4, 5].forEach(function (v) { opt(en, v, String(v)); }); en.value = s.energy; en.addEventListener('change', function () { s.energy = Number(en.value); });
      var ch = h('input', { type: 'text', class: 'chords', value: s.chords }); ch.addEventListener('input', function () { s.chords = ch.value; });
      var end = h('select'); Object.keys(Arr.ENDINGS).forEach(function (k) { opt(end, k, Arr.ENDINGS[k].split('（')[0]); }); end.value = s.ending; end.title = Arr.ENDINGS[s.ending];
      end.addEventListener('change', function () { s.ending = end.value; end.title = Arr.ENDINGS[s.ending]; });
      var ops = h('td', { class: 'ops' }, [
        h('button', { text: '↑', title: '上へ', onclick: function () { if (i > 0) { p.sections.splice(i - 1, 0, p.sections.splice(i, 1)[0]); renderPlan(); } } }),
        h('button', { text: '↓', title: '下へ', onclick: function () { if (i < p.sections.length - 1) { p.sections.splice(i + 1, 0, p.sections.splice(i, 1)[0]); renderPlan(); } } }),
        h('button', { text: '複製', title: '下に複製', onclick: function () { p.sections.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); renderPlan(); } }),
        h('button', { text: '×', title: '削除', onclick: function () { p.sections.splice(i, 1); renderPlan(); } })
      ]);
      st.appendChild(h('tr', {}, [h('td', {}, [name]), h('td', {}, [intro]), h('td', {}, [bars]), h('td', {}, [en]), h('td', { style: 'width:42%' }, [ch]), h('td', {}, [end]), ops]));
    });
    host.appendChild(st);
    host.appendChild(h('button', { text: '＋ セクションを追加', onclick: function () { p.sections.push({ name: '新規', intro: false, bars: 16, energy: 3, chords: 'C | G | Am | F', ending: 'none' }); renderPlan(); } }));

    // レイヤー
    host.appendChild(h('div', { class: 'panel-h', text: 'レイヤー（パートの役割。パート1・2はメロディ用に空けておくのがおすすめ）' }));
    var lt = h('table', { class: 'plan-table' });
    lt.appendChild(h('tr', {}, ['役割', 'パート番号', '音色', '奏法', 'オクターブ', '音量', '鳴らすセクション（空欄なら全部。カンマ区切り）', ''].map(function (x) { return h('th', { text: x }); })));
    p.layers.forEach(function (l, i) {
      var role = h('select'); Object.keys(Arr.ROLES).forEach(function (k) { opt(role, k, Arr.ROLES[k].label); }); role.value = l.role;
      role.addEventListener('change', function () {
        l.role = role.value;
        var R = Arr.ROLES[l.role];
        l.pattern = R.defaultPattern; l.instrument = R.defaultInstrument;
        renderPlan();
      });
      var parts = h('input', { type: 'text', value: (l.parts || []).join(','), style: 'width:70px', title: Arr.ROLES[l.role] ? '最大 ' + Arr.ROLES[l.role].maxParts + ' パート' : '' });
      parts.addEventListener('input', function () { l.parts = parts.value.split(/[,、\s]+/).map(Number).filter(function (x) { return x >= 1 && x <= 8; }); });
      var inst = Panels.instrumentSelect(l.instrument, function (v) { l.instrument = v; });
      var pat = h('select'); Object.keys(Arr.PATTERNS).forEach(function (k) { if (Arr.PATTERNS[k].role === l.role) opt(pat, k, Arr.PATTERNS[k].label); }); pat.value = l.pattern;
      pat.addEventListener('change', function () { l.pattern = pat.value; });
      var oct = h('select'); [-2, -1, 0, 1, 2].forEach(function (v) { opt(oct, v, (v > 0 ? '+' : '') + v); }); oct.value = l.octave || 0;
      oct.addEventListener('change', function () { l.octave = Number(oct.value); });
      var vol = h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: l.volume }); vol.addEventListener('input', function () { l.volume = Number(vol.value); });
      var secs = h('input', { type: 'text', value: (l.sections || []).join(', ') });
      secs.addEventListener('input', function () { l.sections = secs.value.split(/[,、]/).map(function (x) { return x.trim(); }).filter(Boolean); });
      lt.appendChild(h('tr', {}, [h('td', {}, [role]), h('td', {}, [parts]), h('td', {}, [inst]), h('td', {}, [pat]), h('td', {}, [oct]), h('td', {}, [vol]), h('td', {}, [secs]),
        h('td', { class: 'ops' }, [h('button', { text: '×', onclick: function () { p.layers.splice(i, 1); renderPlan(); } })])]));
    });
    host.appendChild(lt);
    host.appendChild(h('button', {
      text: '＋ レイヤーを追加', onclick: function () {
        var used = {}; p.layers.forEach(function (l) { (l.parts || []).forEach(function (x) { used[x] = true; }); });
        var free = [3, 4, 5, 6, 7, 8, 1, 2].filter(function (x) { return !used[x]; })[0] || 8;
        p.layers.push({ role: 'arpeggio', parts: [free], instrument: 'pulse12', pattern: 'arp_up16', octave: 0, volume: 0.5, sections: [] });
        renderPlan();
      }
    }));
    if (p.summary) {
      host.appendChild(h('div', { class: 'panel-h', text: '設計図の説明' }));
      host.appendChild(h('div', { class: 'plan-summary', text: p.summary }));
    }
    if (draftWarnings.length) host.appendChild(h('div', { class: 'plan-warn' }, draftWarnings.map(function (w) { return h('div', { text: '⚠ ' + w }); })));
    updateLen();
  }

  $('btnPlanSample').addEventListener('click', function () { draft = Arr.samplePlan(); draftWarnings = []; renderPlan(); });
  $('btnPlanFromScore').addEventListener('click', function () {
    var pl = App.doc.meta && App.doc.meta.plan;
    if (!pl) { App.msg('この曲には設計図が保存されていません（AIや設計図から生成した曲にだけ残ります）', 'warn'); return; }
    draft = JSON.parse(JSON.stringify(pl)); draftWarnings = []; renderPlan();
  });
  $('btnPlanCopy').addEventListener('click', function () {
    var text = JSON.stringify(draft, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { App.msg('設計図をクリップボードにコピーしました'); }, function () { prompt('コピーしてください', text); });
    else prompt('コピーしてください', text);
  });
  $('btnPlanPaste').addEventListener('click', function () {
    var t = prompt('設計図のJSONを貼り付けてください');
    if (!t) return;
    try { var r = Arr.normalizePlan(JSON.parse(t)); draft = r.plan; draftWarnings = r.warnings; renderPlan(); }
    catch (e) { App.msg('JSON を読み込めませんでした: ' + e.message, 'error'); }
  });
  $('btnPlanGenerate').addEventListener('click', function () {
    var keep = $('chkKeepOther').checked;
    var res;
    try { res = Arr.generate(draft, keep ? App.toScore() : null); }
    catch (e) { App.msg('生成に失敗しました: ' + e.message, 'error'); return; }
    App.stop();
    App.edit(function () { App.doc = App.fromScore(res.score); App.cursor = 0; App.sel.clear(); });
    draft = JSON.parse(JSON.stringify(res.plan));
    PR.scrollToTick(0);
    closeModal('dlgPlan');
    var L = Arr.planLength(res.plan);
    App.msg('設計図から下地を生成しました（ループ ' + App.fmtTime(L.loopSeconds) + '）。気に入らなければ Ctrl+Z で元に戻せます。' + (res.warnings.length ? ' 注意: ' + res.warnings.join(' / ') : ''), res.warnings.length ? 'warn' : 'info');
  });

  $('btnAIRun').addEventListener('click', function () {
    var prompt = $('aiPrompt').value.trim();
    if (!prompt) { setAIStatus('雰囲気を書いてください', true); return; }
    var s = App.settings();
    if (!s.apiKey) { setAIStatus('先に「設定」で Anthropic の APIキーを入力してください', true); openSettings(); return; }
    aiAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    $('btnAIRun').disabled = true; $('btnAICancel').hidden = false;
    var t0 = Date.now();
    AI.requestPlan({
      apiKey: s.apiKey, model: s.model, effort: s.effort, prompt: prompt,
      signal: aiAbort ? aiAbort.signal : undefined,
      onStatus: function (t) { setAIStatus(t + '（' + Math.round((Date.now() - t0) / 1000) + '秒）'); }
    }).then(function (r) {
      var n = Arr.normalizePlan(r.plan);
      draft = n.plan; draftWarnings = n.warnings;
      renderPlan();
      var L = Arr.planLength(draft);
      setAIStatus('設計図ができました（' + r.model + '、' + Math.round((Date.now() - t0) / 1000) + '秒、ループ ' + App.fmtTime(L.loopSeconds) + '）。内容を確認・修正してから「この設計図から音符を生成」を押してください。');
    }).catch(function (e) {
      setAIStatus(e.message, true);
    }).then(function () {
      $('btnAIRun').disabled = false; $('btnAICancel').hidden = true; aiAbort = null;
    });
  });
  $('btnAICancel').addEventListener('click', function () { if (aiAbort) aiAbort.abort(); });
  function setAIStatus(t, err) { var el = $('aiStatus'); el.textContent = t; el.classList.toggle('error', !!err); }

  // ---------------------------------------------------------------
  // キーボード
  // ---------------------------------------------------------------
  function isTyping(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range' && t.type !== 'radio' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }
  document.addEventListener('keydown', function (e) {
    if (anyModal()) { if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; }); return; }
    if (isTyping(e)) return;
    var ctrl = e.ctrlKey || e.metaKey;
    var k = e.key;
    if (k === ' ') { e.preventDefault(); App.togglePlay(); return; }
    if (k === 'Home') { e.preventDefault(); App.cursor = 0; App.emit('cursor'); PR.scrollToTick(0); return; }
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) App.redo(); else App.undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); App.redo(); return; }
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); saveFile(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); App.sel = new Set(App.curPart().notes); App.emit('selection'); return; }
    if (ctrl && (k === 'c' || k === 'C')) { e.preventDefault(); if (!App.copyNotes(false) && App.range) App.copyRange(true); return; }
    if (ctrl && (k === 'x' || k === 'X')) { e.preventDefault(); App.copyNotes(true); return; }
    if (ctrl && (k === 'v' || k === 'V')) { e.preventDefault(); if (App.clipboard && App.clipboard.type === 'range') App.pasteRange(); else App.pasteNotes(); return; }
    if (k === 'Delete' || k === 'Backspace') {
      if (!App.sel.size) return;
      e.preventDefault();
      App.edit(function () { var p = App.curPart(); p.notes = p.notes.filter(function (n) { return !App.sel.has(n); }); App.sel.clear(); }, {});
      return;
    }
    if (k === 'Escape') { App.sel.clear(); App.range = null; App.emit('selection'); App.emit('range'); return; }
    if (!ctrl && /^[1-8]$/.test(k)) { Panels.selectPart(Number(k) - 1); return; }
    if (App.sel.size && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault();
      var sel = Array.from(App.sel);
      var total = App.totalTicks();
      App.edit(function () {
        if (k === 'ArrowUp' || k === 'ArrowDown') {
          var dir = k === 'ArrowUp' ? 1 : -1;
          if (PR.isDrum()) {
            var rows = App.DRUM_ROWS;
            sel.forEach(function (n) { var r = rows.indexOf(n.p) - dir; if (r >= 0 && r < rows.length) n.p = rows[r]; });
          } else {
            var step = e.shiftKey ? 12 : 1;
            sel.forEach(function (n) { n.p = Math.max(0, Math.min(127, n.p + dir * step)); });
          }
        } else {
          var dt = (k === 'ArrowRight' ? 1 : -1) * App.snap;
          var minT = Math.min.apply(null, sel.map(function (n) { return n.t; }));
          var maxE = Math.max.apply(null, sel.map(function (n) { return n.t + n.d; }));
          if (minT + dt < 0 || maxE + dt > total) return;
          sel.forEach(function (n) { n.t += dt; });
        }
        App.sel = new Set(sel);
        App.resolveMono(App.part, App.sel);
      }, {});
      if ((k === 'ArrowUp' || k === 'ArrowDown') && sel.length === 1) App.preview(sel[0].p, sel[0].v);
    }
  });

  // ドラッグ＆ドロップでファイルを開く
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------
  var initial = App.loadAutosave();
  try { App.doc = App.fromScore(initial || BGM.createEmptyScore()); }
  catch (e) { App.doc = App.fromScore(BGM.createEmptyScore()); }
  bindTop();
  PR.init();
  Panels.init();
  App.on('change', function () { refreshTransport(); });
  App.on('transport', function () { refreshPlayButton(); refreshPos(); });
  App.on('tick', refreshPos);
  App.on('cursor', refreshPos);
  App.on('range', refreshRange);
  App.changed({ structure: true });
  App.msg(initial ? '前回の編集内容を読み込みました' : 'ようこそ。「AIで下地を作る」か「設計図」から始めるか、そのまま打ち込みを始めてください。「？」で操作方法を確認できます。');
})();
