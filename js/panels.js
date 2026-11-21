/*
 * パート一覧（左）と、音色・曲・セクションのパネル（右）
 */
(function () {
  'use strict';
  var App = window.App, BGM = App.BGM, TPB = App.TPB;
  var Panels = window.Panels = {};

  var CATEGORY_LABEL = { lead: '汎用・メロディ向き', chord: '和音向き', bass: 'ベース向き', drum: 'ドラム' };

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  Panels.h = h;

  Panels.instrumentSelect = function (value, onChange) {
    var sel = h('select');
    ['lead', 'chord', 'bass', 'drum'].forEach(function (cat) {
      var g = h('optgroup', { label: CATEGORY_LABEL[cat] });
      Object.keys(BGM.PRESETS).forEach(function (id) {
        var p = BGM.PRESETS[id];
        if (p.category !== cat) return;
        g.appendChild(h('option', { value: id, text: p.label }));
      });
      sel.appendChild(g);
    });
    sel.value = value;
    if (onChange) sel.addEventListener('change', function () { onChange(sel.value, sel); });
    return sel;
  };

  // 音色の変更（ドラム⇔通常の切り替え時の確認を含む）
  Panels.changeInstrument = function (i, id) {
    var part = App.doc.parts[i];
    var toDrum = BGM.isDrumInstrument(id), wasDrum = BGM.isDrumInstrument(part.instrument);
    if (toDrum && !wasDrum) {
      var other = App.doc.parts.findIndex(function (p, j) { return j !== i && BGM.isDrumInstrument(p.instrument); });
      if (other >= 0) { App.msg('ドラム音源のパートは1つまでです（パート' + (other + 1) + 'がドラムです）', 'warn'); return false; }
    }
    if (toDrum !== wasDrum && part.notes.length) {
      if (!confirm('ドラムと通常の音色を切り替えると音の意味が変わるため、このパートの音符（' + part.notes.length + '個）を消します。よろしいですか？')) return false;
    }
    return App.edit(function () {
      if (toDrum !== wasDrum) part.notes = [];
      part.instrument = id;
      part.params = {};
      App.sel.clear();
    });
  };

  // ---------------------------------------------------------------
  // パート一覧
  // ---------------------------------------------------------------
  var trackEls = [];
  function buildTracks() {
    var host = document.getElementById('tracks');
    host.innerHTML = '';
    trackEls = [];
    for (var i = 0; i < BGM.NUM_PARTS; i++) (function (i) {
      var name = h('input', { type: 'text', class: 'name', title: 'パート名' });
      name.addEventListener('change', function () { App.edit(function () { App.doc.parts[i].name = name.value; }, { param: true }); });
      name.addEventListener('focus', function () { selectPart(i); });
      var m = h('button', { class: 'ms m', title: 'ミュート', text: 'M' });
      var s = h('button', { class: 'ms s', title: 'ソロ', text: 'S' });
      m.addEventListener('click', function (e) { e.stopPropagation(); App.edit(function () { App.doc.parts[i].mute = !App.doc.parts[i].mute; }, { param: true }); });
      s.addEventListener('click', function (e) { e.stopPropagation(); App.edit(function () { App.doc.parts[i].solo = !App.doc.parts[i].solo; }, { param: true }); });
      var inst = Panels.instrumentSelect(App.doc.parts[i].instrument, function (v, selEl) {
        if (!Panels.changeInstrument(i, v)) selEl.value = App.doc.parts[i].instrument;
      });
      inst.addEventListener('focus', function () { selectPart(i); });
      var vol = h('input', { type: 'range', min: 0, max: 1.2, step: 0.01, title: '音量' });
      var pan = h('input', { type: 'range', min: -1, max: 1, step: 0.05, title: '定位（左右）' });
      liveRange(vol, function (v) { App.doc.parts[i].volume = v; });
      liveRange(pan, function (v) { App.doc.parts[i].pan = v; });
      pan.addEventListener('dblclick', function () { var b = App.beginEdit(); App.doc.parts[i].pan = 0; App.endEdit(b, { param: true }); });
      var count = h('span', { class: 'small' });
      var badge = h('span', { class: 'badge' });
      var row = h('div', { class: 'track' }, [
        h('div', { class: 'r1' }, [h('span', { class: 'num', text: String(i + 1) }), name, m, s]),
        h('div', { class: 'r2' }, [inst]),
        h('div', { class: 'r2' }, [h('span', { class: 'small', text: '音量' }), vol, h('span', { class: 'small', text: '定位' }), pan]),
        h('div', { class: 'r2' }, [count, badge])
      ]);
      row.style.borderLeftColor = App.COLORS[i];
      row.querySelector('.num').style.color = App.COLORS[i];
      row.addEventListener('pointerdown', function () { selectPart(i); });
      host.appendChild(row);
      trackEls.push({ row: row, name: name, m: m, s: s, inst: inst, vol: vol, pan: pan, count: count, badge: badge });
    })(i);
  }
  function selectPart(i) {
    if (App.part === i) return;
    App.part = i;
    App.sel.clear();
    App.emit('part');
  }
  Panels.selectPart = selectPart;

  // スライダー：ドラッグ中は即時反映、離したら履歴に1回だけ積む
  function liveRange(input, apply, opts) {
    var before = null;
    input.addEventListener('input', function () {
      if (before === null) before = App.beginEdit();
      apply(Number(input.value));
      App.syncPlayer();
      if (opts && opts.onInput) opts.onInput();
    });
    input.addEventListener('change', function () {
      if (before === null) return;
      var b = before; before = null;
      App.endEdit(b, { param: true });
    });
  }
  Panels.liveRange = liveRange;

  function refreshTracks() {
    App.doc.parts.forEach(function (p, i) {
      var t = trackEls[i];
      if (document.activeElement !== t.name) t.name.value = p.name;
      t.inst.value = p.instrument;
      t.m.classList.toggle('on', p.mute);
      t.s.classList.toggle('on', p.solo);
      t.vol.value = p.volume; t.pan.value = p.pan;
      t.count.textContent = p.notes.length + ' 音';
      t.badge.textContent = BGM.isDrumInstrument(p.instrument) ? 'ドラム（同時3音まで）' : '同時1音';
      t.row.classList.toggle('selected', i === App.part);
    });
  }

  // ---------------------------------------------------------------
  // 音色パネル
  // ---------------------------------------------------------------
  var OSC_OPTIONS = [['pulse', '矩形波'], ['saw', 'ノコギリ波'], ['tri', '三角波'], ['sine', 'サイン波'], ['fm', 'FM'], ['supersaw', 'スーパーソウ（ノコギリ波を重ねる）'], ['noise', 'ノイズ']];
  function isOsc() { var a = arguments; return function (p) { return Array.prototype.indexOf.call(a, p.osc) >= 0; }; }
  function fmtSec(v) { return v < 0.1 ? Math.round(v * 1000) + ' ms' : (Math.round(v * 100) / 100) + ' 秒'; }
  var SYNTH_PARAMS = [
    { head: '発音' },
    { k: 'osc', label: '波形', type: 'select', options: OSC_OPTIONS },
    { k: 'duty', label: 'デューティ比', min: 0.05, max: 0.95, step: 0.005, show: isOsc('pulse'), fmt: function (v) { return (Math.round(v * 1000) / 10) + '%'; } },
    { k: 'pwmDepth', label: 'PWMの深さ', min: 0, max: 0.4, step: 0.01, show: isOsc('pulse') },
    { k: 'pwmRate', label: 'PWMの速さ', min: 0.1, max: 10, step: 0.1, show: isOsc('pulse'), fmt: function (v) { return v + ' Hz'; } },
    { k: 'unison', label: '重ねる数', min: 1, max: 7, step: 1, show: isOsc('supersaw') },
    { k: 'spread', label: '広がり', min: 0, max: 50, step: 1, show: isOsc('supersaw'), fmt: function (v) { return v + ' cent'; } },
    { k: 'fmRatio', label: 'モジュレータ比', min: 0.5, max: 12, step: 0.5, show: isOsc('fm') },
    { k: 'fmIndex', label: 'FMの深さ', min: 0, max: 12, step: 0.1, show: isOsc('fm') },
    { k: 'fmDecay', label: 'FMの減衰', min: 0.01, max: 3, log: true, show: isOsc('fm'), fmt: fmtSec },
    { k: 'fmSustain', label: 'FMの残り', min: 0, max: 1, step: 0.01, show: isOsc('fm') },
    { k: 'gain', label: '音量補正', min: 0, max: 1, step: 0.01 },
    { k: 'transpose', label: '移調', min: -24, max: 24, step: 1, fmt: function (v) { return (v > 0 ? '+' : '') + v + ' 半音'; } },
    { k: 'detune', label: '微調整', min: -50, max: 50, step: 1, fmt: function (v) { return v + ' cent'; } },
    { head: 'エンベロープ（音量の変化）' },
    { k: 'attack', label: 'アタック', min: 0.0005, max: 3, log: true, fmt: fmtSec },
    { k: 'decay', label: 'ディケイ', min: 0.005, max: 4, log: true, fmt: fmtSec },
    { k: 'sustain', label: 'サステイン', min: 0, max: 1, step: 0.01 },
    { k: 'release', label: 'リリース', min: 0.003, max: 4, log: true, fmt: fmtSec },
    { head: 'フィルター（音の明るさ）' },
    { k: 'cutoff', label: 'カットオフ', min: 50, max: 20000, log: true, fmt: function (v) { return v >= 19000 ? 'なし' : Math.round(v) + ' Hz'; } },
    { k: 'resonance', label: 'レゾナンス', min: 0, max: 0.95, step: 0.01 },
    { k: 'filterEnv', label: 'エンベロープ量', min: 0, max: 6, step: 0.1, fmt: function (v) { return v + ' oct'; } },
    { k: 'filterDecay', label: 'エンベロープ減衰', min: 0.005, max: 2, log: true, fmt: fmtSec },
    { k: 'keyTrack', label: 'キー追従', min: 0, max: 1, step: 0.05 },
    { head: 'その他' },
    { k: 'vibratoDepth', label: 'ビブラートの深さ', min: 0, max: 100, step: 1, fmt: function (v) { return v + ' cent'; } },
    { k: 'vibratoRate', label: 'ビブラートの速さ', min: 0.5, max: 12, step: 0.1, fmt: function (v) { return v + ' Hz'; } },
    { k: 'vibratoDelay', label: 'ビブラートまでの時間', min: 0, max: 2, step: 0.01, fmt: fmtSec },
    { k: 'drive', label: '歪み', min: 0, max: 1, step: 0.01 }
  ];
  var DRUM_PARAMS = [
    { head: 'ドラム' },
    { k: 'kit', label: '音の傾向', type: 'select', options: [['chip', 'チップ（ファミコン風）'], ['electro', 'エレクトロ']] },
    { k: 'tune', label: 'ピッチ', min: -12, max: 12, step: 1, fmt: function (v) { return (v > 0 ? '+' : '') + v + ' 半音'; } },
    { k: 'decay', label: '余韻の長さ', min: 0.3, max: 3, step: 0.05, fmt: function (v) { return '×' + v; } },
    { k: 'tone', label: '明るさ', min: 0, max: 1, step: 0.01 },
    { k: 'gain', label: '音量補正', min: 0, max: 1.5, step: 0.01 }
  ];

  function toSlider(def, v) { return def.log ? Math.round(1000 * Math.log(v / def.min) / Math.log(def.max / def.min)) : v; }
  function fromSlider(def, s) {
    if (!def.log) return Number(s);
    var v = def.min * Math.pow(def.max / def.min, Number(s) / 1000);
    var dig = v < 0.01 ? 4 : (v < 1 ? 3 : (v < 100 ? 2 : 0));
    var m = Math.pow(10, dig);
    return Math.round(v * m) / m;
  }
  function fmtVal(def, v) { return def.fmt ? def.fmt(v) : String(Math.round(v * 100) / 100); }

  function buildSound() {
    var host = document.getElementById('tab-sound');
    host.innerHTML = '';
    var i = App.part, part = App.doc.parts[i];
    var drum = BGM.isDrumInstrument(part.instrument);
    var resolved = BGM.resolveParams(part.instrument, part.params);
    host.appendChild(h('div', { class: 'panel-h', text: 'パート' + (i + 1) + '：' + part.name }));
    host.appendChild(h('div', { class: 'param' }, [
      h('div', { class: 'lab' }, [h('span', { text: '音色プリセット' })]),
      Panels.instrumentSelect(part.instrument, function (v, s) { if (!Panels.changeInstrument(i, v)) s.value = part.instrument; })
    ]));
    var defs = drum ? DRUM_PARAMS : SYNTH_PARAMS;
    defs.forEach(function (def) {
      if (def.head) { host.appendChild(h('div', { class: 'panel-h', text: def.head })); return; }
      if (def.show && !def.show(resolved)) return;
      var val = resolved[def.k];
      var valEl = h('span', { class: 'val', text: def.type === 'select' ? '' : fmtVal(def, val) });
      var input;
      if (def.type === 'select') {
        input = h('select');
        def.options.forEach(function (o) { input.appendChild(h('option', { value: o[0], text: o[1] })); });
        input.value = val;
        input.addEventListener('change', function () {
          App.edit(function () { part.params[def.k] = input.value; }, {});
          buildSound();
        });
      } else {
        input = h('input', { type: 'range', min: def.log ? 0 : def.min, max: def.log ? 1000 : def.max, step: def.log ? 1 : def.step });
        input.value = toSlider(def, val);
        liveRange(input, function (s) {
          var v = fromSlider(def, s);
          part.params[def.k] = v;
          valEl.textContent = fmtVal(def, v);
        });
        input.addEventListener('change', function () { App.preview(drum ? 38 : 64, 100); });
      }
      host.appendChild(h('div', { class: 'param' }, [h('div', { class: 'lab' }, [h('span', { text: def.label }), valEl]), input]));
    });
    host.appendChild(h('div', { class: 'panel-h', text: 'エフェクトへ送る量' }));
    [['reverb', 'リバーブ（残響）'], ['delay', 'ディレイ（やまびこ）']].forEach(function (x) {
      var valEl = h('span', { class: 'val', text: String(part[x[0]]) });
      var input = h('input', { type: 'range', min: 0, max: 1, step: 0.01 });
      input.value = part[x[0]];
      liveRange(input, function (v) { part[x[0]] = v; valEl.textContent = String(v); });
      host.appendChild(h('div', { class: 'param' }, [h('div', { class: 'lab' }, [h('span', { text: x[1] }), valEl]), input]));
    });
    var row = h('div', { class: 'row' }, [
      h('button', { text: 'プリセットの値に戻す', onclick: function () { App.edit(function () { part.params = {}; }); } }),
      h('button', { text: '試し弾き', onclick: function () { App.preview(drum ? 36 : 60, 100); } })
    ]);
    host.appendChild(row);
    if (drum) {
      var list = Object.keys(BGM.DRUM_MAP).map(function (k) { return k + '：' + BGM.DRUM_MAP[k].label; }).join(' / ');
      host.appendChild(h('p', { class: 'note', text: 'ドラムは音の高さの行ごとに音色が決まっています（' + list + '）。同じタイミングに置けるのは3音までです。' }));
    }
  }

  // ---------------------------------------------------------------
  // 曲・ミックス
  // ---------------------------------------------------------------
  function buildSong() {
    var host = document.getElementById('tab-song');
    host.innerHTML = '';
    var m = App.doc.master;
    function slider(label, get, set, min, max, step, fmt) {
      var valEl = h('span', { class: 'val', text: fmt ? fmt(get()) : String(get()) });
      var input = h('input', { type: 'range', min: min, max: max, step: step });
      input.value = get();
      liveRange(input, function (v) { set(v); valEl.textContent = fmt ? fmt(v) : String(v); });
      host.appendChild(h('div', { class: 'param' }, [h('div', { class: 'lab' }, [h('span', { text: label }), valEl]), input]));
    }
    host.appendChild(h('div', { class: 'panel-h', text: '全体' }));
    slider('全体の音量', function () { return m.volume; }, function (v) { m.volume = v; }, 0, 1.5, 0.01);
    host.appendChild(h('div', { class: 'panel-h', text: 'リバーブ（残響）' }));
    slider('部屋の広さ', function () { return m.reverb.size; }, function (v) { m.reverb.size = v; }, 0, 1, 0.01);
    slider('高音の吸収', function () { return m.reverb.damp; }, function (v) { m.reverb.damp = v; }, 0, 1, 0.01);
    slider('リバーブの音量', function () { return m.reverb.level; }, function (v) { m.reverb.level = v; }, 0, 1, 0.01);
    host.appendChild(h('div', { class: 'panel-h', text: 'ディレイ（やまびこ）' }));
    var beats = h('select');
    [[0.25, '16分'], [1 / 3, '8分3連'], [0.5, '8分'], [0.75, '付点8分'], [1, '4分'], [1.5, '付点4分'], [2, '2分']].forEach(function (o) {
      beats.appendChild(h('option', { value: String(o[0]), text: o[1] }));
    });
    var bestOpt = Array.prototype.slice.call(beats.options).reduce(function (a, o) { return Math.abs(Number(o.value) - m.delay.beats) < Math.abs(Number(a.value) - m.delay.beats) ? o : a; });
    beats.value = bestOpt.value;
    beats.addEventListener('change', function () { App.edit(function () { m.delay.beats = Number(beats.value); }, { param: true }); });
    host.appendChild(h('div', { class: 'param' }, [h('div', { class: 'lab' }, [h('span', { text: '間隔（テンポに同期）' })]), beats]));
    slider('くり返しの量', function () { return m.delay.feedback; }, function (v) { m.delay.feedback = v; }, 0, 0.9, 0.01);
    slider('ディレイの音量', function () { return m.delay.level; }, function (v) { m.delay.level = v; }, 0, 1, 0.01);
    host.appendChild(h('div', { class: 'panel-h', text: '曲の情報' }));
    var info = h('div', { class: 'note', id: 'songInfo' });
    host.appendChild(info);
    refreshSongInfo();
    var plan = App.doc.meta && App.doc.meta.plan;
    if (plan && plan.summary) {
      host.appendChild(h('div', { class: 'panel-h', text: '設計図の説明（AI）' }));
      host.appendChild(h('div', { class: 'note', text: plan.summary }));
    }
  }
  function refreshSongInfo() {
    var info = document.getElementById('songInfo');
    if (!info) return;
    var spt = App.secPerTick();
    var lines = [
      'テンポ ' + App.doc.bpm + ' / 4分の4拍子 / ' + App.doc.key.tonic + (App.doc.key.mode === 'minor' ? ' 短調' : ' 長調'),
      'イントロ ' + (App.introBars() ? App.introBars() + ' 小節（' + App.fmtTime(App.introTicks() * spt) + '）' : 'なし'),
      'ループ ' + App.doc.loopBars + ' 小節（' + App.fmtTime(App.doc.loopBars * TPB * spt) + '）',
      '音符の総数 ' + App.doc.parts.reduce(function (a, p) { return a + p.notes.length; }, 0)
    ];
    info.innerHTML = '';
    lines.forEach(function (l) { info.appendChild(h('div', { text: l })); });
  }

  // ---------------------------------------------------------------
  // セクション
  // ---------------------------------------------------------------
  function buildSections() {
    var host = document.getElementById('tab-sections');
    host.innerHTML = '';
    host.appendChild(h('p', { class: 'note', text: '曲の区切りに名前を付けられます（再生には影響しません）。ルーラーをダブルクリックしても追加できます。' }));
    var secs = App.doc.sections;
    secs.forEach(function (s, idx) {
      var bar = h('input', { type: 'number', min: 1, max: App.totalBars(), value: s.bar + 1, title: '小節' });
      var name = h('input', { type: 'text', value: s.name });
      bar.addEventListener('change', function () {
        App.edit(function () { s.bar = Math.max(0, Math.min(App.totalBars() - 1, Math.round(Number(bar.value) || 1) - 1)); secs.sort(function (a, b) { return a.bar - b.bar; }); });
      });
      name.addEventListener('change', function () { App.edit(function () { s.name = name.value; }, { param: true }); });
      host.appendChild(h('div', { class: 'sec-row' }, [
        bar, name,
        h('button', { text: '→', title: 'この小節へ移動', onclick: function () { App.cursor = s.bar * TPB; App.emit('cursor'); window.PianoRoll.scrollToTick(App.cursor); } }),
        h('button', { text: '×', title: '削除', onclick: function () { App.edit(function () { secs.splice(idx, 1); }); } })
      ]));
    });
    host.appendChild(h('div', { class: 'row' }, [h('button', {
      text: 'カーソル位置に追加', onclick: function () {
        var b = Math.floor(App.cursor / TPB);
        App.edit(function () {
          App.doc.sections = App.doc.sections.filter(function (x) { return x.bar !== b; });
          App.doc.sections.push({ bar: b, name: '新しいセクション' });
          App.doc.sections.sort(function (a, c) { return a.bar - c.bar; });
        });
      }
    })]));
  }

  Panels.refresh = function (opts) {
    opts = opts || {};
    refreshTracks();
    if (!opts.param) { buildSound(); buildSong(); buildSections(); }
    else refreshSongInfo();
  };

  Panels.init = function () {
    buildTracks();
    document.querySelectorAll('#panel .tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#panel .tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
        document.querySelectorAll('#panel .tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab); });
      });
    });
    App.on('change', function (opts) { Panels.refresh(opts); });
    App.on('part', function () { refreshTracks(); buildSound(); });
  };
})();
