// Node から src の TypeScript をそのまま実行するための解決フック。
// src 内の相対 import は拡張子を書かない（Vite / tsc の bundler 解決）ので、
// Node の ESM 解決に `.ts` を補ってやる。依存パッケージは増やさない。
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
