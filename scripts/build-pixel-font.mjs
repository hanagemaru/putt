/*
 * 画面で使うドット絵フォント（DotGothic16, SIL Open Font License 1.1）から、
 * このゲームに実際に出る文字だけを抜いた woff2 を作る。
 *
 * 実行時に外部へリクエストしないよう、フォントは自分たちで配る（src/fonts/）。
 * Google Fonts の `text=` は必要な字だけのサブセットを返すので、
 * ここではビルド時にそれを落として保存する。
 * 一度に頼める文字数に上限があるため、何本かに分けて落とす。
 * 分けたぶんは別々のフォント名として重ね、字ごとに使える方へ落ちるようにする
 * （読み込みは src/pixel-font.ts）。
 *
 * **英語表示と日本語表示で分けて作る。**
 *   dotgothic16-en-NN.woff2 … 英数字と記号、それに言語切り替えの「日本語」
 *   dotgothic16-ja-NN.woff2 … 仮名と漢字
 * 英語表示では -ja- を読み込まないので、初回に落とす量がその分減る。
 *
 * 画面の文言やコース名を変えたら実行し直す:
 *   npm run font:pixel
 *
 * 収録していない字は端末のゴシックへ落ちる（表示は崩れないが字面が混ざる）。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(root, 'src/fonts');

/** 画面に出る文字が書かれている場所。メニューもHUDもスコアカードも同じフォントで出す */
const SOURCE_DIRS = ['src'];
const SOURCE_FILES = ['index.html'];

/** 1回のリクエストで頼む文字数。長すぎるとサブセットではなくフォント全体を返される */
const CHUNK = 300;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * どちらの言語でも要る字。英数字と、単位・矢印などの記号。
 * 言語切り替えのボタンに出る「日本語」だけは、英語表示でも必要なのでここへ入れる
 */
function commonChars() {
  const codes = [];
  for (let c = 0x20; c <= 0x7e; c += 1) codes.push(c); // ASCII
  // × ° ± · — … ← → ▶ ⟳
  codes.push(0x00d7, 0x00b0, 0x00b1, 0x00b7, 0x2014, 0x2026, 0x2190, 0x2192, 0x25b6, 0x21bb);
  return codes.map((c) => String.fromCodePoint(c)).join('') + '日本語';
}

/** 日本語表示のときだけ要る字。ひらがな・カタカナは全部入れておく */
function japaneseAlways() {
  const codes = [];
  for (let c = 0x3041; c <= 0x309f; c += 1) codes.push(c); // ひらがな
  for (let c = 0x30a0; c <= 0x30ff; c += 1) codes.push(c); // カタカナ
  codes.push(0x3000, 0x300c, 0x300d); // 全角空白と「」
  return codes.map((c) => String.fromCodePoint(c)).join('');
}

/** ソースから日本語（漢字・全角記号）だけ拾う。英数字は上で全部入れている */
function charsFromSources() {
  const files = SOURCE_FILES.map((file) => resolve(root, file));
  for (const dir of SOURCE_DIRS) files.push(...listFiles(resolve(root, dir)));

  let found = '';
  for (const file of files) {
    if (!/\.(ts|html)$/.test(file)) continue;
    found += (readFileSync(file, 'utf8').match(/[　-ヿ一-鿿＀-￯]/gu) ?? []).join('');
  }
  return found;
}

function listFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(path));
    else found.push(path);
  }
  return found;
}

async function subset(text) {
  const url = `https://fonts.googleapis.com/css2?family=DotGothic16&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const faces = css.match(/url\((https:\/\/[^)]+)\)/g) ?? [];
  if (faces.length !== 1) {
    // サブセットは1本で返る。複数返るのは text= が無視されてフォント全体が来たとき
    throw new Error(`サブセットにならなかった（${faces.length} 本返ってきた）。CHUNK を小さくする`);
  }
  const fontUrl = faces[0].slice(4, -1);
  return new Uint8Array(await (await fetch(fontUrl, { headers: { 'User-Agent': UA } })).arrayBuffer());
}

const common = [...new Set(commonChars())].sort().join('');
const japanese = [...new Set([...japaneseAlways(), ...charsFromSources()])]
  .filter((c) => !common.includes(c))
  .sort()
  .join('');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/** 1組ぶんを落として書き出す。`group` はファイル名に入り、読み込む側の目印になる */
async function writeGroup(group, text) {
  let total = 0;
  const count = Math.ceil(text.length / CHUNK);
  for (let i = 0; i < count; i += 1) {
    const font = await subset(text.slice(i * CHUNK, (i + 1) * CHUNK));
    // 読み込む順を固定するため、番号は桁を揃える
    const name = `dotgothic16-${group}-${String(i).padStart(2, '0')}.woff2`;
    writeFileSync(resolve(OUT_DIR, name), font);
    total += font.length;
    console.log(`  ${name}: ${font.length} bytes`);
  }
  console.log(`${group}: ${text.length} 文字 / ${count} 本 / 合計 ${total} bytes`);
  return total;
}

const total = (await writeGroup('en', common)) + (await writeGroup('ja', japanese));

// ライセンス表示（OFL 1.1）はフォントと一緒に配る
const license = await (
  await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/dotgothic16/OFL.txt')
).text();
writeFileSync(resolve(OUT_DIR, 'DotGothic16-OFL.txt'), license);

console.log(`合計 ${common.length + japanese.length} 文字 / ${total} bytes -> ${OUT_DIR}`);
