# cardListWatch

Union Arena のカードリストを定期的に監視し、最新弾が変わったときに Discord へ通知します。  
GitHub Pages に現在検出中の最新セット情報を公開します。

---

## 概要 / What it does

| 機能 | 詳細 |
|---|---|
| **定期チェック** | GitHub Actions が 10 分ごとに Union Arena 公式カードリストを 1 リクエストだけ取得し、最新セットのプロダクトコード（例: `UA49BT`）を確認します。 |
| **Discord 通知** | 前回と比較して最新セットが変わった場合、Discord Webhook で通知します。 |
| **GitHub Pages UI** | `docs/` 以下を Pages で公開。現在の最新セット名・コード・最終確認日時・カードリスト URL を表示します。 |

---

## セットアップ / Setup

### 1. Discord Webhook URL を登録する

1. Discord サーバーのチャンネル設定 → **連携サービス** → **Webhook** → **新しいウェブフック** を作成。
2. Webhook URL をコピーする。
3. GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** を開く。
4. 名前 `DISCORD_WEBHOOK_URL`、値に上記 URL を貼り付けて保存。

> 最新セットに変化がなければ通知は送られません。  
> 初回実行時は「新規作成」として扱われ、通知は送信されません（意図した動作です）。

### 2. GitHub Pages を有効にする

1. リポジトリの **Settings → Pages** を開く。
2. **Source** を `Deploy from a branch` に設定。
3. **Branch** を `main` / `/(root)` → `/docs` フォルダに変更して保存。
4. しばらく待つと `https://<user>.github.io/cardListWatch/` で UI が確認できます。

### 3. ワークフローが有効になっていることを確認

リポジトリの **Actions** タブを開き、`Check Union Arena Card List` ワークフローが表示されていれば完了です。

---

## チェック間隔の変更 / Changing the schedule

`.github/workflows/check.yml` の `cron` 行を編集します。

```yaml
on:
  schedule:
    - cron: '*/5 * * * *'   # ← ここを変更（cron 書式）
```

例:
- `*/5 * * * *` → 5 分ごと
- `0 * * * *`   → 1 時間ごと

> **注意**: GitHub Actions の `schedule` は最短 5 分間隔です。

---

## ローカル 1 分ポーリング / Local 1-minute polling (macOS)

カードリスト更新が予想される日に限り、MacBook から 1 分ごとに同じチェッカーを実行できます。

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
  bash scripts/local-poll.sh
```

詳細は [docs/local-poller.md](docs/local-poller.md) を参照してください。

---

## 最新セット判定ロジック / Latest-set heuristic

`scripts/check.js` はカードリストページの HTML をスキャンし、すべてのプロダクトコードを収集します。  
検出された全コードは `docs/status.json` の **`known_codes`** フィールドに蓄積されます。

### 変更検出
前回の実行時に保存した `known_codes` と今回取得したコードを比較し、  
**差分（新規コード）があれば最新弾の更新として Discord 通知を送信します。**

これにより、通常の番号付きブースターパック（例: `UA50BT`）だけでなく、  
番号体系が異なる強化拡張弾（例: `EX02BT`、`UA-EX02BT`、`ST-16`）も確実に検出できます。

### 対応パターン
| ゲーム | 標準コード | 拡張コードの例 |
|---|---|---|
| Union Arena | `UA##BT` | `EX02BT`、`UA-EX01BT` など 【】内の英数字コード |
| ワンピースカードゲーム | `OP-##` | `ST-##`（スターターデッキ）、`EB-##`（エクストラブースター）など |
| ガンダムカードゲーム | `GD-##` | `GD-EX##` など []内の英数字コード |

### `latest_code` について
画面表示・後方互換のために、**最も番号が大きい標準ブースターパック**のコードを  
`latest_code` / `latest_name` として保持します。  
（強化拡張弾が検出された場合でも `latest_code` は標準弾の最大値のままですが、  
`new_codes` フィールドに検出された新規コードが記録されます。）

---

## サイトへの配慮 / Polite crawling

- 1 回の実行につき **1 リクエストのみ**送信します。
- `User-Agent` に監視ツールである旨と GitHub リポジトリ URL を含めています。
- 連続した高頻度アクセスは行いません（GitHub Actions の cron が 5 分間隔を保証します）。

---

## ファイル構成 / File structure

```
.
├── .github/
│   └── workflows/
│       └── check.yml        # スケジュール実行ワークフロー
├── docs/
│   ├── index.html           # GitHub Pages UI
│   ├── local-poller.md      # ローカルポーラー手順書
│   └── status.json          # 最新ステータス（ワークフローが更新）
├── scripts/
│   ├── check.js             # メインチェックスクリプト
│   └── local-poll.sh        # ローカル 1 分ポーリングスクリプト
├── package.json
└── README.md
```
