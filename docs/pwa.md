# PWA

「ホーム画面に追加」できる素地までを実装している。**Service Worker とオフライン化はまだ入れていない。**

## いま入っているもの

| もの | 置き場所 |
| --- | --- |
| マニフェスト | `vite.config.ts` の `putt-pwa` プラグインが `manifest.webmanifest` を生成する |
| アイコン | `public/icons/`。`scripts/generate-icons.mjs` で生成する |
| head のタグ | `index.html`（manifest / theme-color / apple-* / apple-touch-icon / icon） |

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

## Service Worker を入れるなら次に要るもの

今回はやっていない。やるときに必要なのは以下。

1. **キャッシュ対象の決定。** `index.html` / `assets/*` / `icons/*` を precache する。
   `physics` チャンクだけで約 500 kB あるので、初回取得のタイミングを決める
2. **更新の反映方法。** 自動デプロイなので、古いキャッシュを掴んだままにしない仕組みが要る。
   `skipWaiting` で即時更新するか、「新しいバージョンがあります」を出して再読み込みさせるかを決める
3. **ベースパスごとの scope。** Service Worker の登録パスと scope も `/putt/` と `/` で変わる。
   マニフェストと同じ切り替えに乗せる
4. **オフライン時の入口の扱い。** トップメニュー・練習は完全にローカルで動くが、
   オンラインランキング（未実装）は繋がらない前提の表示が要る
5. **ローカル確認手段。** Service Worker は https か localhost でしか動かない。
   `npx wrangler dev` と実機の確認手順を決める
6. **依存の判断。** `vite-plugin-pwa` を入れるか、自前で書くか。
   新しいライブラリを入れる前に確認を取ること（`CLAUDE.md`）

## 実機で見るところ

- iOS Safari: 共有 → ホーム画面に追加 → 名前が `putt`、アイコンが旗のドット絵
- 追加したアイコンから起動して、Safari のURLバーが出ないこと
- 起動直後のスプラッシュと、上端のステータスバーが暗い緑になじむこと
  （`apple-mobile-web-app-status-bar-style: black-translucent` なので、
  上端はコンテンツが回り込む。HUDの `env(safe-area-inset-top)` で避けている）
- スタンドアロン起動でも縦のまま、横向きの警告が出ないこと
- Android Chrome: インストール後の縦固定とマスカブルアイコンの切り抜き
