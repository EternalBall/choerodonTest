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

export async function deepSeekChat(opts: {
  messages: DeepSeekChatMessage[];
  temperature?: number;
  responseFormatJson?: boolean;
  config?: DeepSeekConfig;
}): Promise<{ content: string; model: string }> {
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
