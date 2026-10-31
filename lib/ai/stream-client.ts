interface StreamPayload {
  delta?: { text?: string };
  error?: string;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall back to the status code when the server returns non-JSON.
  }
  return `AI 解读请求失败（HTTP ${response.status}）。`;
}

export async function readInterpretStream(
  response: Response,
  onDelta: (text: string) => void,
  onOpen?: () => void,
): Promise<void> {
  if (response.status === 404) throw new Error('api-missing');
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error('AI 服务没有返回响应流。');
  onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleEvent = (event: string): boolean => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();

    if (!data) return false;
    if (data === '[DONE]') return true;

    let payload: StreamPayload;
    try {
      payload = JSON.parse(data) as StreamPayload;
    } catch {
      return false;
    }
    if (payload.error) throw new Error(payload.error);
    if (payload.delta?.text) onDelta(payload.delta.text);
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (handleEvent(event)) return;
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    reader.releaseLock();
  }
}
