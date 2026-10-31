import assert from 'node:assert/strict';
import { generateChart } from '../../lib/ziwei/algorithm';
import { BRANCHES, STEMS } from '../../lib/ziwei/constants';
import { buildThreeLayerContext } from '../../lib/ziwei/time-layers';

const chart = generateChart({
  year: 1990,
  month: 6,
  day: 15,
  hour: 4,
  gender: 'female',
});

const context = buildThreeLayerContext(chart, 'liunian', 2026);

assert.equal(context.focus, 'liunian');
assert.equal(context.selectedYear, 2026);
assert.equal(context.layers.natal.layer, 'natal');
assert.equal(context.layers.daxian.layer, 'daxian');
assert.equal(context.layers.liunian.layer, 'liunian');

assert.equal(context.layers.liunian.stem, STEMS[2], '2026 年干应为丙');
assert.equal(context.layers.liunian.branch, BRANCHES[6], '2026 年支应为午');
assert.equal(context.layers.liunian.ganzhi, '丙午');
assert.deepEqual(
  context.layers.liunian.transformedStars.map(({ type, star }) => `${star}化${type}`),
  ['天同化禄', '天机化权', '文昌化科', '廉贞化忌'],
  '2026 丙年流年四化顺序错误',
);

for (const transform of context.layers.liunian.transformedStars) {
  assert.ok(transform.palaceBranch !== null, `${transform.star} 未定位落宫`);
  assert.notEqual(transform.palaceName, '命盘中未找到');
  const palace = chart.palaces.find((item) => item.branch === transform.palaceBranch);
  assert.ok(palace?.stars.some((star) => star.name === transform.star));
}

const mingPalace = chart.palaces.find(
  (palace) => palace.branch === context.layers.liunian.mingPalaceBranch,
);
assert.ok(mingPalace, '流年命宫应能对应到本命宫位');
assert.equal(context.layers.liunian.mingPalaceName, mingPalace?.name);

console.log('✓ 本命 / 大限 / 流年三层上下文与流年四化落宫回归通过');
