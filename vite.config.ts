import { defineConfig } from 'vite';

// GitHub Pages のプロジェクトサイトは /<リポジトリ名>/ 配下に置かれる
export default defineConfig({
  base: '/putt/',
  build: {
    rollupOptions: {
      // マルチページ構成。パスは root からの相対
      input: {
        // ゲーム本体 → /putt/
        main: 'index.html',
        // スワイプ速度計測の検証ページ → /putt/swipe-test/
        swipeTest: 'swipe-test/index.html',
        // グリーンと転がりの検証ページ → /putt/green-test/
        greenTest: 'green-test/index.html',
      },
    },
  },
});
