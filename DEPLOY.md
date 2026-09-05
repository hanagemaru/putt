# デプロイ手順

## 現在の配信

- 本番: GitHub Pages（`main` への push で自動デプロイ、`https://hanagemaru.github.io/putt/`）
- 予定: Cloudflare Workers（Static Assets）で `https://putt.hanage.app/`

Cloudflare用の設定はこのリポジトリに入っているが、**まだ動いていない。**
GitHub Actionsの `Deploy to Cloudflare Workers` は、リポジトリ変数 `CLOUDFLARE_DEPLOY` が
`true` のときだけ実行される。GitHub Pages へのデプロイは従来どおり動き続ける。

## ベースパス

配信先でベースパスが変わるので、`vite.config.ts` は環境変数で切り替える。

| 配信先 | ベース | ビルドコマンド |
| --- | --- | --- |
| GitHub Pages | `/putt/`（既定） | `npm run build` |
| Cloudflare Workers | `/` | `npm run build:cloudflare` |

`npm run build:cloudflare` は `PUTT_BASE=/` を渡すだけで、他は同じビルド。

## Cloudflareへ切り替える手順

前提として `hanage.app` がCloudflareのゾーンになっていること（設定済み）。

1. GitHubの `hanagemaru/putt` に Repository secret を追加する
   - `CLOUDFLARE_API_TOKEN`（Workers Scripts: Edit を含むもの）
   - `CLOUDFLARE_ACCOUNT_ID`
2. Repository variable `CLOUDFLARE_DEPLOY` を `true` にする
3. Actions から `Deploy to Cloudflare Workers` を手動実行し、Workerの既定URL
   （`https://putt.<サブドメイン>.workers.dev/`）で表示を確認する
4. Cloudflare の Workers & Pages → `putt` → Settings → Domains & Routes で
   `putt.hanage.app` を追加する
5. `https://putt.hanage.app/` でトップメニュー・通常ツアー・練習・遊び方・プライバシーを確認する
6. Repository variable `PUTT_SMOKE_URL` に `https://putt.hanage.app/` を設定する
7. `hanage-hub` の `src/lib/site.ts` の `GAME_URLS.putt` を新URLへ差し替える
8. しばらく様子を見てから、GitHub Pages のワークフローを止める

## ロールバック

`CLOUDFLARE_DEPLOY` を `false` に戻せば、GitHub Pages の配信だけが残る。
GitHub Pages のワークフローは切り替え確認が済むまで消さない。

## ローカル確認

```bash
npm ci
npm run build:cloudflare
npx wrangler dev
```

`npx wrangler dev` は `dist/` を配信するので、先にビルドしておく。
