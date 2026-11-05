/**
 * 回归脚本：升辉 MES DEV「数据收集组维护」(feat_294217dc)
 *
 * - 纯 Playwright，不调用 LLM。
 * - 账号密码只从环境变量读取：REG_USER=xxx REG_PASS=xxx pnpm test:regression
 * - 数据护栏：每次运行生成唯一编码 autotestreg+yyyyMMddHHmmss，复制单据加后缀 CP；
 *   只操作本次运行自建的单据，不做数据库操作。
 * - 保存类操作 HTTP 恒为 200，成败以响应体 success===true 判定，并刷新/重新打开回查。
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test';

const BASE = process.env.REG_BASE_URL || 'http://172.22.5.122:30012';
const LIST_URL = `${BASE}/hmes/acquisition/data-collection/list`;
const USER = process.env.REG_USER;
const PASS = process.env.REG_PASS;

function ts(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const CODE = `autotestreg${ts()}`;
const CP_CODE = `${CODE}CP`;
const DESC = `autotestreg回归${CODE.slice(-6)}`;
const HEADER = {
  site: '8000',
  businessType: '工艺',
  tagGroupType: '执行作业',
  collectionTimeControl: '任何时间',
};
const MATERIAL_CODE = process.env.REG_MATERIAL || 'CSWL';

let context: BrowserContext;
let page: Page;
let detailId = '';

// ---------- 通用辅助 ----------

/** 等待匹配接口响应并断言响应体 success===true（HZERO HTTP 恒 200，不能作依据）。 */
async function expectApiSuccess(action: () => Promise<unknown>, urlPart: string): Promise<any> {
  const [resp] = await Promise.all([
    page.waitForResponse((r: Response) => r.url().includes(urlPart) && r.request().method() !== 'OPTIONS', {
      timeout: 30_000,
    }),
    action(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body?.success, `${urlPart} 响应：${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body;
}

function waitDetail(): Promise<Response> {
  return page.waitForResponse((r) => r.url().includes('mt-tag-group/detail/ui'), { timeout: 30_000 });
}

/** 页头按钮（限定当前路由页，排除外层工作台）。 */
function headBtn(name: string | RegExp): Locator {
  return page.locator('.page-head').getByRole('button', { name });
}

/** 字段展示文本：wrapper 的 innerText + 其中可见输入框的 value（c7n Select 的显示值在 input value 里）。 */
async function fieldText(scope: Locator, name: string): Promise<string> {
  return scope
    .locator(`.c7n-pro-field:has(input[name="${name}"])`)
    .first()
    .evaluate((el) => {
      const vals = Array.from(el.querySelectorAll('input'))
        .filter((i) => i.type !== 'hidden')
        .map((i) => (i as HTMLInputElement).value);
      return `${(el as HTMLElement).innerText} ${vals.join(' ')}`;
    });
}

async function expectField(scope: Locator, name: string, text: string) {
  await expect.poll(() => fieldText(scope, name), { message: `字段 ${name} 应含 ${text}` }).toContain(text);
}

/** c7n-pro Select：点 wrapper，再点可见下拉项。 */
async function pickSelect(scope: Locator | Page, name: string, option: string, multiple = false) {
  await scope.locator(`.c7n-pro-select-wrapper:has(input[name="${name}"])`).first().click();
  const item = page
    .locator('.c7n-pro-select-dropdown-menu-item:visible, .c7n-pro-select-dropdown-menu [role=option]:visible')
    .filter({ hasText: new RegExp(`^\\s*${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
    .first();
  await item.click();
  if (multiple) {
    // 多选不会自动收起，挡住后续下拉
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.c7n-pro-select-dropdown-menu:visible')).toHaveCount(0);
}

/** 打开列表并按编码查询，返回该编码对应的行（精确匹配）。 */
async function queryList(code: string): Promise<Locator> {
  await page.goto(LIST_URL);
  const codeInput = page.locator('.page-content input[name="tagGroupCode"]').first();
  await expect(codeInput).toBeVisible();
  await codeInput.fill(code);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('mt-tag-group/list/ui'), { timeout: 30_000 }),
    page.locator('.page-content').getByRole('button', { name: '查询', exact: true }).click(),
  ]);
  return listRow(code);
}

function listRow(code: string): Locator {
  return page
    .locator('.page-content .c7n-pro-table-tbody tr')
    .filter({ has: page.locator('td[data-index="tagGroupCode"]').getByText(code, { exact: true }) })
    .first();
}

/** 列表进入详情。 */
async function openDetailFromList(code: string) {
  const row = await queryList(code);
  await expect(row).toBeVisible();
  const detail = waitDetail();
  await row.locator('td[data-index="tagGroupCode"] a, td[data-index="tagGroupCode"] span').getByText(code, { exact: true }).first().click();
  await detail;
  await page.waitForURL(/data-collection\/detail\/\d+/);
}

/** 刷新当前详情并等待详情接口返回。 */
async function reloadDetail(): Promise<any> {
  const detail = waitDetail();
  await page.reload();
  const resp = await detail;
  return resp.json().catch(() => ({}));
}

/** 进入编辑态（编辑按钮在数据加载后 2~4 秒才按状态稳定）。 */
async function enterEdit() {
  const editBtn = headBtn(/编辑/);
  await expect(editBtn).toBeEnabled({ timeout: 15_000 });
  await editBtn.click();
  await expect(page.locator('.page-head button:has(.icon-save)')).toBeVisible();
}

async function saveDetail() {
  return expectApiSuccess(() => page.locator('.page-head button:has(.icon-save)').click(), 'mt-tag-group/save/ui');
}

/** 详情页内的页签面板（限定在 .page-content，避免命中外层工作台页签）。 */
async function switchTab(name: '数据项信息' | '关联对象'): Promise<Locator> {
  await page.locator('.page-content').getByRole('tab', { name, exact: true }).click();
  const key = name === '关联对象' ? 'assObjects' : 'dataItemInfo';
  // 页签面板带 data-node-key（assObjects / dataItemInfo），外层工作台也有 tabpane-active，需限定
  const pane = page.locator(`.page-content .c7n-tabs-tabpane-active[data-node-key="${key}"]`);
  await expect(pane).toBeVisible();
  return pane;
}

function tableBodyRows(pane: Locator): Locator {
  return pane.locator('.c7n-pro-table-tbody tr.c7n-pro-table-row');
}

/** 可见弹层（抽屉/弹窗），取最上层。 */
function topModal(): Locator {
  return page.locator('.c7n-pro-modal-wrapper:visible').last();
}

/** 在 LOV 弹窗里按编码选一条并确定（物料 LOV 只有几条，首页即可见；不在首页时用查询框过滤）。 */
async function chooseInLov(code: string) {
  const lov = topModal();
  const rows = lov.locator('.c7n-pro-table-tbody tr.c7n-pro-table-row');
  await expect(rows.first()).toBeVisible();
  const row = rows.filter({ has: page.locator('td').getByText(code, { exact: true }) }).first();
  if ((await row.count()) === 0) {
    const q = lov.locator('input:not([type="hidden"]):not([readonly])').first();
    await q.fill(code);
    await q.press('Enter');
  }
  await expect(row).toBeVisible();
  await row.click();
  await lov.getByRole('button', { name: /^确\s*定$/ }).click();
}

// ---------- 用例 ----------

test.describe.serial('数据收集组维护 回归', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    expect(USER, '缺少环境变量 REG_USER').toBeTruthy();
    expect(PASS, '缺少环境变量 REG_PASS').toBeTruthy();
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(LIST_URL);
    await page.waitForURL(/\/oauth\/login/, { timeout: 60_000 });
    await page.locator('#username').fill(USER!);
    await page.locator('#password').fill(PASS!);
    await page.locator('button.login-account-login-btn').click();
    await page.waitForURL(/:30012\//, { timeout: 60_000 });
    await expect(headBtn(/新建/)).toBeVisible({ timeout: 60_000 });
    console.log(`[regression] 本次编码 ${CODE} / ${CP_CODE}`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('S5 新建数据收集组', async () => {
    await page.goto(LIST_URL);
    await headBtn(/新建/).click();
    await page.waitForURL(/detail\/create/);
    const form = page.locator('.page-content');
    await form.locator('input[name="tagGroupCode"]').fill(CODE);
    await form.locator('input[name="tagGroupDescription"]').fill(DESC);
    // 状态默认新建且不可改
    const statusWrap = form.locator('.c7n-pro-select-wrapper:has(input[name="status"])');
    await expect(statusWrap).toHaveClass(/c7n-pro-select-disabled/);
    await expectField(form, 'status', '新建');
    await pickSelect(form, 'siteIds', HEADER.site, true);
    await pickSelect(form, 'businessType', HEADER.businessType);
    await pickSelect(form, 'tagGroupType', HEADER.tagGroupType);
    await pickSelect(form, 'collectionTimeControl', HEADER.collectionTimeControl);

    await saveDetail();
    await page.waitForURL(/data-collection\/detail\/\d+/);
    detailId = page.url().match(/detail\/(\d+)/)![1];

    // 刷新回查
    await reloadDetail();
    await expect(form.locator('input[name="tagGroupCode"]')).toHaveValue(CODE);
    await expectField(form, 'status', '新建');
    await expectField(form, 'siteIds', HEADER.site);
    await expectField(form, 'businessType', HEADER.businessType);
    await expectField(form, 'tagGroupType', HEADER.tagGroupType);
    await expectField(form, 'collectionTimeControl', HEADER.collectionTimeControl);

    const row = await queryList(CODE);
    await expect(row).toBeVisible();
    await expect(row.locator('td[data-index="statusDesc"]')).toHaveText('新建');
  });

  test('S14 新建关联对象（物料）', async () => {
    test.skip(!detailId, '依赖 S5');
    await page.goto(`${BASE}/hmes/acquisition/data-collection/detail/${detailId}`);
    await waitDetail();
    await enterEdit();
    const pane = await switchTab('关联对象');
    await pane.locator('.c7n-pro-table-thead button:has(.icon-add), thead button:has(.icon-add)').first().click();

    const drawer = topModal();
    await expect(drawer).toBeVisible();
    await drawer.getByText('物料', { exact: true }).click();
    const cell = drawer.locator('td[data-index="objectLov"]').first();
    await expect(cell).toBeVisible();
    await cell.click();
    await drawer.locator('.c7n-pro-select-wrapper .icon-search, .c7n-pro-lov .icon-search').first().click();
    await chooseInLov(MATERIAL_CODE);
    // LOV 关闭后最上层变回抽屉
    await expect(drawer.locator('td[data-index="objectLov"]').first()).toContainText(MATERIAL_CODE);
    await drawer.getByRole('button', { name: /^确\s*定$/ }).click();
    await expect(page.locator('.c7n-pro-modal-wrapper:visible')).toHaveCount(0);

    await saveDetail();
    await reloadDetail();
    const paneAfter = await switchTab('关联对象');
    await expect(tableBodyRows(paneAfter)).toHaveCount(1);
  });

  test('S15 删除关联对象', async () => {
    test.skip(!detailId, '依赖 S5');
    await page.goto(`${BASE}/hmes/acquisition/data-collection/detail/${detailId}`);
    await waitDetail();
    await enterEdit();
    const pane = await switchTab('关联对象');
    await expect(tableBodyRows(pane)).toHaveCount(1);
    await tableBodyRows(pane).first().locator('button:has(.icon-remove)').click();
    await page.locator('.c7n-popover:visible').getByRole('button', { name: /确\s*定/ }).click();
    await saveDetail();

    await reloadDetail();
    const paneAfter = await switchTab('关联对象');
    await expect(paneAfter.getByText('暂无数据')).toBeVisible();
    await expect(tableBodyRows(paneAfter)).toHaveCount(0);
  });

  test('S11 新增数据项（已知缺陷）', async () => {
    // 已知缺陷：保存接口 success=true，但刷新后数据项表为空；
    // detail/ui 返回 tagGroupAssignTagList=[]，疑似后端详情查询问题。修复后去掉 test.fail()。
    test.fail();
    test.skip(!detailId, '依赖 S5');
    await page.goto(`${BASE}/hmes/acquisition/data-collection/detail/${detailId}`);
    await waitDetail();
    await enterEdit();
    const pane = await switchTab('数据项信息');
    await pane.locator('thead button:has(.icon-add)').first().click();
    const drawer = topModal();
    await expect(drawer).toBeVisible();
    await drawer.locator('.c7n-pro-select-wrapper:has(input[name="tagLov"]) .icon-search, .c7n-pro-lov:has(input[name="tagLov"]) .icon-search').first().click();
    const lov = topModal();
    const firstRow = lov.locator('.c7n-pro-table-tbody tr.c7n-pro-table-row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await lov.getByRole('button', { name: /^确\s*定$/ }).click();
    // 描述由 LOV 自动带出，不填
    await expect(drawer.locator('input[name="tagDescription"]')).not.toHaveValue('');
    await drawer.getByRole('button', { name: /^确\s*定$/ }).click();
    await expect(page.locator('.c7n-pro-modal-wrapper:visible')).toHaveCount(0);
    await saveDetail();

    await reloadDetail();
    const paneAfter = await switchTab('数据项信息');
    await expect(tableBodyRows(paneAfter)).toHaveCount(1, { timeout: 10_000 });
  });

  test('S17 复制数据收集组', async () => {
    test.skip(!detailId, '依赖 S5');
    await page.goto(`${BASE}/hmes/acquisition/data-collection/detail/${detailId}`);
    await waitDetail();
    const copyBtn = headBtn(/复制/);
    await expect(copyBtn).toBeEnabled({ timeout: 15_000 });
    await copyBtn.click();
    const modal = topModal();
    await expect(modal).toBeVisible();
    await modal.locator('input[name="tagGroupCode"]').fill(CP_CODE);
    await expectApiSuccess(() => modal.getByRole('button', { name: /^确\s*定$/ }).click(), 'mt-tag-group/copy/ui');
    await page.waitForURL((u) => /detail\/\d+/.test(u.pathname) && !u.pathname.endsWith(`/${detailId}`));

    // 列表查得到 CP，且表头字段与源一致
    const row = await queryList(CP_CODE);
    await expect(row).toBeVisible();
    await expect(row.locator('td[data-index="statusDesc"]')).toHaveText('新建');

    await openDetailFromList(CP_CODE);
    const form = page.locator('.page-content');
    await expect(form.locator('input[name="tagGroupCode"]')).toHaveValue(CP_CODE);
    await expectField(form, 'siteIds', HEADER.site);
    await expectField(form, 'businessType', HEADER.businessType);
    await expectField(form, 'tagGroupType', HEADER.tagGroupType);
    await expectField(form, 'collectionTimeControl', HEADER.collectionTimeControl);
  });

  test('S19 列表关闭复制单据', async () => {
    const row = await queryList(CP_CODE);
    await expect(row).toBeVisible();
    // 只勾选 CP 这一行（查询结果按编码模糊匹配，可能还有别的行）
    await row.locator('td').first().locator('input[type="checkbox"], .c7n-pro-checkbox').first().click();
    const checked = page.locator('.page-content .c7n-pro-table-tbody input[type="checkbox"]:checked');
    await expect(checked).toHaveCount(1);
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
    await headBtn(/状态变更/).click();
    await expectApiSuccess(
      () => page.getByRole('menuitem', { name: /关闭/ }).filter({ visible: true }).first().click(),
      'mt-tag-group/close/ui',
    );

    // 刷新回查：CP 关闭，源单据仍为新建
    const cpRow = await queryList(CP_CODE);
    await expect(cpRow.locator('td[data-index="statusDesc"]')).toHaveText('关闭');
    const srcRow = await queryList(CODE);
    await expect(srcRow.locator('td[data-index="statusDesc"]')).toHaveText('新建');

    await openDetailFromList(CP_CODE);
    // 等按钮状态稳定后再判定禁用
    await expect(headBtn(/编辑/)).toBeDisabled({ timeout: 15_000 });
  });

  test('S21 导入入口', async () => {
    await page.goto(LIST_URL);
    const importBtn = headBtn(/^导入$/);
    await expect(importBtn).toBeVisible();
    // 实测：openTab 在同一浏览器页内新开工作台页签并切换路由；兼容弹出新窗口的情况
    const IMPORT_RE = /\/himp\/commentImport\/HME\.TAG_GROUP_IMPORT/;
    const newPage = context.waitForEvent('page', { timeout: 30_000 }).catch(() => null);
    const sameTab = page.waitForURL(IMPORT_RE, { timeout: 30_000 }).then(() => page).catch(() => null);
    await importBtn.click();
    const target = await Promise.race([sameTab.then((p) => p ?? newPage), newPage.then((p) => p ?? sameTab)]);
    expect(target, '点击导入后未打开导入页').toBeTruthy();
    await expect(target!).toHaveURL(IMPORT_RE);
    await expect(target!.getByText('数据收集组导入').first()).toBeVisible();
    if (target !== page) await target!.close();
  });
});
