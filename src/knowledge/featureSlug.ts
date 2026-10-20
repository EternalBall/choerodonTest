/** 功能名 → 稳定 base slug（元素命名空间 / knowledge 目录；与历史 web_auto_test 一致） */
export function featureSlug(feature: string): string {
  const ascii = feature.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  if (ascii && /[a-zA-Z]/.test(ascii)) return ascii.toLowerCase();
  return `feat_${Buffer.from(feature).toString('hex').slice(0, 8)}`;
}

/** 产物目录时间戳段（与 compare 归档文件名一致，避免 `:` 等非法路径字符） */
export function formatOutputTimestamp(at = new Date()): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

/** 新产物目录名：`<featureSlug>_<timestamp>` */
export function makeRunOutputSlug(feature: string, at = new Date()): string {
  return `${featureSlug(feature)}_${formatOutputTimestamp(at)}`;
}

/** 匹配 `…_2026-10-18T08-51-19-425Z` 形式的目录名后缀 */
const RUN_SLUG_TS_RE = /_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,3})?Z$/;

export function isRunOutputSlug(dirName: string): boolean {
  return RUN_SLUG_TS_RE.test(dirName);
}

/** 从产物目录名还原稳定 base slug（去掉时间戳后缀；无后缀则原样返回） */
export function featureBaseSlugFromOutput(dirName: string): string {
  if (!isRunOutputSlug(dirName)) return dirName;
  return dirName.replace(RUN_SLUG_TS_RE, '');
}
