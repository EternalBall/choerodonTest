import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DeepSeekConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type DeepSeekChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      /** deepseek-flash / reasoner 等可能把思考写在这里 */
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string };
};

/**
 * DeepSeek Chat API（原生 HTTP，不依赖 OpenAI SDK）
 * @see https://api-docs.deepseek.com/api/create-chat-completion
 */
export function loadDeepSeekConfig(): DeepSeekConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      '缺少 DEEPSEEK_API_KEY。请在 .env 中配置，可从 https://platform.deepseek.com 获取。',
    );
  }
  return {
    apiKey,
    baseURL:
      process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || 'deepseek-chat',
  };
}

function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  // 火山方舟等：…/api/v3 或 …/api/coding/v3 → 直接 /chat/completions
  if (/\/v\d+$/i.test(base) || /volces\.com/i.test(base)) {
    return `${base}/chat/completions`;
  }
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}


/* ------------------------------------------------------------------ *
 * 文件交接模式（handoff）——供「呆呆鸟」等外部 agent 接管 LLM 环节
 * ------------------------------------------------------------------ *
 * 启用：.env 中设置 LLM_MODE=handoff（默认 api，走下面的 HTTP 调用，行为不变）。
 *
 * 流程（幂等，可反复重跑同一条 ata 命令）：
 *   1. 引擎每次要调 LLM 时，把 messages 写到
 *        <LLM_HANDOFF_DIR>/<key>.request.json
 *      key = messages/temperature/json 模式的 sha256 前 16 位，同一请求 key 恒定。
 *   2. 若同目录已有 <key>.response.txt，则读它的内容当作 LLM 回复，继续走原有的
 *      解析 / zod 校验 / 落盘流程（对调用方完全透明）。
 *   3. 若还没有 response，抛出 LlmHandoffPendingError，CLI 以退出码 3 结束。
 *      外部 agent 读取 request.json → 按 messages 生成回复 → 写入同名 response.txt
 *      （纯文本，原样就是模型应返回的内容；request 里 responseFormatJson=true 时必须是合法 JSON）
 *      → 重跑同一条命令。每次重跑最多推进一个未应答的请求。
 *
 * LLM_HANDOFF_DIR 默认 artifacts/_llm-handoff（artifacts/* 已被 .gitignore，不会入库）。
 * 注意：prompt 改动会改变 key，旧 response 自动失效，不会误用。
 */
export class LlmHandoffPendingError extends Error {
  constructor(
    public readonly requestFile: string,
    public readonly responseFile: string,
  ) {
    super(
      `LLM 请求已写出，等待外部 agent 应答。\n  请求: ${requestFile}\n  应答请去写: ${responseFile}\n  写好后重跑同一条命令。`,
    );
    this.name = 'LlmHandoffPendingError';
  }
}

export function isHandoffMode(): boolean {
  return (process.env.LLM_MODE || 'api').toLowerCase() === 'handoff';
}

function handoffChat(opts: {
  messages: DeepSeekChatMessage[];
  temperature?: number;
  responseFormatJson?: boolean;
}): { content: string; model: string } {
  const dir = path.resolve(process.env.LLM_HANDOFF_DIR || 'artifacts/_llm-handoff');
  const payload = {
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    responseFormatJson: !!opts.responseFormatJson,
  };
  const key = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const requestFile = path.join(dir, `${key}.request.json`);
  const responseFile = path.join(dir, `${key}.response.txt`);

  if (fs.existsSync(responseFile)) {
    const content = fs.readFileSync(responseFile, 'utf-8').trim();
    if (content) return { content, model: 'handoff-agent' };
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(requestFile, JSON.stringify(payload, null, 2), 'utf-8');
  throw new LlmHandoffPendingError(requestFile, responseFile);
}

export async function deepSeekChat(opts: {
  messages: DeepSeekChatMessage[];
  temperature?: number;
  responseFormatJson?: boolean;
  config?: DeepSeekConfig;
}): Promise<{ content: string; model: string }> {
  // handoff 模式不需要 API key，直接走文件交接（见上方说明）
  if (isHandoffMode()) return handoffChat(opts);

  const config = opts.config ?? loadDeepSeekConfig();
  const url = chatCompletionsUrl(config.baseURL);

  const body: Record<string, unknown> = {
    model: config.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
  };
  if (opts.responseFormatJson) {
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    const detail =
      cause instanceof Error
        ? cause.message
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(
      `无法连接 DeepSeek（${url}）: ${detail}。请检查网络/代理，以及 DEEPSEEK_BASE_URL 是否可达。`,
    );
  }

  const raw = await res.text();
  let data: ChatCompletionResponse;
  try {
    data = JSON.parse(raw) as ChatCompletionResponse;
  } catch {
    throw new Error(`DeepSeek API 非 JSON 响应 (${res.status}): ${raw.slice(0, 300)}`);
  }

  if (!res.ok) {
    const msg = data.error?.message || raw.slice(0, 300);
    throw new Error(`DeepSeek API ${res.status}: ${msg}`);
  }

  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim() || message?.reasoning_content?.trim() || '';
  if (!content) {
    throw new Error(
      `DeepSeek 返回空内容（model=${config.model}）。可改用 DEEPSEEK_MODEL=deepseek-chat 后重试。`,
    );
  }

  return { content, model: config.model };
}
