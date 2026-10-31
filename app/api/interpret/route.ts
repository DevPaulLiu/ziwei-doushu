import { buildInterpretationMessages, type InterpretationMessage } from '@/lib/ai/prompt';
import type { TimeLayerContext, TimeLayerView } from '@/lib/ziwei/time-layers';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 16;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CHART_BYTES = 80_000;
const REQUEST_TIMEOUT_MS = 120_000;

interface ProviderConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  provider: string;
  keyVariable: string;
}

interface ProviderChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function providerConfig(): ProviderConfig {
  const provider = (envValue('AI_PROVIDER') ?? 'deepseek').toLowerCase();
  const prefix = provider.replace(/[^a-z0-9]/g, '_').toUpperCase();

  const defaults: Record<string, { baseUrl: string; model: string; keyVariable: string }> = {
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      keyVariable: 'DEEPSEEK_API_KEY',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      keyVariable: 'OPENAI_API_KEY',
    },
    mimo: {
      baseUrl: '',
      model: '',
      keyVariable: 'MIMO_API_KEY',
    },
    ollama: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: '',
      keyVariable: 'AI_API_KEY',
    },
    custom: {
      baseUrl: '',
      model: '',
      keyVariable: 'AI_API_KEY',
    },
  };
  const fallback = defaults[provider] ?? defaults.custom;

  return {
    provider,
    apiKey: envValue('AI_API_KEY', `${prefix}_API_KEY`, fallback.keyVariable),
    baseUrl: envValue('AI_BASE_URL', `${prefix}_BASE_URL`) ?? fallback.baseUrl,
    model: envValue('AI_MODEL', `${prefix}_MODEL`) ?? fallback.model,
    keyVariable: `${prefix}_API_KEY`,
  };
}

function configError(config: ProviderConfig): string | null {
  if (!config.baseUrl || !config.model) {
    return config.provider === 'ollama'
      ? 'AI 尚未配置完整。请设置 AI_MODEL（例如 qwen2.5:7b），并确保 Ollama 正在运行。'
      : 'AI 尚未配置完整。请设置 AI_BASE_URL 和 AI_MODEL。';
  }
  if (!config.apiKey && config.provider !== 'ollama') {
    return `AI 尚未配置密钥。请在 .env.local 中设置 ${config.keyVariable}（或通用 AI_API_KEY），然后重启服务。`;
  }
  return null;
}

function normalizeEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function tokenFromChunk(payload: ProviderChunk): string {
  const content = payload.choices?.[0]?.delta?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? '').join('');
  }
  return '';
}

async function providerError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // Fall through to a short raw response.
  }
  return raw.trim().slice(0, 300) || `模型服务返回 HTTP ${response.status}`;
}

function validateConversation(value: unknown): InterpretationMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('请先输入一个命盘问题。');
  }
  if (value.length > MAX_MESSAGES) {
    throw new Error(`单次对话最多支持 ${MAX_MESSAGES} 条消息。`);
  }

  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('对话消息格式不正确。');
    const message = item as { role?: unknown; content?: unknown };
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('对话角色格式不正确。');
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('对话内容不能为空。');
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`单条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`);
    }
    return { role: message.role, content: message.content.trim() };
  });
}

function validateChart(value: unknown): ZiweiChart {
  if (!value || typeof value !== 'object') throw new Error('缺少命盘数据。');
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    throw new Error('命盘数据无法序列化。');
  }
  if (bytes > MAX_CHART_BYTES) throw new Error('命盘数据过大。');

  const chart = value as Partial<ZiweiChart>;
  if (
    !chart.birthInfo ||
    !chart.lunarInfo ||
    !Array.isArray(chart.palaces) ||
    chart.palaces.length !== 12 ||
    !Array.isArray(chart.daXians)
  ) {
    throw new Error('命盘数据不完整。');
  }
  return chart as ZiweiChart;
}

function validateTimeContext(value: unknown): TimeLayerContext {
  if (value === undefined) {
    return { view: 'mingpan', liunianYear: new Date().getFullYear() };
  }
  if (!value || typeof value !== 'object') throw new Error('时间上下文格式不正确。');

  const context = value as { view?: unknown; liunianYear?: unknown };
  const validViews: TimeLayerView[] = ['mingpan', 'daxian', 'liunian'];
  if (!validViews.includes(context.view as TimeLayerView)) {
    throw new Error('时间视图必须是 mingpan、daxian 或 liunian。');
  }
  if (
    typeof context.liunianYear !== 'number'
    || !Number.isInteger(context.liunianYear)
    || context.liunianYear < 1900
    || context.liunianYear > 2200
  ) {
    throw new Error('流年年份必须是 1900–2200 之间的整数。');
  }
  return {
    view: context.view as TimeLayerView,
    liunianYear: context.liunianYear,
  };
}

function currentDateInShanghai(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(new Date());
}

export async function POST(request: Request): Promise<Response> {
  const config = providerConfig();
  const missingConfig = configError(config);
  if (missingConfig) return jsonError(missingConfig, 503);

  let chart: ZiweiChart;
  let conversation: InterpretationMessage[];
  let timeContext: TimeLayerContext;
  try {
    const body = (await request.json()) as {
      chart?: unknown;
      messages?: unknown;
      timeContext?: unknown;
    };
    chart = validateChart(body.chart);
    conversation = validateConversation(body.messages);
    timeContext = validateTimeContext(body.timeContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求格式不正确。';
    return jsonError(message, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortUpstream = () => controller.abort();
  request.signal.addEventListener('abort', abortUpstream, { once: true });

  try {
    const upstream = await fetch(normalizeEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? 'ollama'}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildInterpretationMessages(
          chart,
          conversation,
          currentDateInShanghai(),
          timeContext,
        ),
        stream: true,
        temperature: 0.65,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const details = await providerError(upstream);
      clearTimeout(timeout);
      return jsonError(`模型服务请求失败：${details}`, 502);
    }
    if (!upstream.body) {
      clearTimeout(timeout);
      return jsonError('模型服务没有返回响应内容。', 502);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        const emit = (text: string) => {
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`),
          );
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
          streamController.close();
        };
        const fail = (message: string) => {
          if (closed) return;
          closed = true;
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
          );
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
          streamController.close();
        };
        const handleLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) return;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') return;
          try {
            const payload = JSON.parse(data) as ProviderChunk;
            if (payload.error?.message) {
              fail(payload.error.message);
              return;
            }
            const text = tokenFromChunk(payload);
            if (text) emit(text);
          } catch {
            // Ignore keep-alive comments and malformed provider events.
          }
        };

        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline >= 0 && !closed) {
              handleLine(buffer.slice(0, newline));
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf('\n');
            }
          }
          buffer += decoder.decode();
          if (buffer.trim() && !closed) handleLine(buffer);
          finish();
        } catch (error) {
          fail(controller.signal.aborted ? '模型响应超时，请稍后重试。' : '模型流式响应中断。');
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener('abort', abortUpstream);
        }
      },
      cancel() {
        closed = true;
        controller.abort();
        void reader.cancel();
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortUpstream);
      },
    });

    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortUpstream);
    const details = error instanceof Error ? error.message : '未知网络错误';
    return jsonError(`无法连接模型服务：${details.slice(0, 300)}`, 502);
  }
}
