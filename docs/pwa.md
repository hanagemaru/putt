# PWA

「ホーム画面に追加」でき、一度開けばオフラインでも遊べる。

## いま入っているもの

| もの | 置き場所 |
| --- | --- |
| マニフェスト | `vite.config.ts` の `putt-pwa` プラグインが `manifest.webmanifest` を生成する |
| アイコン | `public/icons/`。`scripts/generate-icons.mjs` で生成する |
| head のタグ | `index.html`（manifest / theme-color / apple-* / apple-touch-icon / icon） |
| Service Worker | `vite.config.ts` の `VitePWA`（`vite-plugin-pwa`）が生成する |
| SW の登録 | `src/entry.ts` の `registerSW({ immediate: true })` |

マニフェストの中身は次のとおり。

- `display: standalone`、`orientation: portrait`（縦画面専用は変えていない）
- `background_color` / `theme_color` はどちらもメニューと同じ `#101410`
- `id` / `start_url` / `scope` は配信先のベースパスから作る

### ベースパスの扱い

配信先でベースが変わる（GitHub Pages は `/putt/`、Cloudflare Workers は `/`。`DEPLOY.md`）。

- `index.html` の href は `/icons/...` のように `/` 始まりで書く。`public/` にある実ファイルなので、
  Vite がビルド時にベースを前置する
- マニフェストは `public/` に置かず生成しているため Vite の書き換えが効かない。
  プラグインが出来上がったHTMLの `href="/manifest.webmanifest"` だけベース入りに直す
- `start_url` / `scope` / アイコンの `src` はプラグインが同じベースで組み立てる

`npm run build` と `PUTT_BASE=/ npm run build` の両方で確認すること。dev サーバーでも
プラグインが同じ内容を返すので、`npm run dev` のまま追加を試せる。

## アイコン

32×32 のドット絵を最近傍で拡大している。192 と 512 はセル数の整数倍なのでドットの境界がそのまま出る。

```bash
node scripts/generate-icons.mjs                       # public/icons/ を作り直す
node scripts/generate-icons.mjs --preview <出力先>     # 比較用に案A・案Bを256pxで出す
```

図案は「丘の上の旗」（案B）。OB色の空、フェアウェイ色の丘、たなびく四角い赤旗、白いボール。
コースと同じ色だけを使う（`src/config.ts`）。日陰用の暗い緑だけフェアウェイ色から作っている。

マスカブル用は同じ図案を中央72%へ縮めて、背景を全面に残したもの。安全領域（中央80%の円）に
旗とボールが収まる。

不採用案（案A: 俯瞰のカップとボール）も比較できるよう生成器に残してある。

## Service Worker

`vite-plugin-pwa` の `generateSW` で作る。マニフェストは上の `putt-pwa` が作るので `manifest: false`。

- **キャッシュ対象。** `index.html` / `manifest.webmanifest` / `assets/*`（js・css・woff2・mp3）/ `icons/*`。
  21ファイル・約720 kB。ゲームが実行時に外へ取りに行くものはこれで全部（音源とフォントは
  ビルドに取り込まれる。3.5 kB の `flagstick.mp3` だけはデータURLで JS に入る）
- **検証ページは載せない。** `swipe-test/` と `green-test/` のHTMLと入口チャンクは除外する。
  `navigateFallbackDenylist` にも入れて、オフラインでは本編のHTMLに化けないようにする。
  ただし `swipe-measure` は本編（`stroke-view` / `audio-bootstrap`）も使う共有チャンクなので外さない
- **更新の反映。** `registerType: 'prompt'` にして、案内は出さない。新しい版は裏で用意されるだけで、
  当たるのは次の起動から。ラウンドの途中で読み込み直さないため。
  自動デプロイなので `cleanupOutdatedCaches` で古いキャッシュは掃除する
- **登録場所。** `index.html` への自動注入（`injectRegister`）は使わない。検証ページにも入ってしまうため。
  本編の `src/entry.ts` からだけ登録する
- **ベースパス。** `base` と `scope` は配信先のベースをそのまま渡す。マニフェストと同じ切り替えに乗る
- **オフライン時の入口。** いまは通信が要る機能がないので、特別な表示はない。
  オンラインランキングを作るときに「繋がらない前提の表示」が要る

### ローカルでの確認

Service Worker は https か localhost でしか動かない。`npm run dev` では登録されない（`registerSW` が
何もしない）ので、`npm run build` してから `npm run preview` を使う。

Chromium で確認した内容（`PUTT_BASE` 既定 = `/putt/`）:

- 21件がプリキャッシュされ、scope は `/putt/`
- オフラインで再読み込みしてもトップメニューが出る
- オフラインのまま `?mode=practice` でグリーンが描画される。失敗したリクエストもコンソールエラーもゼロ
- オフラインで `swipe-test/` は開けない（意図どおり）

## 実機で見るところ

- iOS Safari: 共有 → ホーム画面に追加 → 名前が `putt`、アイコンが旗のドット絵
- 追加したアイコンから起動して、Safari のURLバーが出ないこと
- 起動直後のスプラッシュと、上端のステータスバーが暗い緑になじむこと
  （`apple-mobile-web-app-status-bar-style: black-translucent` なので、
  上端はコンテンツが回り込む。HUDの `env(safe-area-inset-top)` で避けている）
- スタンドアロン起動でも縦のまま、横向きの警告が出ないこと
- Android Chrome: インストール後の縦固定とマスカブルアイコンの切り抜き
- 機内モードで、ホーム画面のアイコンから起動して通常ツアーが最後まで回れること
- 配信のあと、次の起動で新しい版に入れ替わっていること（起動しっぱなしでは入れ替わらない）
