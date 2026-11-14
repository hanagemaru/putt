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

## 2026-11-13 検証結果

- [x] `npm ci` とサブパスのビルドが成功
- [x] `verify:hub-preview` でViteアセット・PWA manifest・Service Workerを検証
- [x] 独立Worker `putt-hub-preview` へのデプロイ成功
- [x] 新URLでHTTP 200、JS配信・manifest・SW・noindexを検証
- [x] `/games/putt/play/api/health` でD1不在、ランキング書き込みが503になることを検証
- [ ] iPhoneでのゲーム操作・9ホール・PWAインストール/オフライン（利用者実機での確認待ち）
- [ ] hanage.app本番への経路設定（フェーズ3のため未実施）

成功したActions: https://github.com/hanagemaru/putt/actions/runs/43437337388

## ランキングの検証（2026-11-14追加）

- プレビューでは`VITE_RANKING_DEFAULT_MOCK=true`。ランキング画面・初回の名前入力・自己ベスト更新時の登録フローは、端末内だけの**テストデータ**として動く。
- 本番D1をつながず、`?ranking=api`を指定してもモックを返す。誤登録を防ぐ。
- トップ・ランキング画面に「テストデータ」表示を置く。
- `?ranking=off`でプレビューのランキングを隠せる。
- `scripts/verify-hub-api.ts`で`putt.hanage.app/api/*`と`hanage.app/games/putt/play/api/*`の両方が同じWorkerで処理され、プレビューでは書き込み拒否になることを検証する。
- 実際のD1で登録・取得・削除を行う統合テストは未実施。独立したステージング用DBを作るか、ローカルD1で安全に確認してから本番接続する。

### 旧ドメインからの記録移行

**サーバー:** 本番時にPuttの従来と同じD1をバインドすれば、既存のランキング板・登録記録はそのまま利用できる。新しいDBへのコピーは原則不要。ただし認証用の匿名ID+秘密鍵は旧サブドメインのlocalStorageにあり、ゲームを`hanage.app`へ移すだけでは自分の過去の記録としてアクセスできない。

**端末:** `putt-player-identity-v1`（ID・秘密鍵）、`putt-player-name`、`putt-tour-best-*`（自己ベスト）、`putt-pending-submission`（送信保留）などは`putt.hanage.app`と`hanage.app`で自動共有されない。プレビューのモックデータは別の`workers.dev`オリジンに隔離されている。

移行案:
1. **推奨:** 旧Putt上で利用者が「記録を引き継ぐ」を明示的に選び、認証情報を移行先へ渡す。`postMessage`等を使う場合は送受信元の厳密なOrigin検証、ユーザー操作、期限/一度限りの交換、通信中の認証情報漏えい防止、モバイルSafari/PWA実機確認が必要。実装は本番接続前にセキュリティレビューする。
2. 暫定対応として旧サイトを維持し、過去記録を旧サイトで確認できるようにする。新しいゲームで生成されたIDを既存のプレイヤーと同一とみなしてはいけない。
3. URL変更だけを理由に旧ローカルストレージやD1の記録を削除しない。本人の意図しない自動上書き・二重登録を避ける。

切り替え判定の必須条件: 実データの同一プレイヤー識別、自己ベスト、名前、登録・表示・削除を実機で確認するまで本番のゲーム導線を新URLに切り替えない。

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
