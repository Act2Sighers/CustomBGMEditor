/*
 * ピアノロール（キャンバス描画とマウス操作）
 */
(function () {
  'use strict';
  var App = window.App, BGM = App.BGM, TPB = App.TPB, PPQ = BGM.PPQ;
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

  var PR = window.PianoRoll = {
    ppt: 1,          // 1tick あたりのピクセル
    rowH: 12,
    drumRowH: 22,
    minP: 24, maxP: 108,
    dirty: true,
    lastVel: 100
  };

  var el = {}, ctx = {}, dpr = 1;
  var drag = null;       // 進行中のドラッグ操作
  var band = null;       // 範囲選択の矩形
  var lastDrumMode = null;

  PR.isDrum = function () { return App.isDrumPart(App.part); };
  PR.rowHeight = function () { return PR.isDrum() ? PR.drumRowH : PR.rowH; };
  PR.rows = function () {
    if (PR.isDrum()) return App.DRUM_ROWS;
    var r = [];
    for (var p = PR.maxP; p >= PR.minP; p--) r.push(p);
    return r;
  };
  PR.rowOf = function (pitch) {
    if (PR.isDrum()) return App.DRUM_ROWS.indexOf(pitch);
    if (pitch > PR.maxP || pitch < PR.minP) return -1;
    return PR.maxP - pitch;
  };
  PR.pitchName = function (p) {
    if (PR.isDrum()) return BGM.DRUM_MAP[p] ? BGM.DRUM_MAP[p].label : String(p);
    return NAMES[p % 12] + (Math.floor(p / 12) - 1);
  };

  function setupCanvas(c) {
    var r = c.getBoundingClientRect();
    var w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    var cx = c.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cx: cx, w: w, h: h };
  }

  PR.updateSize = function () {
    var w = App.totalTicks() * PR.ppt + 240;
    var h = PR.rows().length * PR.rowHeight();
    el.spacer.style.width = Math.ceil(w) + 'px';
    el.spacer.style.height = Math.ceil(h) + 'px';
    var drum = PR.isDrum();
    if (drum !== lastDrumMode) {
      lastDrumMode = drum;
      if (drum) el.scroll.scrollTop = 0;
      else el.scroll.scrollTop = Math.max(0, (PR.maxP - 79) * PR.rowH);
    }
    PR.dirty = true;
  };

  PR.resize = function () {
    dpr = window.devicePixelRatio || 1;
    var sw = el.scroll.clientWidth, sh = el.scroll.clientHeight;
    el.grid.style.width = sw + 'px';
    el.grid.style.height = sh + 'px';
    PR.dirty = true;
  };

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------
  function visibleTicks(w) {
    var sx = el.scroll.scrollLeft;
    return [sx / PR.ppt, (sx + w) / PR.ppt];
  }
  function gridStep() {
    var s = App.snap;
    while (s * PR.ppt < 5) s *= 2;
    return s;
  }

  function drawGrid() {
    var g = setupCanvas(el.grid), c = g.cx, W = g.w, H = g.h;
    var sx = el.scroll.scrollLeft, sy = el.scroll.scrollTop, ppt = PR.ppt;
    var rh = PR.rowHeight(), rows = PR.rows(), drum = PR.isDrum();
    var total = App.totalTicks(), intro = App.introTicks();
    c.fillStyle = '#14161a'; c.fillRect(0, 0, W, H);
    var r0 = Math.max(0, Math.floor(sy / rh)), r1 = Math.min(rows.length - 1, Math.ceil((sy + H) / rh));
    for (var r = r0; r <= r1; r++) {
      var y = r * rh - sy, p = rows[r];
      c.fillStyle = drum ? (r % 2 ? '#191c22' : '#1c1f26') : (BLACK[p % 12] ? '#16181d' : '#1d2027');
      c.fillRect(0, y, W, rh);
      if (!drum && p % 12 === 0) { c.fillStyle = '#2b303a'; c.fillRect(0, y + rh - 1, W, 1); }
      else if (drum) { c.fillStyle = '#23272f'; c.fillRect(0, y + rh - 1, W, 1); }
    }
    var xTotal = total * ppt - sx;
    if (intro > 0) { c.fillStyle = 'rgba(255, 190, 80, 0.06)'; c.fillRect(-sx, 0, intro * ppt, H); }
    if (xTotal < W) { c.fillStyle = '#0d0e11'; c.fillRect(xTotal, 0, W - xTotal, H); }
    if (App.range) {
      c.fillStyle = 'rgba(91, 157, 255, 0.10)';
      c.fillRect(App.range.start * TPB * ppt - sx, 0, (App.range.end - App.range.start) * TPB * ppt, H);
    }
    // 縦線
    var vt = visibleTicks(W), step = gridStep();
    var tStart = Math.floor(vt[0] / step) * step;
    for (var t = tStart; t <= Math.min(vt[1], total); t += step) {
      var x = Math.round(t * ppt - sx) + 0.5;
      if (t % TPB === 0) c.fillStyle = '#4a5160';
      else if (t % PPQ === 0) c.fillStyle = '#2f3540';
      else c.fillStyle = '#22262e';
      c.fillRect(x - 0.5, 0, 1, H);
    }
    if (TPB * ppt < 5) {
      for (var tb = Math.floor(vt[0] / (TPB * 4)) * TPB * 4; tb <= Math.min(vt[1], total); tb += TPB * 4) {
        c.fillStyle = '#4a5160'; c.fillRect(Math.round(tb * ppt - sx), 0, 1, H);
      }
    }
    if (intro > 0) { c.fillStyle = '#e0a040'; c.fillRect(Math.round(intro * ppt - sx), 0, 2, H); }
    c.fillStyle = '#d05050'; c.fillRect(Math.round(xTotal), 0, 2, H);

    // 他パートの音符
    var ghost = document.getElementById('chkGhost').checked;
    if (ghost && !drum) {
      App.doc.parts.forEach(function (part, i) {
        if (i === App.part || App.isDrumPart(i)) return;
        c.fillStyle = App.COLORS[i]; c.globalAlpha = 0.2;
        drawNotes(c, part.notes, null, W, H, sx, sy, ppt, rh, true);
        c.globalAlpha = 1;
      });
    }
    // 現在のパート
    var col = App.COLORS[App.part];
    drawNotes(c, App.curPart().notes, col, W, H, sx, sy, ppt, rh, false);

    // カーソル
    var cx = Math.round(App.cursor * ppt - sx) + 0.5;
    c.strokeStyle = '#5b9dff'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H); c.stroke(); c.setLineDash([]);
    // 再生位置
    if (App.playing && App.player) {
      var px = Math.round(App.player.currentTick() * ppt - sx) + 0.5;
      c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.stroke(); c.lineWidth = 1;
    }
    if (band) {
      c.fillStyle = 'rgba(91,157,255,0.15)'; c.strokeStyle = '#5b9dff';
      var bx = Math.min(band.x0, band.x1), by = Math.min(band.y0, band.y1);
      c.fillRect(bx - sx, by - sy, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
      c.strokeRect(bx - sx + 0.5, by - sy + 0.5, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
    }
  }

  function overlapSet(notes) {
    // ドラッグ中に重なっている音（1パート1音の違反）を調べる
    var bad = new Set();
    if (PR.isDrum()) return bad;
    var s = notes.slice().sort(function (a, b) { return a.t - b.t; });
    var maxEnd = -1, maxN = null;
    for (var i = 0; i < s.length; i++) {
      if (maxN && s[i].t < maxEnd) { bad.add(s[i]); bad.add(maxN); }
      if (s[i].t + s[i].d > maxEnd) { maxEnd = s[i].t + s[i].d; maxN = s[i]; }
    }
    return bad;
  }

  function drawNotes(c, notes, color, W, H, sx, sy, ppt, rh, ghost) {
    var t0 = sx / ppt, t1 = (sx + W) / ppt;
    var bad = (!ghost && drag) ? overlapSet(notes) : null;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.t > t1 || n.t + n.d < t0) continue;
      var row = PR.rowOf(n.p);
      if (row < 0) continue;
      var x = n.t * ppt - sx, y = row * rh - sy;
      if (y > H || y + rh < 0) continue;
      var w = Math.max(2, n.d * ppt - 1);
      if (ghost) { c.fillRect(x, y + 1, w, rh - 2); continue; }
      var sel = App.sel.has(n);
      c.globalAlpha = 0.55 + 0.45 * (n.v / 127);
      c.fillStyle = color;
      c.fillRect(x, y + 1, w, rh - 2);
      c.globalAlpha = 1;
      if (sel) { c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; c.strokeRect(x + 0.75, y + 1.75, w - 1.5, rh - 3.5); c.lineWidth = 1; }
      else { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + w - 2, y + 1, 2, rh - 2); }
      if (bad && bad.has(n)) { c.strokeStyle = '#ff4040'; c.strokeRect(x + 0.5, y + 0.5, w - 1, rh - 1); }
      if (PR.isDrum() && w > 30) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.font = '10px sans-serif'; c.fillText(String(n.v), x + 3, y + rh - 6); }
    }
  }

  function drawKeys() {
    var g = setupCanvas(el.keys), c = g.cx, W = g.w, H = g.h;
    var sy = el.scroll.scrollTop, rh = PR.rowHeight(), rows = PR.rows(), drum = PR.isDrum();
    c.fillStyle = '#1d2027'; c.fillRect(0, 0, W, H);
    var r0 = Math.max(0, Math.floor(sy / rh)), r1 = Math.min(rows.length - 1, Math.ceil((sy + H) / rh));
    c.font = (drum ? '11px' : '9px') + ' sans-serif'; c.textBaseline = 'middle';
    for (var r = r0; r <= r1; r++) {
      var y = r * rh - sy, p = rows[r];
      if (drum) {
        c.fillStyle = r % 2 ? '#262a33' : '#2b303a'; c.fillRect(0, y, W, rh - 1);
        c.fillStyle = '#d6d9e0'; c.fillText(PR.pitchName(p), 5, y + rh / 2);
      } else {
        var black = BLACK[p % 12];
        c.fillStyle = black ? '#20232a' : '#e6e8ec';
        c.fillRect(0, y, black ? W * 0.62 : W, rh - 1);
        if (black) { c.fillStyle = '#d8dbe0'; c.fillRect(W * 0.62, y, W * 0.38, rh - 1); }
        if (p % 12 === 0) { c.fillStyle = '#4a5160'; c.fillText(PR.pitchName(p), W - 26, y + rh / 2); }
      }
    }
  }

  function drawRuler() {
    var g = setupCanvas(el.ruler), c = g.cx, W = g.w, H = g.h;
    var sx = el.scroll.scrollLeft, ppt = PR.ppt;
    var total = App.totalTicks(), intro = App.introTicks(), totalBars = App.totalBars();
    c.fillStyle = '#1d2027'; c.fillRect(0, 0, W, H);
    if (intro > 0) { c.fillStyle = 'rgba(255, 190, 80, 0.16)'; c.fillRect(-sx, 0, intro * ppt, H); }
    if (App.range) {
      c.fillStyle = 'rgba(91, 157, 255, 0.35)';
      c.fillRect(App.range.start * TPB * ppt - sx, 0, (App.range.end - App.range.start) * TPB * ppt, H);
    }
    var barPx = TPB * ppt;
    var every = 1;
    while (barPx * every < 34) every *= 2;
    c.font = '11px sans-serif'; c.textBaseline = 'top';
    var b0 = Math.max(0, Math.floor(sx / barPx)), b1 = Math.min(totalBars, Math.ceil((sx + W) / barPx));
    for (var b = b0; b <= b1; b++) {
      var x = Math.round(b * barPx - sx) + 0.5;
      if (b % every === 0) {
        c.fillStyle = '#4a5160'; c.fillRect(x - 0.5, 14, 1, H - 14);
        if (b < totalBars) { c.fillStyle = '#a3a9b6'; c.fillText(String(b + 1), x + 3, 16); }
      } else if (barPx > 8) { c.fillStyle = '#353b46'; c.fillRect(x - 0.5, 22, 1, H - 22); }
    }
    // セクション
    c.textBaseline = 'top';
    App.doc.sections.forEach(function (s) {
      var x = s.bar * barPx - sx;
      if (x < -200 || x > W) return;
      c.fillStyle = '#7ee08a'; c.fillRect(x, 0, 2, 14);
      c.font = 'bold 11px sans-serif';
      c.fillText(s.name, x + 4, 1);
    });
    if (intro > 0) { c.fillStyle = '#e0a040'; c.fillRect(Math.round(intro * ppt - sx), 0, 2, H); }
    c.fillStyle = '#d05050'; c.fillRect(Math.round(total * ppt - sx), 0, 2, H);
    // カーソル
    var cx = App.cursor * ppt - sx;
    c.fillStyle = '#5b9dff';
    c.beginPath(); c.moveTo(cx - 5, H - 8); c.lineTo(cx + 5, H - 8); c.lineTo(cx, H); c.closePath(); c.fill();
    if (App.playing && App.player) {
      var px = App.player.currentTick() * ppt - sx;
      c.fillStyle = '#ffffff'; c.fillRect(Math.round(px), 0, 2, H);
    }
  }

  function drawVel() {
    var g = setupCanvas(el.vel), c = g.cx, W = g.w, H = g.h;
    var sx = el.scroll.scrollLeft, ppt = PR.ppt;
    c.fillStyle = '#16181d'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#23272f'; c.fillRect(0, Math.round(H * (1 - 100 / 127)), W, 1);
    var t0 = sx / ppt, t1 = (sx + W) / ppt, col = App.COLORS[App.part];
    var notes = App.curPart().notes;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.t > t1 || n.t + n.d < t0) continue;
      var x = n.t * ppt - sx, h = (H - 6) * n.v / 127;
      var w = Math.max(3, Math.min(8, n.d * ppt - 1));
      c.fillStyle = App.sel.has(n) ? '#ffffff' : col;
      c.globalAlpha = App.sel.has(n) ? 0.9 : 0.75;
      c.fillRect(x, H - h, w, h);
      c.globalAlpha = 1;
    }
  }

  PR.draw = function () {
    drawGrid(); drawKeys(); drawRuler(); drawVel();
    PR.dirty = false;
  };

  function loop() {
    if (App.playing && App.player) {
      // 追従
      if (document.getElementById('chkFollow').checked && !drag) {
        var px = App.player.currentTick() * PR.ppt;
        var sl = el.scroll.scrollLeft, w = el.scroll.clientWidth;
        if (px < sl || px > sl + w - 40) el.scroll.scrollLeft = Math.max(0, px - 60);
      }
      App.emit('tick');
      PR.dirty = true;
    }
    if (PR.dirty) PR.draw();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------
  // 座標
  // ---------------------------------------------------------------
  function gridPos(e) {
    var r = el.grid.getBoundingClientRect();
    var x = e.clientX - r.left + el.scroll.scrollLeft, y = e.clientY - r.top + el.scroll.scrollTop;
    var row = Math.floor(y / PR.rowHeight());
    var rows = PR.rows();
    return { x: x, y: y, tick: x / PR.ppt, row: row, pitch: row >= 0 && row < rows.length ? rows[row] : null, cx: e.clientX - r.left, cy: e.clientY - r.top };
  }
  function hitNote(pos) {
    var notes = App.curPart().notes, rh = PR.rowHeight();
    for (var i = notes.length - 1; i >= 0; i--) {
      var n = notes[i];
      if (PR.rowOf(n.p) !== pos.row) continue;
      var x0 = n.t * PR.ppt, x1 = x0 + Math.max(2, n.d * PR.ppt);
      if (pos.x >= x0 && pos.x <= x1) {
        var edge = (x1 - x0) > 10 && pos.x >= x1 - 6;
        return { note: n, edge: edge };
      }
    }
    return null;
  }
  function snapFloor(t) { return Math.floor(t / App.snap) * App.snap; }
  function snapRound(t) { return Math.round(t / App.snap) * App.snap; }

  // ---------------------------------------------------------------
  // グリッド操作
  // ---------------------------------------------------------------
  function onGridDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    el.grid.setPointerCapture(e.pointerId);
    var pos = gridPos(e);
    var hit = hitNote(pos);
    var total = App.totalTicks();
    if (e.button === 2) {
      drag = { mode: 'erase', before: App.beginEdit(), changed: false };
      eraseAt(pos);
      return;
    }
    if (hit) {
      if (e.shiftKey) { if (App.sel.has(hit.note)) App.sel.delete(hit.note); else App.sel.add(hit.note); }
      else if (!App.sel.has(hit.note)) { App.sel.clear(); App.sel.add(hit.note); }
      if (!App.sel.has(hit.note)) { PR.dirty = true; App.emit('selection'); return; }
      var orig = new Map();
      App.sel.forEach(function (n) { orig.set(n, { t: n.t, d: n.d, p: n.p }); });
      drag = { mode: hit.edge ? 'resize' : 'move', before: App.beginEdit(), anchor: pos, hit: hit.note, orig: orig, lastPitch: hit.note.p };
      PR.lastVel = hit.note.v;
      App.preview(hit.note.p, hit.note.v);
    } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (!e.ctrlKey && !e.metaKey) App.sel.clear();
      band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, base: new Set(App.sel) };
      drag = { mode: 'band' };
    } else {
      if (pos.pitch == null) return;
      var t = snapFloor(pos.tick);
      if (t >= total) return;
      var before = App.beginEdit();
      var note = { t: t, d: Math.min(App.noteLen(), total - t), p: pos.pitch, v: PR.lastVel };
      App.curPart().notes.push(note);
      App.sel.clear(); App.sel.add(note);
      drag = { mode: 'create', before: before, anchor: pos, hit: note, base: t };
      App.preview(note.p, note.v);
    }
    PR.dirty = true;
    App.emit('selection');
  }

  function eraseAt(pos) {
    var hit = hitNote(pos);
    if (!hit) return;
    var p = App.curPart();
    p.notes.splice(p.notes.indexOf(hit.note), 1);
    App.sel.delete(hit.note);
    drag.changed = true;
    PR.dirty = true;
  }

  function onGridMove(e) {
    var pos = gridPos(e);
    var name = pos.pitch != null ? PR.pitchName(pos.pitch) : '';
    App.hint(App.fmtPos(Math.max(0, pos.tick)) + (name ? '  ' + name : ''));
    if (!drag) {
      var hit = hitNote(pos);
      el.grid.style.cursor = hit ? (hit.edge ? 'ew-resize' : 'move') : 'crosshair';
      return;
    }
    var total = App.totalTicks();
    if (drag.mode === 'erase') { eraseAt(pos); return; }
    if (drag.mode === 'band') {
      band.x1 = pos.x; band.y1 = pos.y;
      var tA = Math.min(band.x0, band.x1) / PR.ppt, tB = Math.max(band.x0, band.x1) / PR.ppt;
      var rA = Math.floor(Math.min(band.y0, band.y1) / PR.rowHeight()), rB = Math.floor(Math.max(band.y0, band.y1) / PR.rowHeight());
      App.sel = new Set(band.base);
      App.curPart().notes.forEach(function (n) {
        var r = PR.rowOf(n.p);
        if (r >= rA && r <= rB && n.t < tB && n.t + n.d > tA) App.sel.add(n);
      });
      PR.dirty = true;
      return;
    }
    if (drag.mode === 'move') {
      var dt = snapRound(pos.tick - drag.anchor.tick);
      var dRow = pos.row - drag.anchor.row;
      var minT = Infinity, maxEnd = 0;
      drag.orig.forEach(function (o) { minT = Math.min(minT, o.t); maxEnd = Math.max(maxEnd, o.t + o.d); });
      if (minT + dt < 0) dt = -minT;
      if (maxEnd + dt > total) dt = Math.max(-minT, total - maxEnd);
      var rows = PR.rows();
      drag.orig.forEach(function (o, n) {
        n.t = o.t + dt;
        var r = PR.rowOf(o.p);
        var nr = Math.max(0, Math.min(rows.length - 1, r + dRow));
        n.p = rows[nr];
      });
      if (drag.hit.p !== drag.lastPitch) { drag.lastPitch = drag.hit.p; App.preview(drag.hit.p, drag.hit.v); }
    } else if (drag.mode === 'resize') {
      var o = drag.orig.get(drag.hit);
      var end = snapRound(pos.tick);
      var delta = end - (o.t + o.d);
      drag.orig.forEach(function (oo, n) {
        var minLen = Math.min(App.snap, oo.d);
        n.d = Math.max(minLen, oo.d + delta);
        if (n.t + n.d > total) n.d = total - n.t;
      });
    } else if (drag.mode === 'create') {
      if (Math.abs(pos.x - drag.anchor.x) > 4) {
        var e2 = Math.max(drag.base + App.snap, Math.ceil(pos.tick / App.snap) * App.snap);
        drag.hit.d = Math.min(e2, total) - drag.base;
      }
      var np = pos.pitch;
      if (np != null && np !== drag.hit.p && Math.abs(pos.x - drag.anchor.x) <= 4) { drag.hit.p = np; App.preview(np, drag.hit.v); }
    }
    PR.dirty = true;
  }

  function onGridUp() {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.mode === 'band') { band = null; PR.dirty = true; App.emit('selection'); return; }
    if (d.mode === 'erase') { if (d.changed) App.endEdit(d.before, {}); return; }
    App.resolveMono(App.part, App.sel);
    App.endEdit(d.before, {});
    PR.dirty = true;
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var r = el.grid.getBoundingClientRect();
      var mx = e.clientX - r.left;
      var tickAt = (mx + el.scroll.scrollLeft) / PR.ppt;
      var f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      PR.setZoom(PR.ppt * f, tickAt, mx);
      return;
    }
    if (e.shiftKey) el.scroll.scrollLeft += (e.deltaY || e.deltaX);
    else { el.scroll.scrollTop += e.deltaY; el.scroll.scrollLeft += e.deltaX; }
  }

  PR.setZoom = function (ppt, tickAt, mx) {
    ppt = Math.max(0.15, Math.min(4, ppt));
    if (tickAt == null) { mx = el.scroll.clientWidth / 2; tickAt = (el.scroll.scrollLeft + mx) / PR.ppt; }
    PR.ppt = ppt;
    PR.updateSize();
    el.scroll.scrollLeft = Math.max(0, tickAt * ppt - mx);
    document.getElementById('zoomInput').value = String(ppt);
  };

  // ---------------------------------------------------------------
  // 鍵盤・ルーラー・強さ
  // ---------------------------------------------------------------
  function keyPitch(e) {
    var r = el.keys.getBoundingClientRect();
    var row = Math.floor((e.clientY - r.top + el.scroll.scrollTop) / PR.rowHeight());
    var rows = PR.rows();
    return row >= 0 && row < rows.length ? rows[row] : null;
  }
  var keyDown = false, lastKey = null;
  function onKeysDown(e) { keyDown = true; el.keys.setPointerCapture(e.pointerId); var p = keyPitch(e); if (p != null) { lastKey = p; App.preview(p, 100); } }
  function onKeysMove(e) { if (!keyDown) return; var p = keyPitch(e); if (p != null && p !== lastKey) { lastKey = p; App.preview(p, 100); } }
  function onKeysUp() { keyDown = false; lastKey = null; }

  var rulerDrag = null;
  function rulerTick(e) {
    var r = el.ruler.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left + el.scroll.scrollLeft) / PR.ppt);
  }
  function onRulerDown(e) {
    if (e.button !== 0) return;
    el.ruler.setPointerCapture(e.pointerId);
    rulerDrag = { x0: e.clientX, t0: rulerTick(e), ranged: false };
  }
  function onRulerMove(e) {
    if (!rulerDrag) return;
    if (Math.abs(e.clientX - rulerDrag.x0) > 4) rulerDrag.ranged = true;
    if (rulerDrag.ranged) {
      var t = rulerTick(e), total = App.totalBars();
      var a = Math.floor(Math.min(t, rulerDrag.t0) / TPB), b = Math.ceil(Math.max(t, rulerDrag.t0) / TPB);
      a = Math.max(0, Math.min(total - 1, a)); b = Math.max(a + 1, Math.min(total, b));
      App.range = { start: a, end: b };
      App.emit('range');
      PR.dirty = true;
    }
  }
  function onRulerUp(e) {
    if (!rulerDrag) return;
    var rd = rulerDrag; rulerDrag = null;
    if (!rd.ranged) {
      var t = Math.min(App.totalTicks() - 1, Math.floor(rulerTick(e) / App.snap) * App.snap);
      App.cursor = Math.max(0, t);
      App.emit('cursor');
      PR.dirty = true;
      if (App.playing) App.play();
    } else {
      App.cursor = App.range.start * TPB;
      App.emit('cursor');
    }
  }
  function onRulerDbl(e) {
    var bar = Math.floor(rulerTick(e) / TPB);
    if (bar >= App.totalBars()) return;
    var exists = App.doc.sections.filter(function (s) { return s.bar === bar; })[0];
    var name = prompt((bar + 1) + ' 小節目のセクション名', exists ? exists.name : '');
    if (name == null) return;
    App.edit(function () {
      App.doc.sections = App.doc.sections.filter(function (s) { return s.bar !== bar; });
      if (name.trim()) App.doc.sections.push({ bar: bar, name: name.trim() });
      App.doc.sections.sort(function (a, b) { return a.bar - b.bar; });
    });
  }

  var velDrag = null;
  function velAt(e) {
    var r = el.vel.getBoundingClientRect();
    var x = e.clientX - r.left + el.scroll.scrollLeft, y = e.clientY - r.top;
    var v = Math.round(Math.max(1, Math.min(127, (1 - (y - 3) / (r.height - 6)) * 127)));
    var tick = x / PR.ppt, tol = 5 / PR.ppt;
    var notes = App.curPart().notes.filter(function (n) {
      var w = Math.max(3, Math.min(8, n.d * PR.ppt - 1)) / PR.ppt;
      return tick >= n.t - tol && tick <= n.t + w + tol;
    });
    return { v: v, notes: notes };
  }
  function onVelDown(e) {
    el.vel.setPointerCapture(e.pointerId);
    velDrag = { before: App.beginEdit() };
    onVelMove(e);
  }
  function onVelMove(e) {
    if (!velDrag) return;
    var a = velAt(e);
    var targets = a.notes;
    if (targets.some(function (n) { return App.sel.has(n); })) targets = Array.from(App.sel);
    targets.forEach(function (n) { n.v = a.v; });
    if (targets.length) { PR.lastVel = a.v; App.hint('強さ ' + a.v); }
    PR.dirty = true;
  }
  function onVelUp() { if (!velDrag) return; var b = velDrag.before; velDrag = null; App.endEdit(b, {}); }

  PR.scrollToTick = function (tick) {
    var w = el.scroll.clientWidth;
    var x = tick * PR.ppt;
    if (x < el.scroll.scrollLeft || x > el.scroll.scrollLeft + w - 40) el.scroll.scrollLeft = Math.max(0, x - 60);
  };
  PR.isDragging = function () { return !!drag; };

  PR.init = function () {
    el.scroll = document.getElementById('gridScroll');
    el.spacer = document.getElementById('gridSpacer');
    el.grid = document.getElementById('gridCanvas');
    el.ruler = document.getElementById('rulerCanvas');
    el.keys = document.getElementById('keysCanvas');
    el.vel = document.getElementById('velCanvas');
    el.scroll.addEventListener('scroll', function () { PR.dirty = true; });
    el.grid.addEventListener('pointerdown', onGridDown);
    el.grid.addEventListener('pointermove', onGridMove);
    el.grid.addEventListener('pointerup', onGridUp);
    el.grid.addEventListener('pointercancel', onGridUp);
    el.grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.grid.addEventListener('wheel', onWheel, { passive: false });
    el.grid.addEventListener('pointerleave', function () { App.hint(''); });
    el.keys.addEventListener('pointerdown', onKeysDown);
    el.keys.addEventListener('pointermove', onKeysMove);
    el.keys.addEventListener('pointerup', onKeysUp);
    el.keys.addEventListener('wheel', function (e) { e.preventDefault(); el.scroll.scrollTop += e.deltaY; }, { passive: false });
    el.ruler.addEventListener('pointerdown', onRulerDown);
    el.ruler.addEventListener('pointermove', onRulerMove);
    el.ruler.addEventListener('pointerup', onRulerUp);
    el.ruler.addEventListener('dblclick', onRulerDbl);
    el.ruler.addEventListener('wheel', function (e) { e.preventDefault(); el.scroll.scrollLeft += (e.deltaY || e.deltaX); }, { passive: false });
    el.vel.addEventListener('pointerdown', onVelDown);
    el.vel.addEventListener('pointermove', onVelMove);
    el.vel.addEventListener('pointerup', onVelUp);
    el.vel.addEventListener('wheel', function (e) { e.preventDefault(); el.scroll.scrollLeft += (e.deltaY || e.deltaX); }, { passive: false });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(PR.resize).observe(document.getElementById('gridHost'));
    window.addEventListener('resize', PR.resize);
    App.on('change', function () { PR.updateSize(); });
    App.on('selection', function () { PR.dirty = true; });
    App.on('part', function () { PR.updateSize(); });
    App.on('range', function () { PR.dirty = true; });
    App.on('cursor', function () { PR.dirty = true; });
    App.on('transport', function () { PR.dirty = true; });
    PR.resize();
    PR.updateSize();
    requestAnimationFrame(loop);
  };
})();
