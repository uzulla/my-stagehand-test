# Stagehand E2E Test

[Stagehand](https://github.com/browserbase/stagehand) を使って https://cfe.jp/ に対する E2E テストを行うサンプルプロジェクト。

## Stagehand とは

Stagehand は [Browserbase](https://www.browserbase.com/) が開発した AI 駆動のブラウザ自動化フレームワーク。Playwright を拡張し、自然言語でブラウザを操作できる 3 つの AI プリミティブを提供する:

- **`act(instruction)`** — 自然言語で操作を指示（クリック、入力など）
- **`extract(instruction, schema)`** — ページからZodスキーマに沿った構造化データを抽出
- **`observe(instruction)`** — ページ上の操作可能な要素を発見・列挙

ローカルモード (`env: "LOCAL"`) で実行すると Browserbase のクラウドサービス不要で、ローカルの Chromium だけで動作する。ただし LLM の API キー（OpenAI or Anthropic）は必要。

## セットアップ

```bash
# 依存パッケージのインストール
pnpm install

# Playwright の Chromium をインストール（初回のみ）
pnpm exec playwright install chromium

# 環境変数の設定
cp .env.example .env
# .env を編集して OPENAI_API_KEY または ANTHROPIC_API_KEY を設定
```

## 実行

```bash
pnpm e2e
```

ブラウザが起動し、https://cfe.jp/ に対して以下のテストが実行される:

1. **ページ遷移** — `page.goto()` でサイトを開く
2. **プロフィール情報の抽出** — `extract()` で名前・肩書き・SNS リンク一覧を構造化抽出
3. **著書情報の抽出** — `extract()` で書籍タイトル・説明を抽出
4. **リンクの観察** — `observe()` でページ上のクリック可能な要素を列挙
5. **リンクのクリック** — `act()` で GitHub リンクをクリックし、遷移先が `github.com` であることを検証

各ステップでスクリーンショットが `screenshots/` に保存される。さらに、テスト全体のブラウザ画面を録画した動画が `recordings/test-recording.mp4` に保存される。

### 動画録画

テスト中、500ms 間隔でブラウザ画面をキャプチャし、テスト終了後に `ffmpeg` で mp4 動画に変換する。ffmpeg がインストールされていない場合はフレーム画像（PNG連番）がそのまま `recordings/frames/` に残る。

```
recordings/
  test-recording.mp4   ← テスト全体の録画（H.264, 2fps）
```

動画はテストの成功・失敗に関わらず生成されるため、失敗時に「どの時点でブラウザがどういう状態だったか」をタイムラインで確認できる。

> **なぜ Playwright の `recordVideo` を使わないのか？**
> Playwright には `context.newContext({ recordVideo: { dir: 'videos/' } })` というネイティブの録画機能があるが、Stagehand v3 は Playwright の BrowserContext を使わず CDP (Chrome DevTools Protocol) に直接接続する独自の `V3Context` でブラウザを制御している。そのため Playwright の録画 API にアクセスできない。代替として、`page.screenshot()` を定期的に呼び出して連番 PNG を保存し、`ffmpeg` で mp4 に結合する方式を採用している。

### スクリーンショット出力

| ファイル | タイミング | 対象ページ |
|---|---|---|
| `01-page-loaded.png` | ページ読み込み完了後 | cfe.jp |
| `02-profile-extracted.png` | プロフィール抽出後 | cfe.jp |
| `03-books-extracted.png` | 著書抽出後 | cfe.jp |
| `04-links-observed.png` | リンク観察後 | cfe.jp |
| `05a-before-click.png` | GitHub リンクをクリックする直前 | cfe.jp |
| `05b-new-tab.png` | クリック後に開かれた新しいタブ | 遷移先（成功時: GitHub、失敗時: 間違ったページ） |
| `error-crash.png` | 予期しないエラーでクラッシュした場合 | cfe.jp |

`05b-new-tab.png` が最も重要で、成功時は GitHub のプロフィールページ、失敗時は実際に開かれてしまった間違ったページが写る。キャッシュ破損の問題を視覚的に確認できる。

テスト完了時にサマリーが出力され、失敗したステップのスクリーンショットパスが案内される:

```
=== Test Results ===

  PASS  Test 1: Page navigation
        screenshot: screenshots/01-page-loaded.png
  FAIL  Test 5: Click GitHub link
        screenshot: screenshots/05b-new-tab.png

1 test(s) FAILED. Screenshots for failed steps:
  -> Test 5: Click GitHub link
     screenshots/05b-wrong-page.png
```

## 参照したドキュメント・サンプル

### 公式ドキュメント

- [Stagehand GitHub README](https://github.com/browserbase/stagehand) — ライブラリ本体とインストール方法
- [Stagehand Quickstart](https://docs.stagehand.dev/v3/first-steps/quickstart) — 公式クイックスタートガイド
- [Constructor Reference (V3Options)](https://docs.stagehand.dev/v3/references/stagehand) — 初期化オプションの詳細
- [act() API Reference](https://docs.stagehand.dev/v3/references/act) — act メソッドの使い方
- [extract() API Reference](https://docs.stagehand.dev/basics/extract) — extract メソッドの使い方
- [observe() API Reference](https://docs.stagehand.dev/v3/references/observe) — observe メソッドの使い方
- [Browser Configuration (LOCAL mode)](https://docs.stagehand.dev/v3/configuration/browser) — ローカルブラウザの起動オプション

### ブログ・チュートリアル

- [Stagehand v3 Blog Post](https://www.browserbase.com/blog/stagehand-v3) — V3 リリースの解説
- [AI Browser Automation with Stagehand and OpenAI](https://www.workingsoftware.dev/ai-browser-automation-with-stagehand-and-openai/) — Patrick Roos によるチュートリアル

### サンプルコード

公式 README に記載されている基本パターン:

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();
const page = stagehand.context.pages()[0];

// ページ遷移
await page.goto("https://example.com");

// AI によるアクション実行
await stagehand.act("click the login button");

// 構造化データの抽出 (v3: 位置引数スタイル)
const data = await stagehand.extract(
  "extract the main heading",
  z.object({ heading: z.string() })
);

// 要素の観察
const elements = await stagehand.observe("find all buttons");

await stagehand.close();
```

また、`npx create-browser-app` で scaffold されるプロジェクトもスタート地点として参考になる。

## act() のキャッシュ機能

Stagehand v3 には `act()` の結果をローカルファイルにキャッシュし、2回目以降は LLM を呼ばずにキャッシュから直接実行する機能がある。

### 有効化

コンストラクタに `cacheDir` を指定するだけ:

```typescript
const stagehand = new Stagehand({
  env: "LOCAL",
  model: "openai/gpt-4o",
  cacheDir: ".cache/cfe-test",  // キャッシュの保存先ディレクトリ
});
```

### 動作の仕組み

1. **1回目**: LLM を呼び出して「どの要素をどう操作するか」を判定し、結果を JSON ファイルとしてキャッシュに保存
2. **2回目以降**: 同じ instruction + URL の組み合わせならキャッシュから xpath セレクタを取得し、LLM を呼ばずに直接操作

### キャッシュの中身

`.cache/cfe-test/` 以下に、instruction + URL のハッシュをファイル名とした JSON が保存される:

```json
{
  "version": 1,
  "instruction": "Click the GitHub link",
  "url": "https://cfe.jp/",
  "variableKeys": [],
  "actions": [
    {
      "selector": "xpath=/html[1]/body[1]/div[1]/div[1]/section[1]/div[1]/a[2]",
      "description": "GitHub link in the SNS & Links section",
      "method": "click",
      "arguments": []
    }
  ],
  "actionDescription": "GitHub link in the SNS & Links section",
  "message": "Action [click] performed successfully on selector: ..."
}
```

### 実際のログ比較

**1回目**（LLM 呼び出しあり）:
```
INFO: response
    category: "aisdk"
    response: { "object": { "elementId": "0-29", ... }, "usage": { "inputTokens": 1508, ... } }
```

**2回目**（キャッシュヒット、LLM 呼び出しなし）:
```
INFO: act cache hit
    category: "cache"
    instruction: "Click the GitHub link"
    url: "https://cfe.jp/"
```

### 注意点

- **対象は `act()` のみ** — `extract()` と `observe()` はキャッシュされない（毎回 LLM を呼ぶ）
- **キャッシュキー**: instruction の文字列 + URL の組み合わせでハッシュを生成
- **キャッシュの無効化**: サイトの DOM 構造が変わったらキャッシュを削除して再生成する
  ```bash
  rm -rf .cache/cfe-test
  ```
- **ワークフロー別にディレクトリを分ける** のが推奨:
  ```typescript
  cacheDir: ".cache/login-flow"
  cacheDir: ".cache/checkout-flow"
  ```
- CI/CD で結果を安定させたい場合、キャッシュディレクトリをバージョン管理にコミットする手もある

### キャッシュ利用時は act() 後のアサーションが必須

`act()` の `success` は「キャッシュされたセレクタで要素をクリックできたか」しか見ない。キャッシュが破損していたり、サイトの DOM が変わってセレクタがずれた場合、**間違った要素を操作しても `success: true` が返る**。エラーにならず静かに誤動作するため、`act()` の後には必ず遷移先やページ状態のアサーションを入れるべき。

```typescript
// NG: act() の success だけを信頼する
const result = await stagehand.act("Click the GitHub link");
assert(result.success); // キャッシュが壊れていても true になりうる

// OK: act() 後に遷移先を検証する
await stagehand.act("Click the GitHub link");
await new Promise((resolve) => setTimeout(resolve, 2000));

const allPages = stagehand.context.pages();
const githubPage = allPages.find((p) => p.url().includes("github.com"));
assert(githubPage, "GitHub page should have opened");
```

実際にキャッシュ JSON のセレクタを `a[2]`（GitHub）→ `a[4]`（SlideShare）に書き換えてテストしたところ:
- `act()` は `success: true` を返した（クリック自体は成功）
- しかし開いたのは `https://www.slideshare.net/junichiishida`（GitHub ではない）
- 遷移先のアサーションで **FAILED** を検出できた

### 参照ドキュメント

- [Caching Best Practices](https://docs.stagehand.dev/v3/best-practices/caching) — 公式キャッシュガイド

## セルフヒール + ビジュアルリグレッション検知

`act()` のキャッシュが壊れた（セレクタがずれた）場合、自動的にキャッシュを削除して LLM で再判定する「セルフヒール」機能を実装している。ただし、ページ自体が視覚的に崩壊している場合はセルフヒールせず即座に FAIL とする。

### 仕組み

1. **初回実行**: テスト成功時にスクリーンショットを `baselines/` に保存
2. **2回目以降**: `act()` の前に現在のページを撮影し、`pixelmatch` でベースラインと比較
3. **ビジュアル差異が大きい**（10% 超）→ ページが崩壊しているため **即 FAIL**（diff 画像を保存）
4. **ビジュアル差異が小さい** + `act()` のアサーション失敗 → **セルフヒール発動**:
   - 間違って開いたタブを閉じる
   - `.cache/cfe-test/` のキャッシュを削除
   - ページを再読み込みし、LLM で再判定して `act()` をリトライ
5. **セルフヒール成功** → PASS（新しいキャッシュが自動生成される）
6. **セルフヒール失敗** → FAIL

```
フロー図:

  ページスクリーンショット撮影
         │
    ベースライン存在？ ── No ──→ 初回: そのまま act() 実行
         │ Yes
    pixelmatch で比較
         │
    差異 > 10% ? ── Yes ──→ FAIL (ビジュアルリグレッション)
         │ No
    act() + アサーション
         │
    アサーション OK? ── Yes ──→ PASS (ベースライン更新)
         │ No
    セルフヒール: キャッシュ削除 → 再試行
         │
    リトライ OK? ── Yes ──→ PASS
         │ No
         └──→ FAIL
```

### 使用ライブラリ

- **[pixelmatch](https://github.com/mapbox/pixelmatch)**: ピクセル単位の画像比較ライブラリ（依存なし、~150行）
- **[pngjs](https://github.com/lukeapage/pngjs)**: PNG の読み書き

### 実際の動作ログ

キャッシュの xpath セレクタを `a[2]`（GitHub）→ `a[4]`（SlideShare）に書き換えてテストした場合:

```
[Test 5] Clicking the GitHub link using act() ...
  Pre-click screenshot: screenshots/05a-before-click.png
  Visual diff against baseline: 0.00%    ← ページは正常
  Page looks visually OK.
  act cache hit                           ← 壊れたキャッシュを使用
  GitHub page not found after act(). Attempting self-heal...
  Cache cleared.                          ← キャッシュ削除
  Retrying act() without cache...         ← LLM で再判定
  Self-heal SUCCEEDED: GitHub page opened on retry.
[Test 5] PASSED: GitHub page opened.
```

### ベースラインの管理

- `baselines/` ディレクトリにテスト成功時のスクリーンショットが保存される
- ベースラインはバージョン管理にコミットしておくと、CI/CD でも使える
- ビューポートサイズ固定（1280x720）で比較の安定性を確保
- 閾値 `VISUAL_DIFF_THRESHOLD = 0.10`（10%）はコード内で調整可能

### diff 画像

ビジュアルリグレッションが検出された場合、差異箇所を赤くハイライトした diff 画像が `screenshots/05a-diff.png` に保存される。

## 注意: v3 API のハマりポイント

### `extract()` は位置引数スタイル

v3 の `extract()` は **位置引数** を取る。ネット上の古い例やドキュメントでは `extract({ instruction, schema })` というオブジェクト引数スタイルが紹介されていることがあるが、v3 (3.0.8) では以下が正しい:

```typescript
// OK: 位置引数
const data = await stagehand.extract("instruction here", zodSchema);

// NG: オブジェクト引数（schema が無視され pageText のみ返る）
const data = await stagehand.extract({ instruction: "...", schema: zodSchema });
```

### `model` の指定が必要

コンストラクタで `model` を指定しないと、`act()` / `extract()` / `observe()` で LLM が呼び出されず、期待した結果が得られない場合がある:

```typescript
const stagehand = new Stagehand({
  env: "LOCAL",
  model: "openai/gpt-4o",  // 必須
});
```
