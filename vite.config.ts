import { defineConfig, type Plugin } from 'vite';

// Node の型は入れていないので、ここで使う分だけ宣言する
declare const process: { env: Record<string, string | undefined> };

// 配信先ごとにベースパスが違う。
// - GitHub Pages（従来）: プロジェクトサイトなので `/putt/` 配下
// - Cloudflare Workers（putt.hanage.app）: 独自ドメインの直下なので `/`
// 既定は GitHub Pages。Cloudflare 向けのビルドだけ `PUTT_BASE=/` を渡す。
const base = process.env.PUTT_BASE ?? '/putt/';
const cfBeaconToken = process.env.VITE_CF_BEACON_TOKEN;

const MANIFEST_FILE = 'manifest.webmanifest';

// PWA のマニフェスト。start_url / scope / アイコンのパスは配信先で変わるので、
// public/ に静的なJSONを置かず、ベースパスから組み立てる。
// `id` も配信先ごとに別アプリとして扱われる（Pages と Cloudflare は別オリジン）。
function buildManifest(basePath: string): string {
  const icon = (name: string, size: number, purpose: 'any' | 'maskable') => ({
    src: `${basePath}icons/${name}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });

  return `${JSON.stringify(
    {
      id: basePath,
      name: 'putt パッティングゲーム',
      short_name: 'putt',
      description: 'スマホ縦画面で遊ぶ一人称パッティングゲーム',
      lang: 'ja',
      start_url: basePath,
      scope: basePath,
      display: 'standalone',
      orientation: 'portrait',
      // メニューと同じ暗い緑。起動時のスプラッシュとステータスバーを本編とつなげる
      background_color: '#101410',
      theme_color: '#101410',
      icons: [
        icon('icon-192.png', 192, 'any'),
        icon('icon-512.png', 512, 'any'),
        icon('icon-maskable-192.png', 192, 'maskable'),
        icon('icon-maskable-512.png', 512, 'maskable'),
      ],
    },
    null,
    2,
  )}\n`;
}

// マニフェストを配信先のベース入りで出力する。
// dev サーバーでも同じ内容を返し、`npm run dev` のまま「ホーム画面に追加」を試せるようにする。
function puttPwa(basePath: string): Plugin {
  return {
    name: 'putt-pwa',
    // マニフェストは public/ に置かず生成するので、Vite の公開ファイル書き換えが効かない。
    // 出来上がったHTMLの href だけ、ここで配信先のベースへ直す
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        return html.split(`"/${MANIFEST_FILE}"`).join(`"${basePath}${MANIFEST_FILE}"`);
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Node の型を入れていないので、使う分だけここで名前を付ける
        const request = req as unknown as { url?: string };
        const response = res as unknown as {
          setHeader(name: string, value: string): void;
          end(body: string): void;
        };

        const path = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (path !== `${basePath}${MANIFEST_FILE}` && path !== `/${MANIFEST_FILE}`) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/manifest+json');
        response.end(buildManifest(basePath));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE,
        source: buildManifest(basePath),
      });
    },
  };
}

// Cloudflare Web Analytics は本番ビルド時だけHTMLへ入れる。
// リポジトリ変数 CF_BEACON_TOKEN が未設定なら何も追加しない。
function cloudflareWebAnalytics(token: string | undefined): Plugin {
  return {
    name: 'cloudflare-web-analytics',
    apply: 'build',
    transformIndexHtml() {
      if (!token) return [];
      return [
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://static.cloudflareinsights.com/beacon.min.js',
            'data-cf-beacon': JSON.stringify({ token }),
          },
          injectTo: 'head',
        },
      ];
    },
  };
}

export default defineConfig({
  base,
  plugins: [puttPwa(base), cloudflareWebAnalytics(cfBeaconToken)],
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
