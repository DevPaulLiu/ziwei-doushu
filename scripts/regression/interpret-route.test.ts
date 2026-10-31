import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { POST } from '../../app/api/interpret/route';

const sampleChart = {
  birthInfo: {
    year: 1990,
    month: 6,
    day: 15,
    hour: 6,
    gender: 'female',
    name: '测试命盘',
    city: '上海',
    longitude: 121.47,
  },
  lunarInfo: {
    lunarYear: 1990,
    lunarMonth: 5,
    lunarDay: 23,
    yearStem: 6,
    yearBranch: 6,
    isLeapMonth: false,
    fourPillars: ['庚午', '壬午', '辛亥', '甲午'],
  },
  mingGongBranch: 0,
  shenGongBranch: 6,
  wuxingJu: 2,
  wuxingJuName: '水二局',
  ziweiPos: 0,
  currentAge: 36,
  currentDaXianIndex: 3,
  palaces: Array.from({ length: 12 }, (_, index) => ({
    branch: index,
    stem: index % 10,
    name: ['命宫', '兄弟宫', '夫妻宫', '子女宫', '财帛宫', '疾厄宫',
      '迁移宫', '交友宫', '官禄宫', '田宅宫', '福德宫', '父母宫'][index],
    stars: [
      index === 0 ? { name: '天同', type: 'major', brightnessRaw: '旺' } : null,
      index === 1 ? { name: '天机', type: 'major', brightnessRaw: '庙' } : null,
      index === 2 ? { name: '文昌', type: 'lucky' } : null,
      index === 3 ? { name: '廉贞', type: 'major', brightnessRaw: '利' } : null,
    ].filter(Boolean),
    daXianAge: [index * 10 + 2, index * 10 + 11],
    isCurrentDaXian: index === 3,
    isMingGong: index === 0,
  })),
  daXians: Array.from({ length: 12 }, (_, index) => ({
    startAge: index * 10 + 2,
    endAge: index * 10 + 11,
    palaceBranch: index,
    palaceName: index === 0 ? '命宫' : `宫位${index}`,
  })),
};

let providerBody = '';
let providerUrl = '';

const provider = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    providerBody = body;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '命盘' } }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '解读' } }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
});

before(async () => {
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address() as AddressInfo;
  providerUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    provider.close((error) => error ? reject(error) : resolve());
  });
});

test('streams an OpenAI-compatible interpretation', async () => {
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = providerUrl;
  process.env.AI_MODEL = 'mock-model';

  const response = await POST(new Request('http://localhost/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: sampleChart,
      messages: [{ role: 'user', content: '请分析我的整体命格。' }],
      timeContext: { view: 'liunian', liunianYear: 2026 },
    }),
  }));

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const output = await response.text();
  assert.match(output, /"text":"命盘"/);
  assert.match(output, /"text":"解读"/);
  assert.match(output, /data: \[DONE\]/);

  const upstreamRequest = JSON.parse(providerBody) as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    stream: boolean;
  };
  assert.equal(upstreamRequest.model, 'mock-model');
  assert.equal(upstreamRequest.stream, true);
  assert.equal(upstreamRequest.messages[0]?.role, 'system');
  assert.match(upstreamRequest.messages[0]?.content ?? '', /测试命盘/);
  assert.match(upstreamRequest.messages[0]?.content ?? '', /水二局/);
  assert.match(upstreamRequest.messages[0]?.content ?? '', /流年层（2026）/);
  assert.match(upstreamRequest.messages[0]?.content ?? '', /丙午/);
  assert.match(upstreamRequest.messages[0]?.content ?? '', /天同/);
  assert.match(upstreamRequest.messages[0]?.content ?? '', /财帛宫|命宫/);
});

test('returns a clear error when the API key is missing', async () => {
  process.env.AI_PROVIDER = 'deepseek';
  delete process.env.AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  const response = await POST(new Request('http://localhost/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: sampleChart,
      messages: [{ role: 'user', content: '你好。' }],
      timeContext: { view: 'liunian', liunianYear: 2026 },
    }),
  }));

  assert.equal(response.status, 503);
  const payload = await response.json() as { error: string };
  assert.match(payload.error, /DEEPSEEK_API_KEY/);
});
