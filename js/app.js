/*
 * エディタの状態・編集操作・履歴・再生の管理
 */
(function () {
  'use strict';
  var BGM = window.CustomBGM;
  var TPB = BGM.TICKS_PER_BAR;
  var AUTOSAVE_KEY = 'custombgm.autosave.v1';
  var SETTINGS_KEY = 'custombgm.settings.v1';

  var App = window.App = {
    BGM: BGM,
    TPB: TPB,
    COLORS: ['#ff7a7a', '#ffad5c', '#ffd84d', '#7ee08a', '#4fd6b8', '#5cb3ff', '#a48bff', '#ff8cc6'],
    DRUM_ROWS: [49, 51, 46, 42, 50, 47, 45, 39, 38, 37, 36],
    doc: null,
    part: 0,
    sel: new Set(),
    snap: 12,
    lenSetting: 0,
    cursor: 0,
    range: null,          // { start: 小節, end: 小節（含まない） }
    clipboard: null,
    undoStack: [],
    redoStack: [],
    player: null,
    playing: false,
    playMode: null,
    _listeners: {}
  };

  // ---------------------------------------------------------------
  // イベント
  // ---------------------------------------------------------------
  App.on = function (ev, fn) { (App._listeners[ev] = App._listeners[ev] || []).push(fn); };
  App.emit = function (ev, arg) { (App._listeners[ev] || []).forEach(function (fn) { fn(arg); }); };

  var msgTimer = null;
  App.msg = function (text, level) {
    var el = document.getElementById('statusMsg');
    el.textContent = text || '';
    el.className = level || 'info';
    if (msgTimer) clearTimeout(msgTimer);
    if (text && level !== 'error') msgTimer = setTimeout(function () { el.textContent = ''; }, level === 'warn' ? 9000 : 5000);
  };
  App.hint = function (text) { document.getElementById('statusHint').textContent = text || ''; };

  // ---------------------------------------------------------------
  // 楽譜 <-> 編集用データ
  // ---------------------------------------------------------------
  App.fromScore = function (score) {
    var s = BGM.normalizeScore(score);
    s.parts.forEach(function (p) {
      p.notes = p.notes.map(function (n) { return { t: n[0], d: n[1], p: n[2], v: n[3] }; });
    });
    return s;
  };
  App.toScore = function () {
    var d = App.doc;
    var out = {
      format: BGM.FORMAT_NAME, version: BGM.FORMAT_VERSION,
      about: 'CustomBGMEditor の楽譜ファイル。仕様は docs/FORMAT.md、再生・WAV書き出しは engine/bgm-engine.js を参照。',
      title: d.title, bpm: d.bpm, ppq: BGM.PPQ, beatsPerBar: BGM.BEATS_PER_BAR,
      key: { tonic: d.key.tonic, mode: d.key.mode },
      intro: { enabled: d.intro.enabled, bars: d.intro.bars },
      loopBars: d.loopBars,
      sections: d.sections.map(function (s) { return { bar: s.bar, name: s.name }; }),
      master: JSON.parse(JSON.stringify(d.master)),
      parts: d.parts.map(function (p) {
        var notes = p.notes.slice().sort(function (a, b) { return a.t - b.t || a.p - b.p; })
          .map(function (n) { return [n.t, n.d, n.p, n.v]; });
        return {
          name: p.name, instrument: p.instrument, params: JSON.parse(JSON.stringify(p.params || {})),
          volume: p.volume, pan: p.pan, reverb: p.reverb, delay: p.delay, mute: p.mute, solo: p.solo,
          notes: notes
        };
      }),
      meta: JSON.parse(JSON.stringify(d.meta || {}))
    };
    return out;
  };
  App.serialize = function () {
    var json = JSON.stringify(App.toScore(), null, 2);
    return json.replace(/\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2, $3, $4]');
  };
  App.snapshot = function () { return JSON.stringify(App.toScore()); };

  App.load = function (score, opts) {
    opts = opts || {};
    App.doc = App.fromScore(score);
    App.sel.clear();
    App.range = null;
    if (opts.resetHistory !== false) { App.undoStack = []; App.redoStack = []; }
    App.cursor = Math.min(App.cursor, App.totalTicks() - 1);
    if (App.cursor < 0) App.cursor = 0;
    App.changed({ structure: true });
  };

  // ---------------------------------------------------------------
  // 時間
  // ---------------------------------------------------------------
  App.introBars = function () { return App.doc.intro.enabled ? App.doc.intro.bars : 0; };
  App.introTicks = function () { return App.introBars() * TPB; };
  App.totalBars = function () { return App.introBars() + App.doc.loopBars; };
  App.totalTicks = function () { return App.totalBars() * TPB; };
  App.secPerTick = function () { return 60 / (App.doc.bpm * BGM.PPQ); };
  App.fmtTime = function (sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  App.fmtPos = function (tick) {
    var bar = Math.floor(tick / TPB), beat = Math.floor((tick % TPB) / BGM.PPQ);
    var b = String(bar + 1); while (b.length < 3) b = '0' + b;
    return b + ':' + (beat + 1);
  };
  App.noteLen = function () { return App.lenSetting > 0 ? App.lenSetting : App.snap; };
  App.isDrumPart = function (i) { return BGM.isDrumInstrument(App.doc.parts[i].instrument); };
  App.curPart = function () { return App.doc.parts[App.part]; };

  // ---------------------------------------------------------------
  // 編集と履歴
  // ---------------------------------------------------------------
  App.beginEdit = function () { return App.snapshot(); };
  // 編集の確定。制約違反なら before に戻す。
  App.endEdit = function (before, opts) {
    opts = opts || {};
    App.clampNotes();
    var problem = App.checkDrums();
    if (problem) {
      App.restore(before);
      App.msg(problem, 'warn');
      App.changed({});
      return false;
    }
    var after = App.snapshot();
    if (after !== before) {
      App.undoStack.push(before);
      if (App.undoStack.length > 200) App.undoStack.shift();
      App.redoStack = [];
      App.changed(opts);
    } else if (opts.forceRedraw) App.changed(opts);
    return true;
  };
  App.edit = function (fn, opts) {
    var before = App.beginEdit();
    var r = fn();
    if (r === false) { App.restore(before); App.changed({}); return false; }
    return App.endEdit(before, opts || { structure: true });
  };
  App.restore = function (json) {
    var keepPart = App.part;
    App.doc = App.fromScore(JSON.parse(json));
    App.part = keepPart;
    App.sel.clear();
  };
  App.undo = function () {
    if (!App.undoStack.length) { App.msg('これ以上元に戻せません', 'info'); return; }
    App.redoStack.push(App.snapshot());
    App.restore(App.undoStack.pop());
    App.changed({ structure: true });
  };
  App.redo = function () {
    if (!App.redoStack.length) { App.msg('これ以上やり直せません', 'info'); return; }
    App.undoStack.push(App.snapshot());
    App.restore(App.redoStack.pop());
    App.changed({ structure: true });
  };

  var syncTimer = null, saveTimer = null;
  App.changed = function (opts) {
    opts = opts || {};
    App.emit('change', opts);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(App.syncPlayer, 60);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(App.autosave, 800);
  };
  App.syncPlayer = function () {
    syncTimer = null;
    if (App.player && App.player._send) App.player.update(App.toScore());
  };

  var autosaveWarned = false;
  App.autosave = function () {
    saveTimer = null;
    try { localStorage.setItem(AUTOSAVE_KEY, App.snapshot()); }
    catch (e) { if (!autosaveWarned) { autosaveWarned = true; App.msg('ブラウザへの自動保存に失敗しました。こまめに「保存」でファイルに残してください。', 'warn'); } }
  };
  App.loadAutosave = function () {
    try { var s = localStorage.getItem(AUTOSAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };

  App.settings = function () {
    var def = { apiKey: '', model: window.CustomBGMAI ? CustomBGMAI.DEFAULT_MODEL : 'claude-opus-5-5', effort: 'medium' };
    try { var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); for (var k in s) def[k] = s[k]; } catch (e) { /* noop */ }
    return def;
  };
  App.saveSettings = function (s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; }
    catch (e) { App.msg('設定を保存できませんでした（ブラウザの保存領域が使えません）', 'error'); return false; }
  };

  // ---------------------------------------------------------------
  // 制約（1パート1音・ドラム3音）
  // ---------------------------------------------------------------
  function overlaps(a, b) { return a.t < b.t + b.d && b.t < a.t + a.d; }

  // priority の音符を優先して、同じパート内の重なりを解消
  App.resolveMono = function (partIndex, priority) {
    var part = App.doc.parts[partIndex];
    priority = priority || new Set();
    if (App.isDrumPart(partIndex)) {
      // 同じタイミング・同じ音の重複を消す
      var seen = {};
      var arr = part.notes.slice().sort(function (a, b) { return (priority.has(b) ? 1 : 0) - (priority.has(a) ? 1 : 0); });
      var keep = new Set();
      arr.forEach(function (n) { var k = n.t + ':' + n.p; if (!seen[k]) { seen[k] = true; keep.add(n); } });
      part.notes = part.notes.filter(function (n) { return keep.has(n); });
      return;
    }
    var removed = new Set();
    var pri = part.notes.filter(function (n) { return priority.has(n); });
    pri.forEach(function (e) {
      part.notes.forEach(function (o) {
        if (o === e || priority.has(o) || removed.has(o)) return;
        if (!overlaps(o, e)) return;
        if (o.t < e.t) o.d = e.t - o.t; else removed.add(o);
      });
    });
    var notes = part.notes.filter(function (n) { return !removed.has(n) && n.d > 0; });
    notes.sort(function (a, b) { return a.t - b.t || (priority.has(b) ? 1 : 0) - (priority.has(a) ? 1 : 0); });
    var out = [];
    notes.forEach(function (n) {
      var prev = out[out.length - 1];
      if (prev && prev.t === n.t) return;
      if (prev && prev.t + prev.d > n.t) prev.d = n.t - prev.t;
      out.push(n);
    });
    part.notes = out;
    App.sel.forEach(function (n) { if (out.indexOf(n) < 0 && partIndex === App.part) App.sel.delete(n); });
  };

  App.checkDrums = function () {
    var d = App.doc;
    for (var i = 0; i < d.parts.length; i++) {
      if (!App.isDrumPart(i)) continue;
      var count = {};
      var notes = d.parts[i].notes;
      for (var j = 0; j < notes.length; j++) {
        count[notes[j].t] = (count[notes[j].t] || 0) + 1;
        if (count[notes[j].t] > BGM.DRUM_MAX_POLY) return 'ドラムのパートは同じタイミングに' + BGM.DRUM_MAX_POLY + '音までです（' + App.fmtPos(notes[j].t) + '）';
      }
    }
    return null;
  };

  // 曲の長さ・イントロ境界に収める
  App.clampNotes = function () {
    var total = App.totalTicks(), intro = App.introTicks();
    App.doc.parts.forEach(function (p) {
      p.notes = p.notes.filter(function (n) {
        if (n.t >= total || n.t < 0) return false;
        var limit = (intro > 0 && n.t < intro) ? intro : total;
        if (n.t + n.d > limit) n.d = limit - n.t;
        if (n.d < 1) return false;
        n.p = Math.max(0, Math.min(127, n.p));
        n.v = Math.max(1, Math.min(127, Math.round(n.v)));
        return true;
      });
    });
    App.sel.forEach(function (n) { if (App.curPart().notes.indexOf(n) < 0) App.sel.delete(n); });
  };

  // ---------------------------------------------------------------
  // 小節の挿入・削除（タイムライン全体）
  // ---------------------------------------------------------------
  function shiftInsert(atBar, count) {
    var t0 = atBar * TPB, dt = count * TPB;
    App.doc.parts.forEach(function (p) {
      p.notes.forEach(function (n) {
        if (n.t >= t0) n.t += dt;
        else if (n.t + n.d > t0) n.d = t0 - n.t;
      });
    });
    App.doc.sections.forEach(function (s) { if (s.bar >= atBar) s.bar += count; });
  }
  function shiftDelete(fromBar, count) {
    var t0 = fromBar * TPB, t1 = (fromBar + count) * TPB, dt = count * TPB;
    App.doc.parts.forEach(function (p) {
      p.notes = p.notes.filter(function (n) {
        if (n.t >= t0 && n.t < t1) return false;
        if (n.t < t0 && n.t + n.d > t0) n.d = t0 - n.t;
        if (n.t >= t1) n.t -= dt;
        return true;
      });
    });
    App.doc.sections = App.doc.sections.filter(function (s) { return s.bar < fromBar || s.bar >= fromBar + count; });
    App.doc.sections.forEach(function (s) { if (s.bar >= fromBar + count) s.bar -= count; });
  }
  App.notesInBars = function (fromBar, toBar) {
    var t0 = fromBar * TPB, t1 = toBar * TPB, n = 0;
    App.doc.parts.forEach(function (p) { p.notes.forEach(function (x) { if (x.t >= t0 && x.t < t1) n++; }); });
    return n;
  };

  App.insertBars = function (atBar, count) {
    return App.edit(function () {
      var ib = App.introBars();
      shiftInsert(atBar, count);
      if (ib > 0 && atBar < ib) App.doc.intro.bars += count;
      else App.doc.loopBars += count;
    });
  };
  App.deleteBars = function (fromBar, count) {
    var ib = App.introBars();
    var introPart = Math.max(0, Math.min(fromBar + count, ib) - fromBar);
    var loopPart = count - introPart;
    if (App.doc.loopBars - loopPart < 1) { App.msg('ループ部分を0小節にはできません', 'warn'); return false; }
    return App.edit(function () {
      shiftDelete(fromBar, count);
      if (introPart > 0) {
        App.doc.intro.bars -= introPart;
        if (App.doc.intro.bars <= 0) { App.doc.intro.enabled = false; App.doc.intro.bars = 4; }
      }
      App.doc.loopBars -= loopPart;
    });
  };
  App.setIntro = function (enabled) {
    var d = App.doc;
    if (enabled === d.intro.enabled) return true;
    if (enabled) {
      return App.edit(function () {
        shiftInsert(0, d.intro.bars);
        d.intro.enabled = true;
        if (!d.sections.some(function (s) { return s.bar === 0; })) d.sections.unshift({ bar: 0, name: 'イントロ' });
      });
    }
    var n = App.notesInBars(0, d.intro.bars);
    if (n > 0 && !confirm('イントロにある ' + n + ' 個の音符は削除されます。イントロを外しますか？')) return false;
    return App.edit(function () {
      var bars = d.intro.bars;
      shiftDelete(0, bars);
      d.intro.enabled = false;
      d.intro.bars = bars;
    });
  };
  App.setIntroBars = function (bars) {
    var d = App.doc;
    bars = Math.max(1, Math.min(64, Math.round(bars) || 1));
    if (!d.intro.enabled) { d.intro.bars = bars; App.changed({ structure: true }); return true; }
    var cur = d.intro.bars;
    if (bars === cur) return true;
    if (bars > cur) return App.edit(function () { shiftInsert(cur, bars - cur); d.intro.bars = bars; });
    var n = App.notesInBars(bars, cur);
    if (n > 0 && !confirm('イントロの後ろ ' + (cur - bars) + ' 小節にある ' + n + ' 個の音符は削除されます。よろしいですか？')) return false;
    return App.edit(function () { shiftDelete(bars, cur - bars); d.intro.bars = bars; });
  };
  App.setLoopBars = function (bars) {
    var d = App.doc;
    bars = Math.max(1, Math.min(1000, Math.round(bars) || 1));
    var cur = d.loopBars;
    if (bars === cur) return true;
    if (bars > cur) return App.edit(function () { d.loopBars = bars; });
    var ib = App.introBars();
    var n = App.notesInBars(ib + bars, ib + cur);
    if (n > 0 && !confirm('ループの後ろ ' + (cur - bars) + ' 小節にある ' + n + ' 個の音符は削除されます。よろしいですか？')) return false;
    return App.edit(function () {
      shiftDelete(ib + bars, cur - bars);
      d.loopBars = bars;
    });
  };

  // ---------------------------------------------------------------
  // コピー・貼り付け
  // ---------------------------------------------------------------
  App.copyNotes = function (cut) {
    if (!App.sel.size) return false;
    var notes = Array.from(App.sel);
    var t0 = Math.min.apply(null, notes.map(function (n) { return n.t; }));
    t0 = Math.floor(t0 / App.snap) * App.snap;
    App.clipboard = { type: 'notes', drum: App.isDrumPart(App.part), notes: notes.map(function (n) { return { t: n.t - t0, d: n.d, p: n.p, v: n.v }; }) };
    if (cut) {
      App.edit(function () {
        var p = App.curPart();
        p.notes = p.notes.filter(function (n) { return !App.sel.has(n); });
        App.sel.clear();
      }, {});
    }
    App.msg(notes.length + ' 個の音符を' + (cut ? '切り取りました' : 'コピーしました'));
    return true;
  };
  App.pasteNotes = function () {
    var cb = App.clipboard;
    if (!cb || cb.type !== 'notes') return false;
    if (cb.drum !== App.isDrumPart(App.part)) { App.msg('ドラムのパートとそれ以外のパートの間では音符を貼り付けられません', 'warn'); return true; }
    var at = Math.floor(App.cursor / App.snap) * App.snap;
    App.edit(function () {
      var p = App.curPart();
      var added = cb.notes.map(function (n) { return { t: n.t + at, d: n.d, p: n.p, v: n.v }; });
      p.notes = p.notes.concat(added);
      App.sel = new Set(added);
      App.resolveMono(App.part, App.sel);
    }, {});
    App.msg(cb.notes.length + ' 個の音符を貼り付けました');
    return true;
  };
  App.copyRange = function (allParts) {
    var r = App.range;
    if (!r) return;
    var t0 = r.start * TPB, t1 = r.end * TPB;
    var parts = [];
    App.doc.parts.forEach(function (p, i) {
      if (!allParts && i !== App.part) return;
      parts.push({
        index: i, drum: App.isDrumPart(i),
        notes: p.notes.filter(function (n) { return n.t >= t0 && n.t < t1; })
          .map(function (n) { return { t: n.t - t0, d: Math.min(n.d, t1 - n.t), p: n.p, v: n.v }; })
      });
    });
    App.clipboard = { type: 'range', bars: r.end - r.start, all: allParts, parts: parts };
    App.msg((r.end - r.start) + ' 小節を' + (allParts ? '全パート' : 'このパートだけ') + 'コピーしました。カーソルを置いた小節に「貼り付け」できます。');
  };
  App.pasteRange = function () {
    var cb = App.clipboard;
    if (!cb || cb.type !== 'range') { App.msg('小節範囲がコピーされていません（ルーラーで範囲を選んでコピーしてください）', 'warn'); return; }
    var atBar = Math.floor(App.cursor / TPB);
    var bars = cb.bars;
    if (atBar + bars > App.totalBars()) { App.msg('曲の最後を越えるので貼り付けられません。ループの小節数を増やすか、カーソルを前に置いてください。', 'warn'); return; }
    var t0 = atBar * TPB, t1 = (atBar + bars) * TPB;
    App.edit(function () {
      cb.parts.forEach(function (src) {
        var target = cb.all ? src.index : App.part;
        if (src.drum !== App.isDrumPart(target)) return;
        var p = App.doc.parts[target];
        p.notes = p.notes.filter(function (n) {
          if (n.t >= t0 && n.t < t1) return false;
          if (n.t < t0 && n.t + n.d > t0) n.d = t0 - n.t;
          return true;
        });
        src.notes.forEach(function (n) { p.notes.push({ t: n.t + t0, d: n.d, p: n.p, v: n.v }); });
        App.resolveMono(target);
      });
      App.sel.clear();
    });
    App.msg(bars + ' 小節を ' + (atBar + 1) + ' 小節目から貼り付けました');
  };
  App.clearRange = function () {
    var r = App.range;
    if (!r) return;
    var t0 = r.start * TPB, t1 = r.end * TPB;
    App.edit(function () {
      App.doc.parts.forEach(function (p) {
        p.notes = p.notes.filter(function (n) {
          if (n.t >= t0 && n.t < t1) return false;
          if (n.t < t0 && n.t + n.d > t0) n.d = t0 - n.t;
          return true;
        });
      });
      App.sel.clear();
    });
  };
  App.transposeRange = function (semi) {
    var r = App.range;
    if (!r || !semi) return;
    if (App.isDrumPart(App.part)) { App.msg('ドラムのパートは移調できません', 'warn'); return; }
    var t0 = r.start * TPB, t1 = r.end * TPB;
    App.edit(function () {
      App.curPart().notes.forEach(function (n) { if (n.t >= t0 && n.t < t1) n.p = Math.max(0, Math.min(127, n.p + semi)); });
    });
  };

  // ---------------------------------------------------------------
  // 再生
  // ---------------------------------------------------------------
  App.ensurePlayer = function () {
    if (!App.player) {
      App.player = new BGM.Player({ volume: 0.9 });
      App.player.onError = function (e) { App.msg('再生エラー: ' + e.message, 'error'); };
    }
    if (!App.player._send) return App.player.load(App.toScore());
    return Promise.resolve();
  };
  App.play = function (mode) {
    return App.ensurePlayer().then(function () {
      App.player.update(App.toScore());
      var opts = { startTick: App.cursor };
      var total = App.totalTicks();
      if (mode === 'seam') {
        opts.startTick = Math.max(App.introTicks(), total - 2 * TPB);
      } else if (document.getElementById('chkRangeLoop').checked && App.range) {
        opts.loopStart = App.range.start * TPB;
        opts.loopEnd = App.range.end * TPB;
        if (App.cursor < opts.loopStart || App.cursor >= opts.loopEnd) opts.startTick = opts.loopStart;
      }
      if (opts.startTick >= total) opts.startTick = 0;
      return App.player.play(opts).then(function () {
        App.playing = true; App.playMode = mode || 'normal';
        App.emit('transport');
      });
    }).catch(function (e) { App.msg('再生を開始できませんでした: ' + e.message, 'error'); });
  };
  App.stop = function () {
    if (App.player) App.player.stop();
    App.playing = false;
    App.emit('transport');
  };
  App.togglePlay = function () { if (App.playing) App.stop(); else App.play(); };
  App.preview = function (pitch, vel, partIndex) {
    if (App.playing) return;
    var pi = partIndex == null ? App.part : partIndex;
    App.ensurePlayer().then(function () {
      App.syncPlayer();
      App.player.preview(pi, pitch, vel || 100, 0.3);
    });
  };

  // ---------------------------------------------------------------
  // ファイル
  // ---------------------------------------------------------------
  App.safeFileName = function (name) {
    return String(name || '無題').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'bgm';
  };
  // 保存先を選べるブラウザ（Chrome / Edge）では保存ダイアログを使う。
  // 使えない場合や失敗した場合は通常のダウンロードにする。
  // 戻り値: Promise<boolean>（キャンセルされたら false）
  App.saveBlob = function (blob, filename, description, ext) {
    if (window.showSaveFilePicker) {
      var accept = {}; accept[blob.type || 'application/octet-stream'] = [ext];
      return window.showSaveFilePicker({ suggestedName: filename, types: [{ description: description, accept: accept }] })
        .then(function (handle) {
          return handle.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); }).then(function () { return true; });
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return false;
          App.download(blob, filename);
          return true;
        });
    }
    App.download(blob, filename);
    return Promise.resolve(true);
  };
  App.download = function (data, filename, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };
})();
