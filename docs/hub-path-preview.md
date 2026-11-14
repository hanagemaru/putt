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

## 実利用と移行規模の確認（2026-11-14 13:07 JST）

Cloudflare D1の本番`gameplay_events`と`players`/`records`に、読み取り専用SQLを実行した結果：

| 指標 | 直近7日 | 直近30日 |
| --- | ---: | ---: |
| 訪問（30分単位のタブセッション） | 2 | 36 |
| 初打まで到達したセッション | 0 | 15 |
| ラウンド完了イベントがあるセッション | 0 | 9 |

- 直近7日より前の7日間の訪問は19。
- 累計登録プレイヤーIDは44、スコアのあるIDは41、スコア記録は69件。
- 直近30日で新記録を登録したプレイヤーIDは4。
- 最も古い計測イベントは2026-10-26 JST。30日値は利用開始以降のデータが実質的な下限。
- **人数や総ラウンド回数は測れない**。複数タブ・再訪は別訪問、同じタブ内の再挑戦は重複除外。登録IDも実人数とは限らない。
- 集計スクリプト：`scripts/report-gameplay-activity.mjs`（SELECTのみ、個人識別子を出力しない）。

### 判断

現在のアクティブ利用は小規模だが、過去のランキング記録を維持する方針は変更しない。
旧ドメインは当面維持し、新ドメインから過去のランキング登録者へ**任意の移行**を提供する。利用者全員の自動移行は行わない。

`src/legacy-data-migration.ts` は転送可能なローカルデータの抽出・検証・**既存データ衝突時の書き込み拒否**を担当する検証用モジュール。テストは `scripts/verify-legacy-migration.ts`。
ランキングの匿名認証鍵はURLやログに入れず、通信するなら相互の厳密なOrigin確認と利用者の明示操作が必須。このプロトコルとUI、旧サイトへの配信は**未実装**であり、プレビュー検証だけで本番引き継ぎ可能とは扱わない。

## オプトイン引き継ぎのUI試作（2026-11-14）

- 旧Putt `putt.hanage.app/?legacyHandoff=1` は、引き継ぎ要求があるときだけ「記録を移す」ボタンを表示する。
- 新Putt `hanage.app/games/putt/play/` のメニューには「以前の記録を引き継ぐ」を表示する。
- 両方のサイトが同じPuttの新コードで提供されて初めて有効になる。**現在の検証プレビュー (`workers.dev`) や本番旧Puttでは動作しない**。
- `src/legacy-handoff.ts` は `postMessage` の送信元/送信先Originを `https://putt.hanage.app` と `https://hanage.app` に固定し、送信元Windowと一回限りの乱数を照合する。
- 移行対象はランキング認証情報・表示名・自己ベスト・途中進行・パター調整のみ。送信保留とモックデータは移さない。**認証情報をURL/クリップボード/サーバーログに渡さない**。
- 新Puttに既存のデータがあれば自動上書きはせず中止する。失敗しても旧Puttの記録は削除しない。
- iOSでの別タブ/ポップアップとPWAの制約、PWAキャッシュ、認証情報の再利用は本番配信前にセキュリティレビューと実機確認が必要。
- 現時点ではブランチ上の試作であり、引き継ぎのE2E検証は**未完了**。旧サイトの新コード反映は別承認が必要。


## 2026-11-14: G2/G3の自動検証が成功（本番未変更）

成功したGitHub Actions: https://github.com/hanagemaru/putt/actions/runs/43590970005

- [x] 本番とは別の `putt-legacy-preview`（旧URL相当）と `putt-hub-preview`（新URL相当）を個別Workerとしてデプロイ
- [x] 旧環境 `https://putt-legacy-preview.jibunnha.workers.dev/` と新環境 `https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/` の**異なるHTTPSオリジン**間で、ブラウザによる同意・データ受け渡しを実証
- [x] 同意前の転送禁止、旧データ不変、新サイトの別IDとの衝突時の非上書き/部分書き込み禁止、openerの無い旧サイトからの転送禁止をChromiumで自動テスト
- [x] 既存のPuttスキーマを適用した**一時的なローカルD1**で、旧・新APIパス間のランキング取得、登録、重複登録防止、表示名変更、認証情報の検証、登録削除を実際のWorker経由でテスト。CI成功後にローカル環境は破棄
- [x] プレビュー両Workerには本番D1バインディングは存在しない。アナリティクス送信も無効化
- [ ] iPhone Safari（通常タブ・PWA）で別タブ/ウィンドウ引き継ぎと元記録維持の実機確認
- [ ] 本番ZoneのRoute競合テスト、本番D1への旧新両オリジンでの接続確認（**本番公開前**）

### ユーザー実機確認の操作

1. iPhone Safariで `https://putt-legacy-preview.jibunnha.workers.dev/` を開き、**「引き継ぎ用テスト記録を作る」**を押す。画面の記録は架空のテストデータ。
2. Safariの別タブで `https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/` を開き、**「以前の記録を引き継ぐ」**を押す。
3. 自動で開いた旧プレビュー画面で **「記録を移す」**を押し、新プレビューの画面へ戻る。
4. 新プレビューでテストの表示名・自己ベストが引き継がれ、旧プレビューにも記録が残っていることを確認する。
5. もし新プレビューに以前のモックランキング試験の保存データがあり、**「上書きせずに中止」**と表示された場合は安全保護が動いている。成功フローを検証したい場合は、両プレビューを**同じSafariプライベートブラウズのセッション**で1から試す（通常の本番サイトには触れない）。
6. iPhoneホーム画面に追加したPWAからの引き継ぎは別途確認。ブラウザによってポップアップのopenerが使えない場合は、現状の方式を採用せず代替手段を設計する。

**注意:** この検証は架空ID・架空スコアを使う。本当の`putt.hanage.app`からデータを読み出す機能はまだ公開していないため、**本番の記録の移動はできない**。

### 今後の取り組み

- iPhone実機結果を確認し、安全な引き継ぎUI・操作手順を確定する。
- 既存`putt`の本番Workerのデプロイ設定に移行用UIを追加する前に、スキーマ共有・既存ランキングの連続性・現行PWAと両方の旧URLの稼働を確認。
- Putt本番が安定したら、同じゲート（旧URLを維持・ユーザーの同意・スコアDB継続・新旧並行）をMulticolor Sweeperにも適用。
