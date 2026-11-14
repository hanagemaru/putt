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

## 本番公開前に残ること

1. Chromium/WebKitで旧サイトの告知とリンク、モックランキングのCIが通ること。
2. Cloudflareの本番`hanage.app/games/putt/play/*`配信Routeと既存Custom Domain/ハブWorkerの優先順位・競合を確認する。
3. **実本番ランキングD1の共有**を新Workerで設定し、同じコース板・旧プレイヤーの記録が新URLの総合順位に表示されることを確認する。新URLは別プレイヤーとして動くこと、既存プレイヤーを上書きしないことも確認する。
4. iPhone Safari/PWAで旧サイトを従来どおりプレイでき、新サイトでも問題なくプレイできることを確認。
5. 旧サイトの新URL案内は新URLとランキング共用が本番で確認できてから有効化し、ハブのゲーム導線を切替える。旧URLは無期限に維持する方針（将来の別判断を除く）。
6. 回帰やルート不具合ならハブリンク/新Worker Routeを戻し、旧サイト・同じD1を使って継続する。

## 履歴（現在の方針では不要になった試作）

2026-11-14に別Origin間の`postMessage`を使う明示的な認証引き継ぎを作り、Chromium/WebKitで検証成功（[履歴のActions](https://github.com/hanagemaru/putt/actions/runs/43591313342)）。**この方式はユーザーの決定により不採用となり、現行ブランチの配信内容には含めない。**

Puttの作業用PR: https://github.com/hanagemaru/putt/pull/117
