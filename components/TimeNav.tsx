'use client';
import { motion } from 'framer-motion';
import { SI_HUA_TABLE } from '@/lib/ziwei/constants';
import { buildThreeLayerContext, type TransformLanding } from '@/lib/ziwei/time-layers';
import type { ZiweiChart } from '@/lib/ziwei/types';

export type TimeView = 'mingpan' | 'daxian' | 'liunian';

interface TimeNavProps {
  chart: ZiweiChart;
  view: TimeView;
  liunianYear: number;
  onViewChange: (view: TimeView) => void;
  onYearChange: (year: number) => void;
}

/** 由年份计算天干索引 (0-9) */
export function getYearStemIndex(year: number): number {
  return ((year - 4) % 10 + 10) % 10;
}

/** 根据天干索引返回四化映射：starName → SiHua */
export function buildSiHuaOverlay(stemIndex: number): Record<string, string> {
  const stars = SI_HUA_TABLE[stemIndex];
  if (!stars) return {};
  return {
    [stars[0]]: '禄',
    [stars[1]]: '权',
    [stars[2]]: '科',
    [stars[3]]: '忌',
  };
}

const SIHUA_COLORS: Record<string, string> = {
  '禄': '#4ade80',
  '权': '#60a5fa',
  '科': '#facc15',
  '忌': '#f87171',
};

export default function TimeNav({
  chart,
  view,
  liunianYear,
  onViewChange,
  onYearChange,
}: TimeNavProps) {
  const currentDx = chart.daXians[chart.currentDaXianIndex];

  // 计算当前叠加四化信息
  const getOverlayInfo = (): {
    label: string;
    stemName: string;
    transforms: TransformLanding[];
  } | null => {
    if (view === 'mingpan') return null;

    const layers = buildThreeLayerContext(chart, view, liunianYear);
    if (view === 'daxian') {
      return {
        label: '大限',
        stemName: layers.layers.daxian.stem,
        transforms: layers.layers.daxian.transformedStars,
      };
    }

    if (view === 'liunian') {
      return {
        label: `${liunianYear} ${layers.layers.liunian.ganzhi}年 · 流年命宫${layers.layers.liunian.mingPalaceName.replace('宫', '')}`,
        stemName: layers.layers.liunian.stem,
        transforms: layers.layers.liunian.transformedStars,
      };
    }

    return null;
  };

  const overlayInfo = getOverlayInfo();

  return (
    <div className="mb-3">
      {/* Tab 行 */}
      <div
        className="flex items-center rounded-xl p-1 gap-1"
        style={{ background: 'var(--t-surface)', border: '1px solid var(--t-border)' }}
      >
        {/* 本命 */}
        <TabButton
          active={view === 'mingpan'}
          onClick={() => onViewChange('mingpan')}
        >
          本命
        </TabButton>

        {/* 大限 */}
        <TabButton
          active={view === 'daxian'}
          onClick={() => onViewChange('daxian')}
        >
          {currentDx ? `大限 ${currentDx.startAge}–${currentDx.endAge}` : '大限'}
        </TabButton>

        {/* 流年 — 含年份切换 */}
        <div
          className="relative flex-1 flex items-center justify-center rounded-lg py-1.5 gap-1 transition-all duration-200"
          style={{
            background: view === 'liunian'
              ? 'rgba(212,168,67,0.12)'
              : 'transparent',
            border: view === 'liunian'
              ? '1px solid rgba(212,168,67,0.25)'
              : '1px solid transparent',
          }}
        >
          <button
            onClick={() => onViewChange('liunian')}
            className="text-[10px] font-medium flex-1 text-center"
            style={{ color: view === 'liunian' ? 'var(--t-gold)' : 'var(--t-faint)' }}
          >
            流年
          </button>
          {/* 年份 +/- */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={e => { e.stopPropagation(); onYearChange(liunianYear - 1); if (view !== 'liunian') onViewChange('liunian'); }}
              className="text-[9px] w-4 h-4 flex items-center justify-center rounded"
              style={{ color: 'var(--t-faint)' }}
            >
              ‹
            </button>
            <span
              className="text-[10px] font-mono min-w-[28px] text-center cursor-pointer"
              style={{ color: view === 'liunian' ? 'var(--t-gold)' : 'var(--t-faint)' }}
              onClick={() => onViewChange('liunian')}
            >
              {liunianYear}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onYearChange(liunianYear + 1); if (view !== 'liunian') onViewChange('liunian'); }}
              className="text-[9px] w-4 h-4 flex items-center justify-center rounded"
              style={{ color: 'var(--t-faint)' }}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* 叠加四化说明行 */}
      {overlayInfo && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2 mt-1.5 px-1 flex-wrap"
        >
          <span className="text-[9px]" style={{ color: 'var(--t-faint)' }}>
            {overlayInfo.label} · {overlayInfo.stemName}干四化：
          </span>
          {overlayInfo.transforms.map((transform) => {
            const { type: sh, star, palaceName } = transform;
            return (
              <span key={sh} className="text-[9px] font-medium" style={{ color: SIHUA_COLORS[sh] }}>
                {star}化{sh}→{palaceName.replace('宫', '')}
              </span>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-all duration-200"
      style={{
        background: active ? 'rgba(212,168,67,0.12)' : 'transparent',
        color: active ? 'var(--t-gold)' : 'var(--t-faint)',
        border: active ? '1px solid rgba(212,168,67,0.25)' : '1px solid transparent',
      }}
    >
      {children}
    </button>
  );
}
