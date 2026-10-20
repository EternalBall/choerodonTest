/** 功能名 → 稳定 slug（产物目录 / 元素命名空间 / knowledge 目录） */
export function featureSlug(feature: string): string {
  const ascii = feature.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  if (ascii && /[a-zA-Z]/.test(ascii)) return ascii.toLowerCase();
  return `feat_${Buffer.from(feature).toString('hex').slice(0, 8)}`;
}

/** 产物目录名：与功能 slug 一致（不再附加时间戳） */
export function makeRunOutputSlug(feature: string): string {
  return featureSlug(feature);
}

/** 匹配历史 `…_2026-10-18T08-51-19-425Z` 形式的目录名后缀（仅读取兼容） */
const RUN_SLUG_TS_RE = /_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,3})?Z$/;

export function isRunOutputSlug(dirName: string): boolean {
  return RUN_SLUG_TS_RE.test(dirName);
}

/** 从产物目录名还原稳定 base slug（去掉历史时间戳后缀；无后缀则原样返回） */
export function featureBaseSlugFromOutput(dirName: string): string {
  if (!isRunOutputSlug(dirName)) return dirName;
  return dirName.replace(RUN_SLUG_TS_RE, '');
}
