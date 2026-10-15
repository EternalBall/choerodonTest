/** 功能名 → 目录 slug（与历史 web_auto_test 一致） */
export function featureSlug(feature: string): string {
  const ascii = feature.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  if (ascii && /[a-zA-Z]/.test(ascii)) return ascii.toLowerCase();
  return `feat_${Buffer.from(feature).toString('hex').slice(0, 8)}`;
}
