# CLAUDE.md

## このリポジトリについて

ゲーム用 BGM の打ち込みエディタ（日本語 UI）。ユーザーが作った楽譜 `.bgm.json` を、別セッションの Claude がゲームで使う。

- **楽譜をゲームで使うよう頼まれた場合は [docs/FOR_CLAUDE.md](docs/FOR_CLAUDE.md) を読むこと。**
- 楽譜の仕様は [docs/FORMAT.md](docs/FORMAT.md)。

## 開発の決まり

- **ビルド不要・npm 依存なし。** ユーザーは Node.js を入れずに `index.html` をダブルクリック（file://）で開く。
  - ES モジュール・fetch によるローカルファイル読み込み・外部 CDN は使わない。通常の `<script>` で読み込み、グローバル（`window.App` など）で連携する。
  - AudioWorklet は blob: URL → data: URL（file:// 用）→ ScriptProcessor の順にフォールバックする。
- `engine/bgm-engine.js` の `BGM_DSP()` 関数は `toString()` して AudioWorklet に埋め込むため、**関数の外の変数を参照してはいけない**。
- エンジンとアレンジャーは UMD 形式で、Node.js からも `require` できる（テストと `tools/` で使用）。
- 制約: 8パート、通常パートは同時1音、ドラム音源のパートは同じ tick に3音まで・曲全体で1パートまで。ループは3分以上10分未満を推奨（警告のみ）。
- 楽譜の形式を変えるときは `version` を上げ、`normalizeScore` で旧形式を読めるようにし、docs/FORMAT.md を更新する。
- AI 機能はブラウザから Claude API を直接呼ぶ（`anthropic-dangerous-direct-browser-access`）。SDK はビルドが必要になるため使わず、`js/ai.js` で fetch する。

## テスト

```bash
node tests/run-tests.js                                    # エンジン・アレンジャーのテスト
node tools/score-info.js examples/demo.bgm.json            # 楽譜の確認
node tools/render-wav.js examples/demo.bgm.json -o /tmp/demo.wav
```

UI の確認は Playwright（Chromium）で `file:///.../index.html` を開いて行う。
