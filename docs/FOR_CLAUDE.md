# Claude 向けガイド：CustomBGM の楽譜をゲームで使う

このドキュメントは、ユーザーから「この BGM（`.bgm.json`）をゲームに付けて」と頼まれた Claude のためのものです。
楽譜はユーザーが CustomBGMEditor で自分で作ったものです。**頼まれない限り、音符・音色・テンポなどの音楽的な内容を変えないでください。** 音量の調整や再生タイミングの制御はゲーム側で行います。

## 必要なファイル

| ファイル | 役割 |
|---|---|
| `engine/bgm-engine.js` | 再生・WAV書き出しエンジン（**この1ファイルだけで完結**。依存なし。ブラウザでも Node.js でも動く） |
| `tools/render-wav.js` | WAV に書き出すコマンド（Node.js 18 以上） |
| `tools/score-info.js` | 楽譜の概要と制約違反を表示するコマンド |
| `docs/FORMAT.md` | 楽譜ファイルの仕様 |

エンジンはリポジトリ `Act2Sighers/CustomBGMEditor` の `engine/bgm-engine.js` にあります。ゲームのリポジトリへコピーして使ってください。

まず楽譜の中身を確認します。

```bash
node tools/score-info.js 曲.bgm.json
```

## 使い方の選び方

| ゲームの作り | おすすめ |
|---|---|
| ブラウザで動く（HTML/JavaScript/TypeScript、Canvas、Phaser、PixiJS など） | **A. その場で合成して再生**（ファイルが小さく、ループも完全に継ぎ目なし） |
| それ以外（Python/pygame、Godot、Unity、Love2D、C++ など） | **B. WAV に書き出して使う** |

## A. ブラウザゲームでその場で再生する

```html
<script src="bgm-engine.js"></script>
<script>
  const bgm = new CustomBGM.Player({ volume: 0.7 });
  // 楽譜は fetch で読むか、JS に埋め込む（file:// で開くゲームなら埋め込みが確実）
  const score = await (await fetch('bgm/dungeon.bgm.json')).json();
  await bgm.load(score);

  // ブラウザはユーザー操作の後でないと音を出せない。クリックやキー入力の処理の中で呼ぶ
  startButton.onclick = () => bgm.play({ fadeIn: 0.5 });   // イントロ → ループを無限に繰り返す
  // bgm.stop({ fadeOut: 1.5 });                           // フェードアウトして停止
  // bgm.setVolume(0.3, 0.5);                              // 0.5秒かけて音量を変える
</script>
```

- ES モジュールとして読み込む場合は、`bgm-engine.js` を `<script>` で読み込んで `window.CustomBGM` を使うか、バンドラーで `require` してください（UMD 形式です）。
- 効果音と同じ `AudioContext` を使いたい場合: `new CustomBGM.Player({ audioContext: ctx, destination: sfxBusOrCtxDestination })`
- 曲を切り替えるときは、Player を曲ごとに作るか、`stop()` してから `load()` → `play()` します。
- 合成は AudioWorklet（別スレッド）で行います。使えない環境では自動的に ScriptProcessor に切り替わります。
- `player.play({ startTick })` で途中から再生できます（tick は4分音符 = 48）。

## B. WAV に書き出して使う

```bash
# ゲーム用・2ファイル（おすすめ）: 曲_intro.wav（1回だけ）と 曲_loop.wav（繰り返し）
node tools/render-wav.js 曲.bgm.json --mode split -o assets/bgm/dungeon.wav

# ゲーム用・1ファイル: イントロ＋ループ1周。WAV の smpl チャンクにループ位置が入る
node tools/render-wav.js 曲.bgm.json --mode game -o assets/bgm/dungeon.wav

# 試聴用（イントロ＋ループ1回＋8秒フェードアウト）
node tools/render-wav.js 曲.bgm.json
```

- 実行後に、各ファイルの長さやループ位置（サンプル単位）が JSON で表示されます。
- ループ部分は「2周目」を書き出しているので、先頭に前の周の余韻が入っています。**ループファイルをそのまま繰り返せば継ぎ目は目立ちません。**
- 出力は 44.1kHz / 16bit / ステレオです（1分あたり約10MB）。容量を減らしたい場合は ffmpeg などで OGG に変換してかまいません（`ffmpeg -i in.wav -q:a 5 out.ogg`）。変換してもループ位置（サンプル数）は変わりません。
- イントロが無い曲では `--mode split` はループのファイルだけを出力します。

### 再生側の例

**pygame**（イントロ → ループ）

```python
pygame.mixer.music.load("assets/bgm/dungeon_intro.wav")
pygame.mixer.music.queue("assets/bgm/dungeon_loop.wav", loops=-1)  # pygame 2.0.1 以降
pygame.mixer.music.play()
```

`queue` の `loops` が使えない古い pygame では、`pygame.mixer.music.set_endevent()` でイントロの終了を検知して、ループのファイルを `play(loops=-1)` してください。

**Godot 4**: `dungeon_loop.wav` をインポート設定で Loop Mode = Forward にする（または `--mode game` のファイルを使い、Loop Mode を「Detect From WAV」にする）。イントロは別の `AudioStreamPlayer` で1回鳴らし、`finished` シグナルでループを開始します。

**Unity**: イントロとループを2つの `AudioSource` に入れ、`intro.PlayScheduled(t0)`、`loop.loop = true; loop.PlayScheduled(t0 + introClip.samples / (double)introClip.frequency)` で隙間なくつなぎます。

## 楽譜をプログラムで扱う（頼まれたときだけ）

```js
const BGM = require('./engine/bgm-engine.js');
const score = BGM.normalizeScore(fs.readFileSync('曲.bgm.json', 'utf8')); // 欠けた値を補う
console.log(BGM.timing(score));          // イントロ・ループの秒数
console.log(BGM.validateScore(score));   // 制約違反（1パート1音、ドラム同時3音まで など）
```

楽譜を書き換える場合も、[FORMAT.md](FORMAT.md) の制約（8パート、通常パートは同時1音、ドラムは同時3音まで・1パートまで）を守ってください。

## よくある注意点

- ブラウザでは、ユーザー操作の前に `play()` しても音が出ません（自動再生の制限）。タイトル画面のクリックなどで開始してください。
- ループの長さはユーザーが 3〜10分程度で作っています。シーン切り替えでは `stop({ fadeOut })` を使うと自然です。
- 音が大きすぎる・小さすぎる場合は、楽譜を変えずに `volume`（Player）やゲーム側の音量で調整してください。
