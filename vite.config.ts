import { defineConfig } from 'vite';

// Node の型は入れていないので、ここで使う分だけ宣言する
declare const process: { env: Record<string, string | undefined> };

// 配信先ごとにベースパスが違う。
// - GitHub Pages（従来）: プロジェクトサイトなので `/putt/` 配下
// - Cloudflare Workers（putt.hanage.app）: 独自ドメインの直下なので `/`
// 既定は GitHub Pages。Cloudflare 向けのビルドだけ `PUTT_BASE=/` を渡す。
const base = process.env.PUTT_BASE ?? '/putt/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      // マルチページ構成。パスは root からの相対
      input: {
        // ゲーム本体 → <base>
        main: 'index.html',
        // スワイプ速度計測の検証ページ → <base>swipe-test/
        swipeTest: 'swipe-test/index.html',
        // グリーンと転がりの検証ページ → <base>green-test/
        greenTest: 'green-test/index.html',
      },
    },
  },
});
