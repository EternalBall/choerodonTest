import type { Locator, Page } from '@playwright/test';
import type { ActionContext } from './index.js';
import { activeScope } from './scope.js';
import { pickSelect } from './pickSelect.js';
import { pickLov } from './pickLov.js';

/**
 * 必填且为空的字段（c7n-pro FormField.getWrapperClassNames：wrapper 带 `<prefix>-required` 与 `<prefix>-empty`，
 * 禁用/只读带 `-disabled` / `-readonly`）。依据 choerodon-ui/pro/lib/field/FormField.js。
 */
type EmptyRequired = { name: string; control: 'select' | 'lov' | 'number' | 'date' | 'text'; label: string };

async function findEmptyRequired(scope: Locator | Page): Promise<EmptyRequired[]> {
  const root = 'goto' in scope ? scope.locator('body') : scope;
  // 浏览器端执行；node tsconfig 无 DOM 类型，故用 any
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return root.evaluate((el: any) => {
    const out: { name: string; control: string; label: string }[] = [];
    const seen = new Set<string>();
    const has = (cl: any, suffix: string) => Array.from(cl as string[]).some((c: string) => c.startsWith('c7n-pro-') && c.endsWith(suffix));
    for (const w of Array.from(el.querySelectorAll('[class*="-required"][class*="-empty"]')) as any[]) {
      const cl = w.classList;
      if (!has(cl, '-required') || !has(cl, '-empty') || has(cl, '-disabled') || has(cl, '-readonly')) continue;
      if (w.offsetParent === null) continue;
      const input = w.querySelector('input[name], textarea[name]') as any;
      if (!input || input.disabled) continue;
      const name = input.getAttribute('name')!;
      if (seen.has(name)) continue;
      seen.add(name);
      const cls = Array.from(cl as string[]).join(' ');
      const control = w.querySelector('.icon-search')
        ? 'lov'
        : /c7n-pro-select|c7n-pro-tree-select/.test(cls)
          ? 'select'
          : /c7n-pro-calendar-picker|c7n-pro-date-picker/.test(cls)
            ? 'date'
            : /c7n-pro-input-number/.test(cls)
              ? 'number'
              : 'text';
      const row = w.closest('tr, .c7n-pro-field-wrapper, .c7n-pro-form-item');
      const label = (row?.querySelector('label, .c7n-pro-field-label')?.textContent ?? '').replace(/[\s*:：]/g, '');
      out.push({ name, control, label });
    }
    return out;
  }) as Promise<EmptyRequired[]>;
}

/**
 * 补填分析/用例未覆盖的必填空字段：下拉/LOV 取第一项，文本填测试数据前缀，数字填 1，日期选今天。
 * 每个补填都打日志（用于反哺分析缺口），补不上的只记日志不抛错，交给保存时的校验提示判定。
 */
export async function fillRequiredEmpty(ctx: ActionContext, textValue: string): Promise<string[]> {
  const scope = await activeScope(ctx.page);
  const fields = await findEmptyRequired(scope);
  const filled: string[] = [];
  for (const f of fields) {
    // 祖先在前、后代在后：last() 取最内层的 wrapper
    const wrapper = scope.locator(`[class*="-wrapper"]:has(input[name="${f.name}"])`).last();
    try {
      if (f.control === 'select') {
        await pickSelect(ctx, { name: f.name, first: true });
      } else if (f.control === 'lov') {
        const open = wrapper.locator('.icon-search').first();
        const ctx2: ActionContext = { ...ctx, el: ((ref: string, root?: Locator) => (ref === '__auto_lov__' ? open : ctx.el(ref, root))) as ActionContext['el'] };
        await pickLov(ctx2, { open: '__auto_lov__', first: true, row: { first: true } });
      } else if (f.control === 'date') {
        const input = scope.locator(`input[name="${f.name}"]`).first();
        await input.click();
        await ctx.page.keyboard.press('Enter');
      } else {
        const input = scope.locator(`input[name="${f.name}"], textarea[name="${f.name}"]`).first();
        await input.fill(f.control === 'number' ? '1' : textValue);
      }
      filled.push(f.name);
      console.log(`[fillForm] 自动补填必填字段 ${f.name}${f.label ? `（${f.label}）` : ''}：用例未覆盖，属分析缺口，请回补 field_rules`);
    } catch (e) {
      console.log(`[fillForm] 必填字段 ${f.name}${f.label ? `（${f.label}）` : ''} 自动补填失败：${String((e as Error).message).split('\n')[0]}`);
    }
  }
  return filled;
}
