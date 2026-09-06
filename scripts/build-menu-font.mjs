/*
 * メニュー用のドット絵フォント（DotGothic16, SIL Open Font License 1.1）から、
 * メニューで実際に使う文字だけを抜いた woff2 を作る。
 *
 * 実行時に外部へリクエストしないよう、フォントは自分たちで配る（src/fonts/）。
 * Google Fonts の `text=` は必要な字だけのサブセットを返すので、
 * ここではビルド時にそれを1回だけ落として保存する。
 *
 * メニューの文言やコース名を変えたら実行し直す:
 *   npm run font:menu
 *
 * 収録していない漢字は端末のゴシックへ落ちる（表示は崩れないが字面が混ざる）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'src/fonts/dotgothic16-menu-subset.woff2');

/** メニューの文字が書かれているファイル。ここから使用文字を集める */
const SOURCES = ['src/entry.ts', 'src/course/tour-holes.ts'];

/** 必ず入れる範囲。数字と英字、記号、ひらがな・カタカナは全部入れておく */
function alwaysIncluded() {
  const codes = [];
  for (let c = 0x20; c <= 0x7e; c += 1) codes.push(c); // ASCII
  for (let c = 0x3041; c <= 0x309f; c += 1) codes.push(c); // ひらがな
  for (let c = 0x30a0; c <= 0x30ff; c += 1) codes.push(c); // カタカナ
  codes.push(0x3000, 0x3001, 0x3002, 0x300c, 0x300d, 0x2190, 0x2192, 0x25b6, 0x00d7);
  return codes.map((c) => String.fromCodePoint(c)).join('');
}

/** ソースから日本語（漢字・全角記号）だけ拾う。英数字は上で全部入れている */
function charsFromSources() {
  let found = '';
  for (const file of SOURCES) {
    const text = readFileSync(resolve(root, file), 'utf8');
    found += (text.match(/[　-ヿ一-鿿＀-￯]/gu) ?? []).join('');
  }
  return found;
}

const text = [...new Set([...alwaysIncluded(), ...charsFromSources()])].sort().join('');
const url = `https://fonts.googleapis.com/css2?family=DotGothic16&text=${encodeURIComponent(text)}`;
// woff2 を返させるため、対応ブラウザのUAで取りに行く
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
const fontUrl = css.match(/url\((https:\/\/[^)]+)\)/)?.[1];
if (!fontUrl) throw new Error(`フォントのURLを取り出せなかった:\n${css}`);

const font = new Uint8Array(await (await fetch(fontUrl, { headers: { 'User-Agent': UA } })).arrayBuffer());
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, font);
console.log(`${text.length} 文字 / ${font.length} bytes -> ${OUT}`);
