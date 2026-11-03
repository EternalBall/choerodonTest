import type { Locator, Page } from '@playwright/test';
import type { LocatorDef } from '../core/schema.js';

type ElementLib = Record<string, Record<string, unknown>>;

function getByPath(lib: ElementLib, ref: string): LocatorDef {
  const [ns, key] = ref.split('.');
  if (!ns || !key) {
    throw new Error(`元素引用格式应为 namespace.key，收到: ${ref}`);
  }
  const group = lib[ns];
  if (!group || !(key in group)) {
    throw new Error(`未找到元素定义: ${ref}`);
  }
  return group[key] as LocatorDef;
}

export function resolveLocator(
  page: Page,
  lib: ElementLib,
  refOrDef: string | LocatorDef,
  root?: Locator,
  ns?: string,
): Locator {
  const def = typeof refOrDef === 'string' ? getByPath(lib, refOrDef) : refOrDef;
  const curNs = typeof refOrDef === 'string' ? refOrDef.split('.')[0] : ns;

  let scope: Page | Locator = root ?? page;
  let own = def;
  if (def.within) {
    // within 可能是同命名空间内的裸键（如 listRoot），补上当前命名空间
    const w = def.within.includes('.') || !curNs ? def.within : `${curNs}.${def.within}`;
    scope = resolveLocator(page, lib, w);
    own = scopeRelative(def, getByPath(lib, w));
  }

  const loc = baseLocator(scope, own);
  if (loc && def.nth === 'first') return loc.first();
  if (loc && def.nth === 'last') return loc.last();
  if (loc && typeof def.nth === 'number') return loc.nth(def.nth);
  if (loc) return loc;

  throw new Error(`无效定位定义: ${JSON.stringify(def)}`);
}

/**
 * Playwright 链式定位里，内层 css 只在外层元素的「后代」中匹配（外层元素自身不参与）。
 * 元素写成 `within: 表格` + `css: .c7n-pro-table thead …` 时，开头的 .c7n-pro-table 指的正是外层自己，
 * 直接链会 0 命中（DEV 实测）。这类开头与 within 的 css 相同的，改写为 `:scope …`。
 */
/**
 * role 的 name：含正则元字符时按正则原样使用；纯文字时要求「整体就是这段文字」，
 * 只允许前后有图标字形/空白、字符间有空白（c7n 按钮可访问名形如「\ue6xx 编辑」）。
 * 否则「新建」会命中「保存并新建」（DEV 实测误点导致保存）。
 */
export function roleNamePattern(name: string): RegExp {
  if (/[\\^$.*+?()[\]{}|]/.test(name)) return new RegExp(name);
  // 两字按钮可能被插入空格（「查 询」），字符间允许空白
  const body = Array.from(name.trim()).join('\\s*');
  return new RegExp(`^[^\\p{L}\\p{N}]*${body}[^\\p{L}\\p{N}]*$`, 'u');
}

export function scopeRelative(def: LocatorDef, withinDef: LocatorDef | undefined): LocatorDef {
  const outer = withinDef?.css?.trim();
  const css = def.css?.trim();
  if (!outer || !css || outer.includes(',') || css.includes(',')) return def;
  if (css.startsWith(`${outer} `)) return { ...def, css: `:scope ${css.slice(outer.length + 1)}` };
  return def;
}

function baseLocator(scope: Page | Locator, def: LocatorDef): Locator | undefined {
  if (def.testId) return scope.getByTestId(def.testId);
  if (def.role) {
    return scope.getByRole(def.role as Parameters<Page['getByRole']>[0], {
      name: def.name ? roleNamePattern(def.name) : undefined,
    });
  }
  if (def.label) return scope.getByLabel(new RegExp(def.label));
  if (def.placeholder) return scope.getByPlaceholder(def.placeholder);
  if (def.text) return scope.getByText(def.text, { exact: false });
  if (def.css) return scope.locator(def.css);
  return undefined;
}

export function createElResolver(page: Page, lib: ElementLib) {
  return (ref: string, root?: Locator) => resolveLocator(page, lib, ref, root);
}
