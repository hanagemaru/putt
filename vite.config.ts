import { defineConfig } from 'vite';

// Netlify はサイトのルートで配信するので base は '/'
export default defineConfig({
  build: {
    rollupOptions: {
      // マルチページ構成。パスは root からの相対
      input: {
        // ゲーム本体 → /
        main: 'index.html',
        // スワイプ速度計測の検証ページ → /swipe-test/
        swipeTest: 'swipe-test/index.html',
      },
    },
  },
});
