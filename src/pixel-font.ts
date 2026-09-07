/**
 * 画面全体で使うドット絵フォント（DotGothic16 / SIL OFL 1.1）。
 *
 * プレイ画面は低い解像度で描いて色数を丸めている（`CONFIG.pixel`）。
 * DOM側の文字だけ滑らかだと世界観が割れるので、メニュー・HUD・スコアカードを同じ字で出す。
 *
 * サブセットは `npm run font:pixel` で作る。1本に収まらないので何本かに分かれており、
 * 別々のフォント名として重ねることで、字ごとに持っている方へ落ちる。
 * どれにも無い字は端末のゴシックへ落ちる（表示は崩れない）。
 */
const FONT_FILES = import.meta.glob('./fonts/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 端末のフォントへ落ちるときの並び。等幅を先に置いて字面を近づける */
const FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace";

/**
 * @font-face と `--pixel-font` を1度だけ入れる。
 * CSS 側は `font-family: var(--pixel-font)` で参照する（index.html / entry.ts）
 */
export function ensurePixelFont(): void {
  if (document.getElementById('pixel-font')) return;

  const files = Object.keys(FONT_FILES).sort();
  const faces = files
    .map(
      (file, index) => `
    @font-face {
      font-family: 'Putt Dot ${index}';
      src: url('${FONT_FILES[file]}') format('woff2');
      font-weight: 400;
      font-style: normal;
      /* 別のフォントで出てから入れ替わると画面が飛ぶので、少しだけ待たせる */
      font-display: block;
    }`,
    )
    .join('');
  const families = files.map((_, index) => `'Putt Dot ${index}'`).join(', ');

  const style = document.createElement('style');
  style.id = 'pixel-font';
  style.textContent = `${faces}
    :root {
      --pixel-font: ${families}, ${FALLBACK};
    }
  `;
  document.head.append(style);
}
