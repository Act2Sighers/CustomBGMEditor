/*
 * Claude API に「下地の設計図」を作ってもらう。
 * ブラウザから直接 API を呼ぶ（Node.js やビルド不要にするため、SDK ではなく fetch を使う）。
 * APIキーはこのブラウザの localStorage にのみ保存される。
 */
(function (root) {
  'use strict';
  var BGM = root.CustomBGM, A = root.CustomBGMArranger;

  var API_URL = 'https://api.anthropic.com/v1/messages';
  var API_VERSION = '2026-10-21';
  var DEFAULT_MODEL = 'claude-opus-5-5';
  // サーバー側フォールバック（安全分類器が誤って拒否したとき別モデルで再実行）に対応するモデル
  var FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-sonnet-5-5'];

  function buildSchema() {
    return {
      type: 'object', additionalProperties: false,
      required: ['title', 'bpm', 'key', 'feel', 'sections', 'layers', 'summary'],
      properties: {
        title: { type: 'string', description: '曲のタイトル（日本語可）' },
        bpm: { type: 'integer', description: 'テンポ。40〜260' },
        key: {
          type: 'object', additionalProperties: false, required: ['tonic', 'mode'],
          properties: {
            tonic: { type: 'string', enum: BGM.NOTE_NAMES },
            mode: { type: 'string', enum: ['major', 'minor'] }
          }
        },
        feel: { type: 'string', enum: ['straight', 'shuffle'], description: 'shuffle は8分音符を3連符のハネたノリにする' },
        sections: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['name', 'intro', 'bars', 'energy', 'chords', 'ending'],
            properties: {
              name: { type: 'string' },
              intro: { type: 'boolean', description: 'true のセクションはループに入る前に1回だけ流れるイントロ。先頭にのみ置ける' },
              bars: { type: 'integer' },
              energy: { type: 'integer', description: '盛り上がり 1〜5' },
              chords: { type: 'string', description: '1小節ずつ | で区切ったコード進行。1小節に複数書くときは空白区切り' },
              ending: { type: 'string', enum: Object.keys(A.ENDINGS) }
            }
          }
        },
        layers: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['role', 'parts', 'instrument', 'pattern', 'octave', 'volume', 'sections'],
            properties: {
              role: { type: 'string', enum: Object.keys(A.ROLES) },
              parts: { type: 'array', items: { type: 'integer' }, description: '使うパート番号（3〜8）' },
              instrument: { type: 'string', enum: Object.keys(BGM.PRESETS) },
              pattern: { type: 'string', enum: Object.keys(A.PATTERNS) },
              octave: { type: 'integer', description: '音域の上下（-1, 0, 1）' },
              volume: { type: 'number', description: '0〜1' },
              sections: { type: 'array', items: { type: 'string' }, description: '鳴らすセクション名。空配列なら全セクション' }
            }
          }
        },
        summary: { type: 'string', description: 'この設計図の意図を日本語で3〜6文程度で説明' }
      }
    };
  }

  function buildSystemPrompt() {
    var lines = [];
    lines.push('あなたはゲームBGMの編曲設計者です。ユーザーが口語で伝えた雰囲気をもとに、ループ再生されるBGMの「下地（伴奏）」の設計図をJSONで作ります。');
    lines.push('設計図はソフト側のルール生成器が音符に展開します。あなたが決めるのは、テンポ、調、曲構成、コード進行、各パートの役割・音色・奏法です。メインメロディや副旋律は作りません（パート1と2はユーザーがメロディを打ち込むために空けておきます）。');
    lines.push('');
    lines.push('## 守るべき条件');
    lines.push('- 拍子は4/4固定。1小節の秒数 = 240 / BPM。');
    lines.push('- ループ部分（intro=false のセクションの合計小節数）の長さは3分以上10分未満にすること。ユーザーが長さを指定したら、小節数 = 分 × BPM ÷ 4 で計算して、それに近づけること（セクションの小節数は4の倍数が望ましい）。指定がなければ3分半〜4分半程度。');
    lines.push('- イントロ（ループ前に1回だけ流れる部分）はユーザーが望んだとき、または曲調上自然なときだけ付ける。付けるなら先頭に intro=true のセクションとして置き、2〜8小節程度。');
    lines.push('- レイヤーにはパート3〜8だけを使う。各パートは1つのレイヤーにしか属さない。ドラムのレイヤーは最大1つで、音色はドラム系のみ。ドラム以外のレイヤーにドラム音色は使わない。');
    lines.push('- 和音(chords)レイヤーは2〜3パートで和音を分担する（1パートは同時に1音しか鳴らせないため）。ベース・アルペジオ・刻み・ドラムは1パートずつ。');
    lines.push('- ループの最後の小節から、ループ先頭（イントロではなくループ部分の最初のセクション）のコードへ自然に戻れる進行にすること。');
    lines.push('- 曲が単調にならないよう、セクションごとに energy や鳴らすレイヤー（layers[].sections）を変えて起伏を作る。同じセクション名は同じ役割の部分として再利用してよい。');
    lines.push('');
    lines.push('## コード進行の書き方');
    lines.push('- 例: "Am | F | G | E7"（4小節）、"C G | Am F"（1小節に2つ）。');
    lines.push('- 使える種類: ' + A.QUALITY_NAMES.filter(Boolean).join(', ') + '（無印は長三和音）。分数コードは "C/E"。休みは "N.C."。');
    lines.push('- 進行がセクションの小節数より短ければ繰り返される。');
    lines.push('');
    lines.push('## 役割（role）');
    Object.keys(A.ROLES).forEach(function (k) { lines.push('- ' + k + ': ' + A.ROLES[k].label); });
    lines.push('');
    lines.push('## 奏法（pattern）※役割の接頭辞と一致するものだけ使える');
    Object.keys(A.PATTERNS).forEach(function (k) { lines.push('- ' + k + ': ' + A.PATTERNS[k].label); });
    lines.push('');
    lines.push('## 音色（instrument）');
    var cat = { lead: '汎用・高音向き', chord: '和音向き', bass: 'ベース向き', drum: 'ドラム' };
    Object.keys(BGM.PRESETS).forEach(function (k) { var p = BGM.PRESETS[k]; lines.push('- ' + k + ': ' + p.label + '（' + cat[p.category] + '）'); });
    lines.push('');
    lines.push('## 曲の終わり方（ending）※各セクションの最後の小節に効く');
    Object.keys(A.ENDINGS).forEach(function (k) { lines.push('- ' + k + ': ' + A.ENDINGS[k]); });
    lines.push('');
    lines.push('## その他');
    lines.push('- octave は基本 0。ベースを重くしたいなら -1、アルペジオを高くしたいなら 1 など。');
    lines.push('- volume の目安: ベース0.8〜0.9、和音0.5〜0.65、アルペジオ0.4〜0.55、刻み0.4〜0.5、ドラム0.8〜0.9。');
    lines.push('- 電子音・チップチューン寄りの音色構成で、効果音と馴染むようにする。');
    lines.push('- summary には、テンポ・調・構成・コード進行・音色選びの意図を日本語で簡潔に書く。');
    return lines.join('\n');
  }

  function errorMessage(status, body) {
    var msg = '';
    try { var j = JSON.parse(body); msg = j.error && j.error.message ? j.error.message : ''; } catch (e) { msg = body ? String(body).slice(0, 200) : ''; }
    if (status === 401) return 'APIキーが無効です。設定でキーを確認してください。' + (msg ? '（' + msg + '）' : '');
    if (status === 403) return 'このAPIキーでは利用できません。' + (msg ? '（' + msg + '）' : '');
    if (status === 404) return 'モデルが見つかりません。設定のモデル名を確認してください。' + (msg ? '（' + msg + '）' : '');
    if (status === 429) return 'API の利用上限（レート制限）に達しました。しばらく待ってから再度お試しください。';
    if (status === 529 || status === 503) return 'API が混雑しています。しばらく待ってから再度お試しください。';
    return 'API エラー（' + status + '）: ' + msg;
  }

  // opts: { apiKey, model, effort, prompt, onStatus(text), signal }
  // 戻り値: Promise<{ plan, model, usage }>
  async function requestPlan(opts) {
    var model = opts.model || DEFAULT_MODEL;
    var body = {
      model: model,
      max_tokens: 32000,
      stream: true,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: opts.prompt }],
      output_config: { effort: opts.effort || 'medium', format: { type: 'json_schema', schema: buildSchema() } }
    };
    var headers = {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (FALLBACK_MODELS.indexOf(model) >= 0) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    var status = opts.onStatus || function () {};
    status('Claude に送信中…');
    var res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: opts.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('中止しました');
      throw new Error('通信に失敗しました（ネットワーク接続を確認してください）: ' + (e && e.message || e));
    }
    if (!res.ok) throw new Error(errorMessage(res.status, await res.text()));

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '', blocks = [], stopReason = null, usedModel = model, usage = {}, streamError = null;
    var textLen = 0, thinking = false;
    function handle(ev) {
      if (ev.type === 'message_start') { usedModel = ev.message.model || usedModel; usage = ev.message.usage || {}; }
      else if (ev.type === 'content_block_start') {
        blocks[ev.index] = { type: ev.content_block.type, text: ev.content_block.text || '' };
        if (ev.content_block.type === 'thinking') { thinking = true; status('考え中…'); }
        if (ev.content_block.type === 'fallback') status('別のモデルで続行中…');
      } else if (ev.type === 'content_block_delta') {
        var b = blocks[ev.index];
        if (b && ev.delta.type === 'text_delta') { b.text += ev.delta.text; textLen += ev.delta.text.length; status('設計図を受信中… ' + textLen + ' 文字'); }
      } else if (ev.type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage) for (var k in ev.usage) usage[k] = ev.usage[k];
      } else if (ev.type === 'error') {
        streamError = ev.error;
      }
    }
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      var idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        var chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        var data = chunk.split('\n').filter(function (l) { return l.indexOf('data:') === 0; }).map(function (l) { return l.slice(5).trim(); }).join('');
        if (!data) continue;
        try { handle(JSON.parse(data)); } catch (e) { /* 壊れた行は無視 */ }
      }
    }
    if (streamError) {
      if (streamError.type === 'overloaded_error') throw new Error('API が混雑しています。しばらく待ってから再度お試しください。');
      throw new Error('API エラー: ' + (streamError.message || streamError.type));
    }
    if (stopReason === 'refusal') throw new Error('Claude がこの依頼への回答を控えました。表現を変えて再度お試しください。');
    if (stopReason === 'max_tokens') throw new Error('出力が長すぎて途中で切れました。もう少し短い曲にするか、もう一度お試しください。');
    // フォールバックがあった場合は最後の fallback ブロック以降のテキストを使う
    var lastFallback = -1;
    blocks.forEach(function (b, i) { if (b && b.type === 'fallback') lastFallback = i; });
    var text = blocks.filter(function (b, i) { return b && b.type === 'text' && i > lastFallback; }).map(function (b) { return b.text; }).join('');
    if (!text) text = blocks.filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    var plan;
    try { plan = JSON.parse(text); } catch (e) {
      var m = /\{[\s\S]*\}/.exec(text);
      if (!m) throw new Error('設計図（JSON）を読み取れませんでした');
      plan = JSON.parse(m[0]);
    }
    return { plan: plan, model: usedModel, usage: usage, thinking: thinking };
  }

  root.CustomBGMAI = {
    DEFAULT_MODEL: DEFAULT_MODEL,
    buildSchema: buildSchema,
    buildSystemPrompt: buildSystemPrompt,
    requestPlan: requestPlan
  };
})(typeof self !== 'undefined' ? self : this);
