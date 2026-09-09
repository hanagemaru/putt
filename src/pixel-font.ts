/**
 * 画面全体で使うドット絵フォント（DotGothic16 / SIL OFL 1.1）。
 *
 * プレイ画面は低い解像度で描いて色数を丸めている（`CONFIG.pixel`）。
 * DOM側の文字だけ滑らかだと世界観が割れるので、メニュー・HUD・スコアカードを同じ字で出す。
 *
 * サブセットは `npm run font:pixel` で作る。1本に収まらないので何本かに分かれており、
 * 別々のフォント名として重ねることで、字ごとに持っている方へ落ちる。
 * どれにも無い字は端末のゴシックへ落ちる（表示は崩れない）。
 *
 * **字は言語ごとに分けて持つ。** 英語表示では仮名も漢字も出ないので、
 * `-en-` の1本（英数字と記号、それに言語切り替えの「日本語」）だけを読み込む。
 * 日本語表示のときだけ `-ja-`（仮名と漢字）を足す
 */
import type { Language } from './i18n';

const EN_FILES = import.meta.glob('./fonts/*-en-*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const JA_FILES = import.meta.glob('./fonts/*-ja-*.woff2', {
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
export function ensurePixelFont(language: Language): void {
  const existing = document.getElementById('pixel-font');
  // 言語を切り替えたときは、足りない字を入れ直す
  if (existing?.dataset.language === language) return;
  existing?.remove();

  // 英語の字はどちらの言語でも要る（数字・PAR・BEST など）。日本語表示だけ仮名と漢字を足す
  const sources = { ...EN_FILES, ...(language === 'ja' ? JA_FILES : {}) };
  const files = Object.keys(sources).sort();
  const faces = files
    .map(
      (file, index) => `
    @font-face {
      font-family: 'Putt Dot ${index}';
      src: url('${sources[file]}') format('woff2');
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
  style.dataset.language = language;
  style.textContent = `${faces}
    :root {
      --pixel-font: ${families}, ${FALLBACK};
    }
  `;
  document.head.append(style);
}
