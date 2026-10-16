import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import YAML from 'yaml';

dotenv.config();

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

type RoleItem = {
  id: number;
  name: string;
  code: string;
  memberRoleId?: number;
};

type AuthEnv = {
  baseURL?: string;
  auth?: {
    mode?: string;
    login?: {
      path?: string;
      username?: string;
      password?: string;
      ready?: string;
    };
    role?: {
      id?: string | number;
      name?: string;
      code?: string;
      listPath?: string;
      switchPath?: string;
      enabled?: boolean | string;
    };
  };
};

test('authenticate', async ({ page, baseURL }) => {
  test.setTimeout(180_000);

  const envPath = path.join(process.cwd(), 'configs/env.yaml');
  if (!fs.existsSync(envPath)) {
    test.skip(true, '缺少 configs/env.yaml');
    return;
  }

  const env = YAML.parse(fs.readFileSync(envPath, 'utf8')) as AuthEnv;

  const writeEmpty = () => {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
  };

  if (env.auth?.mode === 'skip') {
    writeEmpty();
    return;
  }
  if (process.env.SKIP_AUTH === '1') {
    test.skip(true, 'SKIP_AUTH=1，跳过登录（跑业务用例时可按需开启）');
    return;
  }

  const username = interpolate(env.auth?.login?.username || process.env.TEST_USER || '');
  const password = interpolate(env.auth?.login?.password || process.env.TEST_PASS || '');
  const loginPath = env.auth?.login?.path || '/oauth/login';
  const readyText = (env.auth?.login?.ready || '').trim();
  // API / OAuth 用纯 origin；BASE_URL 若带 /workplace 等路径需剥掉
  const rawBase = (baseURL || process.env.BASE_URL || 'https://momuat.azpdl.net').replace(/\/$/, '');
  let origin = rawBase;
  try {
    origin = new URL(rawBase).origin;
  } catch {
    origin = rawBase.replace(/\/(workplace|oauth).*$/i, '');
  }

  if (!username || !password) {
    test.skip(true, '请在 .env 配置 TEST_USER / TEST_PASS');
    return;
  }

  const target = loginPath.startsWith('http')
    ? loginPath
    : new URL(loginPath, origin).toString();

  await page.goto(target, { waitUntil: 'domcontentloaded' });

  const userInput = page
    .locator(
      'input[name="username"], input#username, input[type="text"]:not([type="hidden"]), input[placeholder*="账号"], input[placeholder*="用户"]',
    )
    .first();
  const passInput = page
    .locator('input[name="password"], input#password, input[type="password"]')
    .first();
  const submit = page
    .getByRole('button', { name: /登录|login|sign in|登 录/i })
    .or(page.locator('button[type="submit"], .login-button, .btn-login').first());

  await expect(userInput).toBeVisible({ timeout: 30_000 });
  await userInput.fill(username);
  await passInput.fill(password);
  await submit.first().click();

  if (readyText) {
    await expect(page.getByText(readyText)).toBeVisible({ timeout: 60_000 });
  } else {
    // HZero 常见：先落到 /oauth/login#access_token=...，再进首页；pathname 可能短时仍是 login
    await page.waitForFunction(
      () => {
        const { pathname, hash, href } = window.location;
        if (/access_token=/i.test(hash) || /access_token=/i.test(href)) return true;
        if (!/\/oauth\/login|\/login(\?|$)/i.test(pathname)) return true;
        try {
          for (const k of ['access_token', 'accessToken', 'token']) {
            const v = localStorage.getItem(k) || sessionStorage.getItem(k);
            if (v && String(v).length > 20) return true;
          }
        } catch {
          // ignore
        }
        return false;
      },
      { timeout: 60_000 },
    );
    // 尽量离开登录页；若已带 token 则继续后续首页/角色步骤
    await page
      .waitForURL((url) => !/\/oauth\/login|\/login(\?|$)/i.test(url.pathname), {
        timeout: 15_000,
      })
      .catch(() => undefined);
  }

  // 进首页：优先等页面自己拉取 self-roles（200），直接复用结果与请求头
  const selfRolesUrlPart = 'member-roles/self-roles';
  const selfRolesRespPromise = page.waitForResponse(
    (r) => r.url().includes(selfRolesUrlPart) && r.status() === 200,
    { timeout: 50_000 },
  );

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);

  let pageRoles: RoleItem[] | null = null;
  let pageAuthHeaders: Record<string, string> = {};
  try {
    const resp = await selfRolesRespPromise;
    pageRoles = (await resp.json()) as RoleItem[];
    const req = resp.request();
    const auth = (await req.headerValue('authorization')) || '';
    if (auth) pageAuthHeaders.authorization = auth;
    // 附带其它可能需要的头
    for (const key of ['h-request-id', 'organization-id', 'h-organization-id', 'accept-language']) {
      const v = await req.headerValue(key);
      if (v) pageAuthHeaders[key] = v;
    }
    console.log(
      `✓ 页面已自行拉取角色列表 (${pageRoles?.length ?? 0} 个), authLen=${auth.length}`,
    );
  } catch {
    console.warn('首页未出现 self-roles 成功响应，改为主动请求');
  }

  let capturedAuthorization = pageAuthHeaders.authorization || '';
  let capturedHeaderBag = { ...pageAuthHeaders };
  if (!capturedAuthorization) {
    try {
      const req = await page.waitForRequest(
        (r) => /\/api\//i.test(r.url()),
        { timeout: 20_000 },
      );
      capturedAuthorization = (await req.headerValue('authorization')) || '';
      if (capturedAuthorization) {
        capturedHeaderBag = { ...capturedHeaderBag, authorization: capturedAuthorization };
        console.log(`✓ 已捕获业务 API Authorization, authLen=${capturedAuthorization.length}`);
      }
    } catch {
      console.warn('未捕获到 Authorization');
    }
  }

  const roleEnabled = String(env.auth?.role?.enabled ?? 'true').toLowerCase() !== 'false';
  if (roleEnabled) {
    await switchRoleViaApi(page, origin, env, {
      capturedAuthorization,
      capturedHeaderBag,
      pageRoles,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
  console.log(`✓ 登录态已写入: ${authFile}`);
});

async function switchRoleViaApi(
  page: import('@playwright/test').Page,
  origin: string,
  env: AuthEnv,
  opts: {
    capturedAuthorization?: string;
    capturedHeaderBag?: Record<string, string>;
    pageRoles?: RoleItem[] | null;
  },
): Promise<void> {
  const listPath =
    interpolate(env.auth?.role?.listPath || '') ||
    '/api/iam/hzero/v1/member-roles/self-roles?lang=zh_CN&organizationId=0&roldId=1&unionLabel=false';
  const switchPathTpl =
    interpolate(env.auth?.role?.switchPath || '') || '/api/iam/v1/users/roles?roleId={roleId}';

  const wantId = interpolate(String(env.auth?.role?.id ?? process.env.TEST_ROLE_ID ?? '')).trim();
  const wantName = interpolate(String(env.auth?.role?.name ?? process.env.TEST_ROLE ?? '')).trim();
  const wantCode = interpolate(String(env.auth?.role?.code ?? process.env.TEST_ROLE_CODE ?? '')).trim();

  // 去掉未替换的占位符
  const clean = (v: string) => (/\$\{ENV\./.test(v) ? '' : v);
  const id = clean(wantId);
  const name = clean(wantName);
  const code = clean(wantCode);

  if (!id && !name && !code) {
    throw new Error(
      '未配置目标角色：请在 .env 设置 TEST_ROLE（名称）或 TEST_ROLE_CODE / TEST_ROLE_ID',
    );
  }

  let roles = opts.pageRoles;
  if (!roles?.length) {
    const headers = await buildAuthHeaders(
      page,
      opts.capturedAuthorization || '',
      opts.capturedHeaderBag || {},
    );
    const listUrl = listPath.startsWith('http') ? listPath : `${origin}${listPath}`;
    const listResult = await browserFetch(page, listUrl, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (listResult.status < 200 || listResult.status >= 300) {
      throw new Error(
        `获取角色失败: HTTP ${listResult.status} ${listUrl} ${listResult.body.slice(0, 300)}`,
      );
    }
    roles = JSON.parse(listResult.body) as RoleItem[];
  }

  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('角色列表为空');
  }

  const matched = roles.find((r) => {
    if (id && String(r.id) === id) return true;
    if (code && r.code === code) return true;
    if (name && (r.name === name || r.name.includes(name))) return true;
    return false;
  });

  if (!matched) {
    const available = roles.map((r) => `${r.id}:${r.code}:${r.name}`).join(' | ');
    throw new Error(
      `未找到目标角色 id=${id || '-'} code=${code || '-'} name=${name || '-'}；可选: ${available}`,
    );
  }

  const switchUrl = `${origin}/api/iam/v1/users/roles?roleId=${matched.id}`;
  const auth =
    opts.capturedAuthorization ||
    opts.capturedHeaderBag?.authorization ||
    opts.capturedHeaderBag?.Authorization ||
    '';

  console.log(`准备切换角色 authLen=${auth.length} → ${matched.name} (${matched.id})`);

  const urls = [
    `${origin}/api/iam/v1/users/roles?roleId=${matched.id}`,
    `${origin}/api/iam/hzero/v1/users/roles?roleId=${matched.id}`,
  ];

  let switchResult = { status: 0, body: '' };
  for (const url of urls) {
    switchResult = await page.evaluate(
      async ({ url, authorization }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (authorization) headers.Authorization = authorization;
        const res = await fetch(url, {
          method: 'PUT',
          headers,
          credentials: 'include',
        });
        return { status: res.status, body: await res.text() };
      },
      { url, authorization: auth },
    );
    console.log(`尝试切换 page.fetch PUT ${url} → ${switchResult.status}`);
    if (switchResult.status === 204 || switchResult.status === 200) break;

    const res = await page.context().request.put(url, {
      headers: auth ? { Authorization: auth } : {},
    });
    switchResult = { status: res.status(), body: await res.text() };
    console.log(`尝试切换 context PUT ${url} → ${switchResult.status}`);
    if (switchResult.status === 204 || switchResult.status === 200) break;
  }

  // API 仍失败时：UI 点击角色名兜底（HZero 顶栏角色切换）
  if (switchResult.status !== 204 && switchResult.status !== 200) {
    console.warn(`API 切换失败 (${switchResult.status})，尝试 UI 切换角色: ${matched.name}`);
    const switched = await trySwitchRoleByUi(page, matched.name);
    if (!switched) {
      throw new Error(
        `切换角色失败: HTTP ${switchResult.status} roleId=${matched.id} ${switchResult.body.slice(0, 200)}`,
      );
    }
    console.log(`✓ 已通过 UI 切换角色: ${matched.name}`);
  } else {
    console.log(`✓ 已切换角色: ${matched.name} (id=${matched.id}, code=${matched.code})`);
  }
}

async function trySwitchRoleByUi(page: import('@playwright/test').Page, roleName: string): Promise<boolean> {
  try {
    // HZero：点右上角用户名展开，再选角色
    const userTrigger = page
      .locator('[class*="user"], [class*="User"], [class*="header"], [class*="Header"]')
      .getByText(/测试用户|管理员|角色|租户|胖东来|平台/i)
      .first();
    if (await userTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userTrigger.click();
    } else {
      await page
        .locator('[class*="role"], [class*="Role"], [class*="avatar"], [class*="Avatar"]')
        .first()
        .click({ timeout: 3000 })
        .catch(() => undefined);
    }

    const option = page.getByText(roleName, { exact: false }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    console.warn('UI 切换角色失败', e);
    return false;
  }
}

/** 在页面上下文发请求 */
async function browserFetch(
  page: import('@playwright/test').Page,
  url: string,
  opts: {
    method: string;
    headers: Record<string, string>;
    credentials?: RequestCredentials;
    body?: string;
  },
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, method, headers, credentials, body }) => {
      const res = await fetch(url, {
        method,
        headers,
        credentials: credentials || 'include',
        body: body || undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text };
    },
    {
      url,
      method: opts.method,
      headers: opts.headers,
      credentials: opts.credentials || 'include',
      body: opts.body,
    },
  );
}

async function buildAuthHeaders(
  page: import('@playwright/test').Page,
  capturedAuthorization = '',
  capturedHeaderBag: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...capturedHeaderBag,
  };

  // 1) 页面真实 API 请求头里的 Bearer（最可信）
  if (capturedAuthorization && /^Bearer\s+\S{20,}/i.test(capturedAuthorization)) {
    headers.Authorization = capturedAuthorization;
    console.log('Authorization 来源: 页面 API 拦截');
    return headers;
  }

  // 2) Cookie access_token
  const cookies = await page.context().cookies();
  const cookieTokenRaw =
    cookies.find((c) => c.name === 'access_token')?.value ||
    cookies.find((c) => /access_?token/i.test(c.name))?.value ||
    '';
  const cookieToken = cookieTokenRaw ? decodeURIComponent(cookieTokenRaw) : '';

  // 3) localStorage
  const storageToken = await page.evaluate(() => {
    const pick = (v: string | null) => (v ? v.replace(/^Bearer\s+/i, '') : '');
    for (const k of ['access_token', 'accessToken', 'token']) {
      const v = pick(localStorage.getItem(k) || sessionStorage.getItem(k));
      if (v) return v;
    }
    return '';
  });

  const finalToken = storageToken || cookieToken;
  if (finalToken) {
    headers.Authorization = `Bearer ${finalToken}`;
    console.log(
      `Authorization 来源: ${storageToken ? 'localStorage' : 'cookie'} (len=${finalToken.length})`,
    );
  } else {
    console.warn('未找到 access_token');
  }
  return headers;
}

function interpolate(v: string): string {
  return v.replace(/\$\{(?:ENV\.|env:)?([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? '');
}
