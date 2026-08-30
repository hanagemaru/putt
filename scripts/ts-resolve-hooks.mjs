// 拡張子なしの相対 import に `.ts` / `.ts` のディレクトリ index を補う解決フック。
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context);
      } catch {
        // 次の候補へ
      }
    }
  }
  return next(specifier, context);
}
