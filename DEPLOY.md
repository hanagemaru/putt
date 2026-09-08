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
