# デプロイ手順

## 現在の配信

- 本番: Cloudflare Workers（Static Assets）で `https://putt.hanage.app/`
  - Workerの既定URL: `https://putt.jibunnha.workers.dev/`
- 退避先: GitHub Pages（`https://hanagemaru.github.io/putt/`）

`main` への push で**両方に**自動デプロイされる。GitHub Pages は切り替え直後の
退避先として当面残しており、様子を見てから止める。

Cloudflareへのデプロイは、リポジトリ変数 `CLOUDFLARE_DEPLOY` が `true` のときだけ実行される。

## ベースパス

配信先でベースパスが変わるので、`vite.config.ts` は環境変数で切り替える。

| 配信先 | ベース | ビルドコマンド |
| --- | --- | --- |
| GitHub Pages | `/putt/`（既定） | `npm run build` |
| Cloudflare Workers | `/` | `npm run build:cloudflare` |

`npm run build:cloudflare` は `PUTT_BASE=/` を渡すだけで、他は同じビルド。

PWAのマニフェストとアイコンも同じベースに追従する。詳細は `docs/pwa.md`。

## D1（ランキングの保存先）

| 項目 | 値 |
| --- | --- |
| データベース名 | `putt-ranking` |
| ロケーション | APAC（**後から変えられない**） |
| バインディング | `DB`（`wrangler.jsonc` の `d1_databases`） |
| スキーマ | `migrations/` の連番SQL（`0001_ranking.sql` ほか） |

適用は **Actions の `Apply D1 migrations` を手で実行**（`dry: true` で未適用の一覧だけ見られる）。
手元は `npm run db:migrate:local`。デプロイには混ぜていない
（表の作り直しを含む移行を、気づかないうちに流さないため）。
**スイーパーのD1とは別物**で、記録も消し方も分かれている。

## 記録の検証と `flagged` の扱い

リプレイ検証（`scripts/verify-records.ts`）は6時間ごとに走り、`pending` の記録を
**ゲーム本体と同じ物理で再生**して打数を突き合わせる。

| 状態 | 板 | 誰が付けるか |
| --- | --- | --- |
| `pending` | 載る | 登録した瞬間（Worker） |
| `verified` | 載る | 再生と一致（バッチ） |
| `flagged` | **載ったまま** | 再生と不一致（バッチ）。**人の判断待ち** |
| `suspicious` | **外れる** | 人が黒と決めたときだけ（手で書く） |

**機械の判定だけで記録を板から外さない。** 物理の版ずれや端末差で
ちゃんと遊んだ人の記録が黙って消えるほうが、嘘が1件混じるより悪い。

`flagged` が出るとバッチが**わざと失敗する**ので、定期実行の `Verify ranking records` が
赤くなり、GitHubから持ち主へメールが届く。実行結果の Summary に板・プレイヤー・理由が出る。

中身を見る（`<player>` と `<board>` は Summary の表から）。

```sh
npx wrangler d1 execute putt-ranking --remote --json --command \
  "SELECT board_id, total_strokes, hole_strokes_json, shots_json FROM records
   WHERE verification_status = 'flagged'"
```

判断して書き換える。**どちらかを必ず書く**（放っておくと次のバッチでも赤いまま）。

```sh
# 問題なし（板にそのまま残す）
npx wrangler d1 execute putt-ranking --remote --command \
  "UPDATE records SET verification_status = 'verified', updated_at = CURRENT_TIMESTAMP
   WHERE player_id = '<player>' AND board_id = '<board>'"

# クロ（ここで初めて板から外れる）
npx wrangler d1 execute putt-ranking --remote --command \
  "UPDATE records SET verification_status = 'suspicious', updated_at = CURRENT_TIMESTAMP
   WHERE player_id = '<player>' AND board_id = '<board>'"
```

もう一度判定し直したいときは `pending` に戻せば、次のバッチが再生する。

**物理・罰打・カップ判定・コース生成の数値を変えたら
`CONFIG.game.ranking.rulesVersion` を上げること。** 版は板IDに入るので、
上げれば古い記録は古い板に残り、新しい板と混ざらない。上げ忘れると、
古い記録が新しい規則で再生されて打数が合わず `flagged` が並ぶ（消えはしないが、
人が判断する手間だけが増える）。

`database_id` は `wrangler.jsonc` に平文で置いてよい。**これだけでは誰も触れず**、
読み書きには Cloudflare アカウントの認証（Actions の `CLOUDFLARE_API_TOKEN`）が要る。

## 設定済みのシークレットと変数

`hanagemaru/putt` の Settings → Secrets and variables → Actions に登録済み。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit を含むトークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID |
| Variable | `CLOUDFLARE_DEPLOY` | `true` |
| Variable | `PUTT_SMOKE_URL` | `https://putt.hanage.app/` |

`PUTT_SMOKE_URL` を設定すると、デプロイ後にそのURLを取得して生存確認する。
`CLOUDFLARE_DEPLOY` は文字列 `true` と厳密に比較するので、大文字では動かない。

## 切り替えの記録（2026-09-06 完了）

1. 上記のシークレットと `CLOUDFLARE_DEPLOY=true` を登録
2. Actions から `Deploy to Cloudflare Workers` を手動実行し、
   `https://putt.jibunnha.workers.dev/` で表示を確認
3. Cloudflare の Workers & Pages → `putt` → Domains で `putt.hanage.app` を追加
4. `https://putt.hanage.app/` を実機（iPhone）で確認。トップメニュー →
   通常ツアー → コース選択 → プレイ、遊び方・プライバシーのリンクまで動作
5. `PUTT_SMOKE_URL` を登録
6. `hanage-hub` の `src/lib/site.ts` の `GAME_URLS.putt` を新URLへ差し替え

### 残っている作業

- しばらく様子を見てから、GitHub Pages のワークフロー（`.github/workflows/deploy.yml`）を止める。
  止めたら `TASKS.md` と `docs/tour-hole-candidates.md` に残る `github.io` のリンクも差し替える

## ブランチのプレビュー（Cloudflare）

`main` 以外へ push すると、`Preview on Cloudflare Workers`
（`.github/workflows/preview-cloudflare.yml`）が動く。
`wrangler versions upload` でバージョンを上げるだけなので、**公開中の
`putt.hanage.app` は差し替わらない**。プレビューURLは Actions の実行結果の
Summary に出る。形は次の通り。

```
https://<バージョンIDの先頭8桁>-putt.jibunnha.workers.dev/
```

本番デプロイと同じ `CLOUDFLARE_DEPLOY` / `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` を使う。止めたいときは `CLOUDFLARE_DEPLOY` を
`false` にすれば、本番デプロイと一緒に止まる。

### 有効にするための1回だけの設定

Cloudflare のダッシュボードで、Workers & Pages → `putt` → Settings →
Domains & Routes → **Preview URLs を有効にする**（`workers.dev` の
サブドメインが有効になっていること）。無効のままだとバージョンは上がるが
URLが出ない。

### 注意

- プレビューURLは公開URL。推測しにくいだけでアクセス制限はない
- バージョンを上げても本番は動かないので、実機確認が済んだら通常どおり
  `main` へマージして本番へ出す

## ロールバック

`CLOUDFLARE_DEPLOY` を `false` に戻せば、Cloudflareへのデプロイが止まり、
GitHub Pages の配信だけが残る。あわせて `hanage-hub` の `GAME_URLS.putt` を
`https://hanagemaru.github.io/putt/` へ戻す。
GitHub Pages のワークフローは、この退避先が要らなくなるまで消さない。

## ローカル確認

```bash
npm ci
npm run build:cloudflare
npx wrangler dev
```

`npx wrangler dev` は `dist/` を配信するので、先にビルドしておく。
