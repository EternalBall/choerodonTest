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
  if (def.within) {
    // within 可能是同命名空间内的裸键（如 listRoot），补上当前命名空间
    const w = def.within.includes('.') || !curNs ? def.within : `${curNs}.${def.within}`;
    scope = resolveLocator(page, lib, w);
  }

  if (def.testId) return scope.getByTestId(def.testId);
  if (def.role) {
    return scope.getByRole(def.role as Parameters<Page['getByRole']>[0], {
      name: def.name ? new RegExp(def.name) : undefined,
    });
  }
  if (def.label) return scope.getByLabel(new RegExp(def.label));
  if (def.placeholder) return scope.getByPlaceholder(def.placeholder);
  if (def.text) return scope.getByText(def.text, { exact: false });
  if (def.css) return scope.locator(def.css);

  throw new Error(`无效定位定义: ${JSON.stringify(def)}`);
}

export function createElResolver(page: Page, lib: ElementLib) {
  return (ref: string, root?: Locator) => resolveLocator(page, lib, ref, root);
}
