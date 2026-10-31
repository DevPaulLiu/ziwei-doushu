import { BRANCHES, STEMS } from './constants';
import {
  getDaXianSiHua,
  getLiuNianSiHua,
  getSiHuaByStem,
  getYearBranchIndex,
} from './sihua';
import type { SiHua, ZiweiChart } from './types';
import {
  CHILDHOOD_DAXIAN_INDEX,
  getChildhoodDaXianPalace,
  getDaXianIndexForYear,
  isChildhoodYear,
} from './yunxian-context';

export type TimeLayerView = 'mingpan' | 'daxian' | 'liunian';

export interface TimeLayerContext {
  view: TimeLayerView;
  liunianYear: number;
}

export interface TransformLanding {
  type: SiHua;
  star: string;
  palaceBranch: number | null;
  palaceName: string;
  palaceStem: string | null;
}

export interface TimeLayer {
  layer: 'natal' | 'daxian' | 'liunian';
  label: string;
  stem: string;
  branch?: string;
  ganzhi?: string;
  age?: number;
  transformedStars: TransformLanding[];
}

export interface ThreeLayerContext {
  focus: TimeLayerView;
  selectedYear: number;
  layers: {
    natal: TimeLayer;
    daxian: TimeLayer;
    liunian: TimeLayer & {
      mingPalaceBranch: number;
      mingPalaceName: string;
    };
  };
}

function locateStar(chart: ZiweiChart, star: string): {
  branch: number;
  name: string;
  stem: string;
} | null {
  const palace = chart.palaces.find((item) =>
    item.stars.some((candidate) => candidate.name === star),
  );
  if (!palace) return null;
  return {
    branch: palace.branch,
    name: palace.name,
    stem: STEMS[palace.stem] ?? '',
  };
}

function buildTransformLandings(
  chart: ZiweiChart,
  transforms: Record<SiHua, string>,
): TransformLanding[] {
  return (['禄', '权', '科', '忌'] as const).map((type) => {
    const star = transforms[type];
    const landing = locateStar(chart, star);
    return {
      type,
      star,
      palaceBranch: landing?.branch ?? null,
      palaceName: landing?.name ?? '命盘中未找到',
      palaceStem: landing?.stem ?? null,
    };
  });
}

function effectiveDaXianIndex(chart: ZiweiChart, year: number): number {
  const matched = getDaXianIndexForYear(chart, year);
  if (matched >= 0) return matched;
  if (isChildhoodYear(chart, year)) return CHILDHOOD_DAXIAN_INDEX;
  return chart.currentDaXianIndex;
}

export function buildThreeLayerContext(
  chart: ZiweiChart,
  view: TimeLayerView,
  liunianYear: number,
): ThreeLayerContext {
  const year = Number.isFinite(liunianYear)
    ? Math.trunc(liunianYear)
    : new Date().getFullYear();
  const natalStem = chart.lunarInfo.yearStem;
  const natalTransforms = getSiHuaByStem(natalStem);
  const natal: TimeLayer = {
    layer: 'natal',
    label: '本命层',
    stem: STEMS[natalStem] ?? '',
    branch: BRANCHES[chart.lunarInfo.yearBranch] ?? '',
    ganzhi: `${STEMS[natalStem] ?? ''}${BRANCHES[chart.lunarInfo.yearBranch] ?? ''}`,
    transformedStars: buildTransformLandings(chart, natalTransforms),
  };

  const daXianIndex = effectiveDaXianIndex(chart, year);
  const daXianInfo = getDaXianSiHua(chart, daXianIndex, year);
  const daXian = chart.daXians[daXianIndex];
  const childhoodPalace = daXianIndex === CHILDHOOD_DAXIAN_INDEX
    ? getChildhoodDaXianPalace(chart, year)
    : null;
  const daXianPalace = childhoodPalace ?? (
    daXian
      ? chart.palaces.find((palace) => palace.branch === daXian.palaceBranch) ?? null
      : chart.palaces.find((palace) => palace.branch === chart.mingGongBranch) ?? null
  );
  const daXianLayer: TimeLayer = {
    layer: 'daxian',
    label: daXianIndex === CHILDHOOD_DAXIAN_INDEX
      ? '大限层（童限）'
      : daXian
        ? `大限层（${daXian.startAge}-${daXian.endAge}岁）`
        : '大限层（当前未落入已生成大限）',
    stem: daXianInfo?.stemName ?? '',
    age: Math.trunc(year) - chart.lunarInfo.lunarYear + 1,
    ganzhi: daXianPalace
      ? `${STEMS[daXianPalace.stem] ?? ''}${BRANCHES[daXianPalace.branch] ?? ''}`
      : undefined,
    transformedStars: daXianInfo
      ? buildTransformLandings(chart, daXianInfo.transforms)
      : [],
  };

  const liunianInfo = getLiuNianSiHua(year);
  const liunianBranch = getYearBranchIndex(year);
  const liunianMingPalace = chart.palaces.find(
    (palace) => palace.branch === liunianBranch,
  );
  const liunian: TimeLayer & {
    mingPalaceBranch: number;
    mingPalaceName: string;
  } = {
    layer: 'liunian',
    label: `流年层（${year}）`,
    stem: liunianInfo.stemName,
    branch: BRANCHES[liunianBranch] ?? '',
    ganzhi: `${liunianInfo.stemName}${BRANCHES[liunianBranch] ?? ''}`,
    age: Math.trunc(year) - chart.lunarInfo.lunarYear + 1,
    transformedStars: buildTransformLandings(chart, liunianInfo.transforms),
    mingPalaceBranch: liunianBranch,
    mingPalaceName: liunianMingPalace?.name ?? '未知宫位',
  };

  return {
    focus: view,
    selectedYear: year,
    layers: {
      natal,
      daxian: daXianLayer,
      liunian,
    },
  };
}
