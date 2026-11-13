# hanage.app配下 Putt /games/putt/play/ の検証

作成: 2026-11-13（フェーズ1〜2）。本番切り替えは別フェーズ。

## 構成

- `hanagemaru/putt` を維持。ハブにソースを取り込まない。
- 検証用Worker `putt-hub-preview` に `/games/putt/play/` 配下で配信する。本番 `putt` / `hanage-hub` Workersには触れない。
- 検証URL候補: `https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/`。Actionsと実際のHTTPで確認するまで確定としない。
- ビルドベース: `PUTT_BASE=/games/putt/play/`。Static Assetsは `assets.base_path=/games/putt/play`。
- `wrangler.hub-preview.jsonc` にD1バインディングは**ない**。ランキング記録を本番に書き込ませない。
- プレビューは `VITE_GAMEPLAY_ANALYTICS=false`、`VITE_RANKING_API_ENABLED=false`。Web Analyticsのトークンも注入しない。
- プレビュー専用ビルドに `X-Robots-Tag: noindex, nofollow` を追加する。URL自体は公開されるため秘密情報を置かない。
- `main` へのマージ・本番配信・Cloudflareルート設定はこのフェーズではしない。

## 自動検証

1. `npm ci`、`npm run build:hub-preview`、`npm run verify:hub-preview`。
2. Wrangler 4.148.0以上で `wrangler.hub-preview.jsonc` を別Workerへ配信。
3. HTML、JS、manifest、Service Worker、noindex、API health、D1不在、書き込み不可をHTTPで確認。
4. 合格後、iPhone Safariでメニュー、コース開始、操作、完走、戻る、ホーム画面追加、オフラインを実機確認。Androidは必要に応じて確認する。

## 本番切り替え前の未解決事項

- `hanage.app/games/putt/play/*` のWorker Routeと既存Custom Domainとの優先順位・競合
- 本番APIへの接続、D1バインド、CSRF/Originチェック、ランキング表示・登録
- `putt.hanage.app` と `hanage.app` でlocalStorageは共有されない。本人識別・自己ベスト引き継ぎ方針
- PWAのインストールやオフライン更新、canonical/検索インデックス、プライバシー文面
- 旧URL `putt.hanage.app` の維持と切り戻し手順

プレビュー成功はAdSense承認を意味しない。
