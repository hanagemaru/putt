# Puttをhanage.app配下に追加する検証

更新日: 2026-11-14
**現行方針:** 旧URLを維持し、新URLを追加する。**手動の記録引き継ぎ機能は採用しない**。詳細は[ハブ共通計画](https://github.com/hanagemaru/hanage-hub/blob/plan/putt-hub-path-20261113/docs/GAME_URL_AND_PLAYER_MIGRATION_2026-11-14.md)。

## 提供するURL

| 種類 | URL | 状態 |
| --- | --- | --- |
| 既存の本番Putt | https://putt.hanage.app/ | 維持、現時点で変更なし |
| 新本番Putt（追加予定） | https://hanage.app/games/putt/play/ | 未公開 |
| 旧URL相当プレビュー | https://putt-legacy-preview.jibunnha.workers.dev/ | 別Worker、モックランキング |
| 新URL相当プレビュー | https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/ | 別Worker、モックランキング |

**注意:** 2つのプレビューには本番D1を接続していない。プレビューでランキングUIを見られても、新旧で本番スコアを共有していることにはならない。

## ユーザーとランキングの扱い

- 本番新URLを公開するときは、**旧サイトと新サイトでPuttの既存D1 `putt-ranking`を共有する**。旧スコアは新URLで表示される。
- 旧URLのゲーム・PWA・名前・自己ベスト・匿名ID・スコア登録を維持する。強制リダイレクトしない。
- `localStorage`は旧ドメインと新ドメインで別々。旧サイトのランキング記録は新サイトの一覧にも載るが、新サイトから「自分の過去の記録」として操作できない。新URLでプレイすると別の匿名IDになる。
- 一人が両方のURLから登録すると、ランキング上は別プレイヤーとして扱われ得る。それを承知した運用とし、**ユーザーに引き継ぎ操作を依頼しない**。
- `src/legacy-handoff.ts`と関連データ移行試作、転送用UI、E2Eスクリプトは作業ブランチから撤去した。2026-11-14に行った旧→新の認証転送試験は過去の調査結果であり、現行の完了ゲートではない。

## 旧サイトに設置する告知

実装: `src/entry.ts`の通常メニュー（旧Puttだけ）。`VITE_LEGACY_NEW_SITE_URL`を**本番の旧サイト用ビルドに明示指定したときのみ**表示する。新URLの公開が確定するまでは表示しない。

> 新しいPuttも公開しています。こちらのPuttも引き続き遊べます。
>
> ランキングの記録は新旧共通ですが、プレイヤーIDや端末内の自己ベストはURLごとに別管理です。
>
> 新しいPuttで遊ぶ

プレビューの旧サイトは`https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/`へのリンクを設定済み。**プレビューはモックデータでランキングを共有しない**ことを別の説明文に表示する。

## 技術検証・安全性

- `PUTT_BASE=/games/putt/play/`、PWA manifest/scopeとSW、Worker `assets.base_path=/games/putt/play`を一致させる。
- `src/server/worker.ts`は`/api/*`と`/games/putt/play/api/*`を両方処理する。
- 既存`putt`とプレビューWorkerは別。`wrangler.hub-preview.jsonc`、`wrangler.legacy-preview.jsonc`には本番D1をバインドしない。ビルド時`VITE_RANKING_DEFAULT_MOCK=true`、計測無効、noindex。
- `scripts/verify-hub-ranking-local.ts`と`wrangler.hub-local-ranking.jsonc`で一時的なローカル専用D1に対し、**旧新のAPIパスを使って同じ板で登録・取得・名前変更・不正認証拒否・削除・二重登録防止**を実通信で検証する。本番D1への書き込みは行わない。
- `scripts/verify-legacy-notice-browser.mjs`をChromium/WebKitで実行し、旧サイトの案内・新URLリンク・旧サイトのゲーム入口維持・別オリジンlocalStorageを確認する。
- ユーザーは新プレイURLのゲーム挙動とモックランキングの画面表示を実機で確認済み（2026-11-14）。

## 2026-11-14: 本番Route調査と既存D1の共用検証

### 本番ルーティングの読み取り専用監査

[Cloudflare本番API監査の成功Actions](https://github.com/hanagemaru/putt/actions/runs/43594376873)（2026-11-14 21:23 JST頃）:

- `hanage.app`のZoneはactive。Worker Custom Domainは`hanage.app`と`www.hanage.app`が`hanage-hub`、`putt.hanage.app`が`putt`、`mcsweeper.hanage.app`が`multicolor-sweeper`。
- **現在のZone Worker Routesは0件**。新Putt用Routeの重複/競合は現時点でない。
- `hanage.app/`と`hanage.app/games/putt/`はHTTP 200。新URL `hanage.app/games/putt/play/`と同APIのhealthは現在HTTP 404で未使用。
- [CloudflareのRouteがCustom Domain Workerより前に動く仕様](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)と[assets.base_path](https://developers.cloudflare.com/workers/static-assets/routing/advanced/serving-a-subdirectory/)から、専用RouteでPuttを提供する設計は成立。
- `wrangler.hub-production.jsonc`で**別Worker名`putt-hub`、2つのRoute（末尾スラッシュ有無対応）、既存の`putt-ranking` D1 binding**を指定。Wrangler 4.148.0で`--dry-run`成功。ビルド済みアセット・Route/D1設定を認識したが、実際のZoneにRouteは作成していない。
- `www.hanage.app`は別Custom Domainとして存在する。新Putt配信パスをwwwから開いたときのcanonical/リダイレクトは本番公開前に対応を確定する。

### 別Workerから本番D1の実ランキング照合（読み取り専用）

[実ランキング照合の成功Actions](https://github.com/hanagemaru/putt/actions/runs/43595040164)（2026-11-14 21:29 JST頃）:

- Worker `putt-hub-d1-ro-audit-<CI run ID>`を`workers.dev`へ**一時的にのみ**公開。Zone Routeは一切設定せず、Putt既存D1`putt-ranking`をバインド。
- 安全のため、GETの匿名ランキングとhealthだけ通し、Authorization/Cookieを破棄、POST/PUT/DELETE/analyticsなどの書き込みAPIはHTTP 405で拒否。
- 従来の`putt.hanage.app/api/rankings`と別Workerの`/games/putt/play/api/rankings`を4コース比較。**表示するランキングの行・人数が一致**した：
  - BEGINNER 35件
  - STANDARD 16件
  - ADVANCED 8件
  - EXPERT 10件
- 一時Workerの**削除成功をCIで確認**。本番D1へのテスト書き込み・本番Workerへの新Route・旧サイトへの変更なし。
- これにより**本番D1の別Workerからの共用読み取りは実証済み**。ただし実際の`hanage.app`のRoute経由でのAPI通信・本番書き込みは未検証。

## 本番公開前に残ること

1. Chromium/WebKitで旧サイトの告知とリンク、モックランキングのCIが通ること。
2. Cloudflareの本番Routeの**設定・公開後のHTTP動作**を確認する。現在の設定の読み取り専用監査とWranglerのdry-runは完了。
3. **本番D1の共用読み取りは別Workerで実証済み**。本番Zoneの新URLで同じ記録が表示され、新URLの別IDとして登録/名前変更/削除が動くことを公開後に確認する。新URLは別プレイヤーとして動くこと、既存プレイヤーを上書きしないことも確認する。
4. iPhone Safari/PWAで旧サイトを従来どおりプレイでき、新サイトでも問題なくプレイできることを確認。
5. 旧サイトの新URL案内は新URLとランキング共用が本番で確認できてから有効化し、ハブのゲーム導線を切替える。旧URLは無期限に維持する方針（将来の別判断を除く）。
6. 回帰やルート不具合ならハブリンク/新Worker Routeを戻し、旧サイト・同じD1を使って継続する。

## 履歴（現在の方針では不要になった試作）

2026-11-14に別Origin間の`postMessage`を使う明示的な認証引き継ぎを作り、Chromium/WebKitで検証成功（[履歴のActions](https://github.com/hanagemaru/putt/actions/runs/43591313342)）。**この方式はユーザーの決定により不採用となり、現行ブランチの配信内容には含めない。**

Puttの作業用PR: https://github.com/hanagemaru/putt/pull/117
