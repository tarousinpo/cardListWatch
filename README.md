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
    - cron: '*/10 * * * *'   # ← ここを変更（cron 書式）
```

例:
- `*/5 * * * *` → 5 分ごと
- `0 * * * *`   → 1 時間ごと

> **注意**: GitHub Actions の `schedule` は最短 5 分間隔です。

---

## 最新セット判定ロジック / Latest-set heuristic

`scripts/check.js` はカードリストページの HTML をスキャンし、  
`{名前}【UA{N}BT】` 形式のパターンを検索します。  
**数値 N が最大のエントリ**を「最新セット」と判定します。  
（例: UA48BT と UA49BT が存在する場合 → UA49BT が最新）

---

## サイトへの配慮 / Polite crawling

- 1 回の実行につき **1 リクエストのみ**送信します。
- `User-Agent` に監視ツールである旨と GitHub リポジトリ URL を含めています。
- 連続した高頻度アクセスは行いません（GitHub Actions の cron が 10 分以上の間隔を保証します）。

---

## ファイル構成 / File structure

```
.
├── .github/
│   └── workflows/
│       └── check.yml        # スケジュール実行ワークフロー
├── docs/
│   ├── index.html           # GitHub Pages UI
│   └── status.json          # 最新ステータス（ワークフローが更新）
├── scripts/
│   └── check.js             # メインチェックスクリプト
├── package.json
└── README.md
```
