import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Copy, ClipboardPaste, Spline, Settings2, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ActiveChannel,
  Adjustments,
  Coord,
  CurveMode,
  DEFAULT_LEVELS_SETTINGS,
  getDefaultLevels,
  LevelsSettings,
  ParametricCurveSettings,
} from '../../utils/adjustments';
import { Theme, OPTION_SEPARATOR } from '../ui/AppProperties';
import { useContextMenu } from '../../context/ContextMenuContext';
import Text from '../ui/Text';
import Slider from '../ui/Slider';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';

let curveClipboard: Array<Coord> | null = null;
let parametricClipboard: any = null;
let levelsClipboard: LevelsSettings | null = null;

type LevelHandle = 'inputBlack' | 'gamma' | 'inputWhite' | 'outputBlack' | 'outputWhite';

export interface ChannelConfig {
  [index: string]: ColorData;
  [ActiveChannel.Luma]: ColorData;
  [ActiveChannel.Red]: ColorData;
  [ActiveChannel.Green]: ColorData;
  [ActiveChannel.Blue]: ColorData;
}

interface ColorData {
  color: string;
  data: any;
}

interface CurveGraphProps {
  adjustments: Adjustments | any;
  histogram: ChannelConfig | null;
  isForMask?: boolean;
  setAdjustments(updater: (prev: any) => any): void;
  theme: string;
  onDragStateChange?: (isDragging: boolean) => void;
}

const DEFAULT_PARAMETRIC_CURVE_SETTINGS: ParametricCurveSettings = {
  darks: 0,
  shadows: 0,
  highlights: 0,
  lights: 0,
  whiteLevel: 0,
  blackLevel: 0,
  split1: 25,
  split2: 50,
  split3: 75,
};

const DEFAULT_PARAMETRIC_CURVE = {
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
};

const DEFAULT_POINT_CURVES = {
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
};

function buildParametricPoints(settings: ParametricCurveSettings): Array<Coord> {
  const vH = settings.highlights / 100;
  const vL = settings.lights / 100;
  const vD = settings.darks / 100;
  const vS = settings.shadows / 100;

  const blackYOffset = settings.blackLevel;
  const whiteYOffset = settings.whiteLevel;

  const s1 = settings.split1 / 100;
  const s2 = settings.split2 / 100;
  const s3 = settings.split3 / 100;

  const xH = (s3 + 1) / 2;
  const xS = s1 / 2;
  const xs = [0, xS, s1, s2, s3, xH, 1];

  const SLIDER_GAIN = 1.2;
  const MAX_DISPLACEMENT = 0.35;

  const response = (v: number, x: number): number => {
    const headroom = v >= 0 ? 1 - x : x;
    const compressedHeadroom = Math.sqrt(headroom);
    const sigmoid = Math.tanh(v * SLIDER_GAIN);
    return sigmoid * MAX_DISPLACEMENT * compressedHeadroom;
  };

  const ys = [
    0,
    xS + response(vS, xS),
    s1 + (response(vS, s1) + response(vD, s1)) / 2,
    s2 + (response(vD, s2) + response(vL, s2)) / 2,
    s3 + (response(vL, s3) + response(vH, s3)) / 2,
    xH + response(vH, xH),
    1,
  ];

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  let points = xs.map((x, i) => ({
    x: x * 255,
    y: clamp(ys[i]) * 255,
  }));

  if (points.length >= 2) {
    points[0].y = Math.max(0, Math.min(255, points[0].y + blackYOffset));

    const lastIndex = points.length - 1;
    points[lastIndex].y = Math.max(0, Math.min(255, points[lastIndex].y + whiteYOffset));
  }

  return points;
}

function getCurvePath(points: Array<Coord>) {
  if (points.length < 2) return '';

  const n = points.length;
  const deltas = [];
  const ms = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    if (dx === 0) {
      deltas.push(dy > 0 ? 1e6 : dy < 0 ? -1e6 : 0);
    } else {
      deltas.push(dy / dx);
    }
  }

  ms.push(deltas[0]);

  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      ms.push(0);
    } else {
      ms.push((deltas[i - 1] + deltas[i]) / 2);
    }
  }

  ms.push(deltas[n - 2]);

  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      ms[i] = 0;
      ms[i + 1] = 0;
    } else {
      const alpha: number = ms[i] / deltas[i];
      const beta: number = ms[i + 1] / deltas[i];

      const tau = alpha * alpha + beta * beta;
      if (tau > 9) {
        const scale = 3.0 / Math.sqrt(tau);
        ms[i] = scale * alpha * deltas[i];
        ms[i + 1] = scale * beta * deltas[i];
      }
    }
  }

  let path = '';

  if (points[0].x > 0) {
    path += `M 0 ${255 - points[0].y} L ${points[0].x} ${255 - points[0].y}`;
  } else {
    path += `M ${points[0].x} ${255 - points[0].y}`;
  }

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const m0 = ms[i];
    const m1 = ms[i + 1];
    const dx = p1.x - p0.x;

    const cp1x = p0.x + dx / 3.0;
    const cp1y = p0.y + (m0 * dx) / 3.0;
    const cp2x = p1.x - dx / 3.0;
    const cp2y = p1.y - (m1 * dx) / 3.0;

    path += ` C ${cp1x.toFixed(2)} ${255 - Number(cp1y.toFixed(2))}, ${cp2x.toFixed(2)} ${
      255 - Number(cp2y.toFixed(2))
    }, ${p1.x} ${255 - p1.y}`;
  }

  if (points[n - 1].x < 255) {
    path += ` L 255 ${255 - points[n - 1].y}`;
  }

  return path;
}

function getHistogramPath(data: Array<any>) {
  if (!data || data.length === 0) return '';
  const maxVal = Math.max(...data);
  if (maxVal === 0) return '';

  const pathData = data
    .map((value: number, index: number) => `${(index / 255) * 255},${255 - (value / maxVal) * 255}`)
    .join(' ');

  return `M0,255 L${pathData} L255,255 Z`;
}

function getZeroHistogramPath(data: Array<any>) {
  if (!data || data.length === 0) return '';
  const pathData = data.map((_, index: number) => `${(index / 255) * 255},255`).join(' ');
  return `M0,255 L${pathData} L255,255 Z`;
}

function isDefaultCurve(points: Array<Coord> | undefined) {
  if (!points || points.length !== 2) return false;
  const [p1, p2] = points;
  return p1.x === 0 && p1.y === 0 && p2.x === 255 && p2.y === 255;
}

function isDefaultParametricCurve(settings: ParametricCurveSettings | undefined) {
  if (!settings) return true;
  return (
    settings.darks === DEFAULT_PARAMETRIC_CURVE_SETTINGS.darks &&
    settings.shadows === DEFAULT_PARAMETRIC_CURVE_SETTINGS.shadows &&
    settings.lights === DEFAULT_PARAMETRIC_CURVE_SETTINGS.lights &&
    settings.highlights === DEFAULT_PARAMETRIC_CURVE_SETTINGS.highlights &&
    settings.whiteLevel === DEFAULT_PARAMETRIC_CURVE_SETTINGS.whiteLevel &&
    settings.blackLevel === DEFAULT_PARAMETRIC_CURVE_SETTINGS.blackLevel &&
    settings.split1 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split1 &&
    settings.split2 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split2 &&
    settings.split3 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split3
  );
}

function getSplitterGradient(channel: ActiveChannel) {
  switch (channel) {
    case ActiveChannel.Luma:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 64, 64, 0.8) 25%, rgba(105, 101, 101, 0.8) 50%, rgba(158, 154, 154, 0.8) 75%, rgba(198, 195, 197, 0.8) 100%)';
    case ActiveChannel.Red:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 0, 0, 0.8) 25%, rgba(105, 50, 50, 0.8) 50%, rgba(158, 100, 100, 0.8) 75%, rgba(255, 107, 107, 0.8) 100%)';
    case ActiveChannel.Green:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 64, 0, 0.8) 25%, rgba(50, 105, 50, 0.8) 50%, rgba(100, 158, 100, 0.8) 75%, rgba(107, 203, 119, 0.8) 100%)';
    case ActiveChannel.Blue:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 64, 0.8) 25%, rgba(50, 50, 105, 0.8) 50%, rgba(100, 100, 158, 0.8) 75%, rgba(77, 150, 255, 0.8) 100%)';
    default:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 64, 64, 0.8) 25%, rgba(105, 101, 101, 0.8) 50%, rgba(158, 154, 154, 0.8) 75%, rgba(198, 195, 197, 0.8) 100%)';
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLevelsSettings(settings: LevelsSettings): LevelsSettings {
  const outputBlack = clamp(settings.outputBlack, 0, Math.min(254, settings.outputWhite - 1));
  const outputWhite = clamp(settings.outputWhite, Math.max(1, outputBlack + 1), 255);
  const inputBlack = clamp(settings.inputBlack, 0, Math.min(254, settings.inputWhite - 1));
  const inputWhite = clamp(settings.inputWhite, Math.max(1, inputBlack + 1), 255);

  return {
    inputBlack,
    gamma: clamp(settings.gamma || 1, 0.1, 9.99),
    inputWhite,
    outputBlack,
    outputWhite,
  };
}

function buildLevelsPoints(settings: LevelsSettings): Array<Coord> {
  const levels = normalizeLevelsSettings(settings);
  const points: Array<Coord> = [];
  const addPoint = (x: number, y: number) => {
    const point = { x: Number(clamp(x, 0, 255).toFixed(2)), y: Number(clamp(y, 0, 255).toFixed(2)) };
    const previous = points[points.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.01) {
      points[points.length - 1] = point;
      return;
    }
    points.push(point);
  };

  const range = Math.max(1, levels.inputWhite - levels.inputBlack);
  const outputRange = levels.outputWhite - levels.outputBlack;
  addPoint(0, levels.outputBlack);
  addPoint(levels.inputBlack, levels.outputBlack);

  for (let i = 1; i < 10; i++) {
    const normalizedInput = i / 10;
    const x = levels.inputBlack + normalizedInput * range;
    const y = levels.outputBlack + Math.pow(normalizedInput, levels.gamma) * outputRange;
    addPoint(x, y);
  }

  addPoint(levels.inputWhite, levels.outputWhite);
  addPoint(255, levels.outputWhite);

  return points;
}

function gammaToMidpoint(settings: LevelsSettings) {
  const levels = normalizeLevelsSettings(settings);
  const normalizedMidpoint = Math.pow(0.5, 1 / levels.gamma);
  return levels.inputBlack + normalizedMidpoint * (levels.inputWhite - levels.inputBlack);
}

function midpointToGamma(midpoint: number, settings: LevelsSettings) {
  const levels = normalizeLevelsSettings(settings);
  const range = Math.max(1, levels.inputWhite - levels.inputBlack);
  const normalizedMidpoint = clamp((midpoint - levels.inputBlack) / range, 0.02, 0.98);
  return Number(clamp(Math.log(0.5) / Math.log(normalizedMidpoint), 0.1, 9.99).toFixed(2));
}

function buildLevelsCurves(levels: ReturnType<typeof getDefaultLevels>) {
  return {
    luma: buildLevelsPoints(levels.luma),
    red: buildLevelsPoints(levels.red),
    green: buildLevelsPoints(levels.green),
    blue: buildLevelsPoints(levels.blue),
  };
}

function convertParametricToPoints(settings: ParametricCurveSettings): Array<Coord> {
  return buildParametricPoints(settings);
}

export default function CurveGraph({
  adjustments,
  setAdjustments,
  histogram,
  theme,
  onDragStateChange,
}: CurveGraphProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const [curveMode, setCurveMode] = useState<CurveMode>(adjustments.curveMode || 'point');
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(ActiveChannel.Luma);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [draggingSplitKey, setDraggingSplitKey] = useState<'split1' | 'split2' | 'split3' | null>(null);
  const [draggingLevelHandle, setDraggingLevelHandle] = useState<LevelHandle | null>(null);
  const [localPoints, setLocalPoints] = useState<Array<Coord> | null>(null);
  const [localParametricSettings, setLocalParametricSettings] = useState<ParametricCurveSettings | null>(null);
  const [localLevelsSettings, setLocalLevelsSettings] = useState<LevelsSettings | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const splitterContainerRef = useRef<HTMLDivElement>(null);
  const inputLevelsContainerRef = useRef<HTMLDivElement>(null);
  const outputLevelsContainerRef = useRef<HTMLDivElement>(null);
  const activeChannelRef = useRef(activeChannel);
  const draggingIndexRef = useRef<number | null>(null);
  const localPointsRef = useRef<Array<Coord> | null>(null);
  const localParametricSettingsRef = useRef<ParametricCurveSettings | null>(null);
  const localLevelsSettingsRef = useRef<LevelsSettings | null>(null);
  const isParametricMode = curveMode === 'parametric';
  const isLevelsMode = curveMode === 'levels';

  const parametricCurves = adjustments?.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
  const parametricCurvesRef = useRef(parametricCurves);
  const levels = adjustments?.levels || getDefaultLevels();
  const levelsRef = useRef(levels);

  useEffect(() => {
    parametricCurvesRef.current = parametricCurves;
  }, [parametricCurves]);

  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  useEffect(() => {
    setCurveMode(adjustments.curveMode || 'point');
  }, [adjustments.curveMode]);

  const activeParametricSettings =
    (draggingSplitKey ? localParametricSettings : null) ?? parametricCurves[activeChannel];

  const activeLevelsSettings = normalizeLevelsSettings(
    (draggingLevelHandle ? localLevelsSettings : null) ?? levels[activeChannel] ?? DEFAULT_LEVELS_SETTINGS,
  );

  const handleToggleMode = (newMode: CurveMode) => {
    if (newMode === curveMode) return;
    setCurveMode(newMode);

    setAdjustments((prev: any) => {
      if (newMode === 'parametric') {
        const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
        return {
          ...prev,
          curveMode: 'parametric',
          pointCurves: prev.curveMode === 'point' ? prev.curves : prev.pointCurves,
          curves: {
            luma: buildParametricPoints(pC.luma),
            red: buildParametricPoints(pC.red),
            green: buildParametricPoints(pC.green),
            blue: buildParametricPoints(pC.blue),
          },
        };
      }

      if (newMode === 'levels') {
        const currentLevels = prev.levels || getDefaultLevels();
        return {
          ...prev,
          curveMode: 'levels',
          pointCurves: prev.curveMode === 'point' ? prev.curves : prev.pointCurves,
          levels: currentLevels,
          curves: buildLevelsCurves(currentLevels),
        };
      }

      const restoredPointCurves = prev.pointCurves || DEFAULT_POINT_CURVES;
      return {
        ...prev,
        curveMode: 'point',
        curves: restoredPointCurves,
      };
    });
  };

  const updateParametricValue = (key: keyof ParametricCurveSettings, value: number) => {
    setAdjustments((prev: any) => {
      const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
      const updatedSettings = { ...pC[activeChannel], [key]: value };
      const newPoints = buildParametricPoints(updatedSettings);

      return {
        ...prev,
        parametricCurve: {
          ...pC,
          [activeChannel]: updatedSettings,
        },
        curves: {
          ...prev.curves,
          [activeChannel]: newPoints,
        },
      };
    });
  };

  const updateLevelsSettings = (settings: LevelsSettings, channel = activeChannelRef.current) => {
    const normalized = normalizeLevelsSettings(settings);
    setLocalLevelsSettings(normalized);
    localLevelsSettingsRef.current = normalized;

    setAdjustments((prev: any) => {
      const currentLevels = prev.levels || getDefaultLevels();
      const newPoints = buildLevelsPoints(normalized);

      return {
        ...prev,
        levels: {
          ...currentLevels,
          [channel]: normalized,
        },
        curves: {
          ...prev.curves,
          [channel]: newPoints,
        },
      };
    });
  };

  useEffect(() => {
    activeChannelRef.current = activeChannel;
    setLocalPoints(null);
    setDraggingPointIndex(null);
    setLocalParametricSettings(null);
    setDraggingSplitKey(null);
    setLocalLevelsSettings(null);
    setDraggingLevelHandle(null);
  }, [activeChannel]);

  useEffect(() => {
    if (draggingPointIndex === null) {
      setLocalPoints(null);
      localPointsRef.current = null;
    }
  }, [adjustments?.curves?.[activeChannel], draggingPointIndex]);

  useEffect(() => {
    const isDragging = draggingPointIndex !== null || draggingSplitKey !== null || draggingLevelHandle !== null;
    onDragStateChange?.(isDragging);
    draggingIndexRef.current = draggingPointIndex;
  }, [draggingPointIndex, draggingSplitKey, draggingLevelHandle, onDragStateChange]);

  useEffect(() => {
    const handleMove = (e: any) => {
      if (isParametricMode && draggingSplitKey) {
        const container = splitterContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rawX = ((clientX - rect.left) / rect.width) * 100;

        const minGap = 10;
        let nextValue = Math.max(0, Math.min(100, rawX));

        const currentSettings =
          localParametricSettingsRef.current || parametricCurvesRef.current[activeChannelRef.current];

        if (draggingSplitKey === 'split1') {
          nextValue = Math.max(10, Math.min(nextValue, currentSettings.split2 - minGap));
        } else if (draggingSplitKey === 'split2') {
          nextValue = Math.max(currentSettings.split1 + minGap, Math.min(nextValue, currentSettings.split3 - minGap));
        } else if (draggingSplitKey === 'split3') {
          nextValue = Math.max(currentSettings.split2 + minGap, Math.min(nextValue, 90));
        }

        const newSettings = { ...currentSettings, [draggingSplitKey]: nextValue };
        localParametricSettingsRef.current = newSettings;
        setLocalParametricSettings(newSettings);

        updateParametricValue(draggingSplitKey, nextValue);

        if (e.cancelable) e.preventDefault();
        return;
      }

      if (isLevelsMode && draggingLevelHandle) {
        const isOutputHandle = draggingLevelHandle === 'outputBlack' || draggingLevelHandle === 'outputWhite';
        const container = isOutputHandle ? outputLevelsContainerRef.current : inputLevelsContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rawValue = clamp(((clientX - rect.left) / rect.width) * 255, 0, 255);
        const currentSettings = normalizeLevelsSettings(
          localLevelsSettingsRef.current || levelsRef.current[activeChannelRef.current] || DEFAULT_LEVELS_SETTINGS,
        );
        let newSettings: LevelsSettings = { ...currentSettings };

        if (draggingLevelHandle === 'inputBlack') {
          newSettings.inputBlack = clamp(rawValue, 0, currentSettings.inputWhite - 1);
        } else if (draggingLevelHandle === 'gamma') {
          newSettings.gamma = midpointToGamma(rawValue, currentSettings);
        } else if (draggingLevelHandle === 'inputWhite') {
          newSettings.inputWhite = clamp(rawValue, currentSettings.inputBlack + 1, 255);
        } else if (draggingLevelHandle === 'outputBlack') {
          newSettings.outputBlack = clamp(rawValue, 0, currentSettings.outputWhite - 1);
        } else if (draggingLevelHandle === 'outputWhite') {
          newSettings.outputWhite = clamp(rawValue, currentSettings.outputBlack + 1, 255);
        }

        newSettings = normalizeLevelsSettings(newSettings);
        updateLevelsSettings(newSettings);

        if (e.cancelable) e.preventDefault();
        return;
      }

      if (!isParametricMode && !isLevelsMode && draggingIndexRef.current !== null) {
        const index = draggingIndexRef.current;
        const currentPoints = localPointsRef.current || adjustments?.curves?.[activeChannelRef.current];
        if (!currentPoints) return;

        const svg = svgRef.current;
        if (!svg) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const rect = svg.getBoundingClientRect();
        let x = Math.max(0, Math.min(255, ((clientX - rect.left) / rect.width) * 255));
        const y = Math.max(0, Math.min(255, 255 - ((clientY - rect.top) / rect.height) * 255));

        const newPoints = [...currentPoints];
        const SNAP_THRESHOLD = 5;
        if (x < SNAP_THRESHOLD) x = 0;
        if (x > 255 - SNAP_THRESHOLD) x = 255;

        const prevX = index > 0 ? currentPoints[index - 1].x : 0;
        const nextX = index < currentPoints.length - 1 ? currentPoints[index + 1].x : 255;
        const minX = index === 0 ? 0 : prevX + 0.01;
        const maxX = index === currentPoints.length - 1 ? 255 : nextX - 0.01;

        x = Math.max(minX, Math.min(maxX, x));
        newPoints[index] = { x, y };

        localPointsRef.current = newPoints;
        setLocalPoints(newPoints);

        setAdjustments((prev: any) => ({
          ...prev,
          curves: { ...prev.curves, [activeChannelRef.current]: newPoints },
        }));

        if (e.cancelable) e.preventDefault();
      }
    };

    const handleUp = () => {
      setDraggingPointIndex(null);
      setDraggingSplitKey(null);
      setDraggingLevelHandle(null);
      draggingIndexRef.current = null;
      localPointsRef.current = null;
      setLocalParametricSettings(null);
      localParametricSettingsRef.current = null;
      setLocalLevelsSettings(null);
      localLevelsSettingsRef.current = null;
      onDragStateChange?.(false);
    };

    if (draggingPointIndex !== null || draggingSplitKey !== null || draggingLevelHandle !== null) {
      window.addEventListener('mousemove', handleMove, { passive: false });
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp);
      window.addEventListener('touchcancel', handleUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      window.removeEventListener('touchcancel', handleUp);
    };
  }, [draggingPointIndex, draggingSplitKey, draggingLevelHandle, isParametricMode, isLevelsMode]);

  const isLightTheme = theme === Theme.Light || theme === Theme.Arctic;
  const histogramOpacity = isLightTheme ? 0.6 : 0.15;

  const channelConfig: ChannelConfig = useMemo(
    () => ({
      luma: { color: 'var(--color-accent)', data: histogram?.luma },
      red: { color: '#FF6B6B', data: histogram?.red },
      green: { color: '#6BCB77', data: histogram?.green },
      blue: { color: '#4D96FF', data: histogram?.blue },
    }),
    [histogram],
  );

  const activePoints: Array<Coord> = isLevelsMode
    ? buildLevelsPoints(activeLevelsSettings)
    : isParametricMode
      ? buildParametricPoints(activeParametricSettings)
      : (localPoints ?? adjustments?.curves?.[activeChannel] ?? DEFAULT_POINT_CURVES[activeChannel]);

  const { color, data: histogramData } = channelConfig[activeChannel];

  const handlePointStart = (e: any, index: number) => {
    if (isParametricMode || isLevelsMode || e.button === 2) return;
    if (!e.touches) e.preventDefault();
    e.stopPropagation();

    onDragStateChange?.(true);
    setLocalPoints(activePoints);
    localPointsRef.current = activePoints;
    setDraggingPointIndex(index);
    draggingIndexRef.current = index;
  };

  const handlePointContextMenu = (e: React.MouseEvent, index: number) => {
    if (isParametricMode || isLevelsMode) return;
    if (index > 0 && index < activePoints.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      const newPoints = activePoints.filter((_: Coord, i: number) => i !== index);
      setLocalPoints(newPoints);
      localPointsRef.current = newPoints;
      setAdjustments((prev: any) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannel]: newPoints },
      }));
    }
  };

  const handleContainerStart = (e: any) => {
    if (isParametricMode || isLevelsMode || (!e.touches && e.button !== 0) || e.target.tagName === 'circle') return;
    onDragStateChange?.(true);

    const svg = svgRef.current;
    if (!svg) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(255, ((clientX - rect.left) / rect.width) * 255));
    const y = Math.max(0, Math.min(255, 255 - ((clientY - rect.top) / rect.height) * 255));

    const newPoints = [...activePoints, { x, y }].sort((a: Coord, b: Coord) => a.x - b.x);
    const newPointIndex = newPoints.findIndex((p: Coord) => p.x === x && p.y === y);

    setLocalPoints(newPoints);
    localPointsRef.current = newPoints;
    setAdjustments((prev: any) => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: newPoints },
    }));
    setDraggingPointIndex(newPointIndex);
    draggingIndexRef.current = newPointIndex;
  };

  const handleLevelHandleStart = (handle: LevelHandle, e: any) => {
    if (!e.touches) e.preventDefault();
    e.stopPropagation();
    onDragStateChange?.(true);
    const settings = normalizeLevelsSettings(levelsRef.current[activeChannelRef.current] || DEFAULT_LEVELS_SETTINGS);
    setLocalLevelsSettings(settings);
    localLevelsSettingsRef.current = settings;
    setDraggingLevelHandle(handle);
  };

  const handleDoubleClick = () => {
    if (isLevelsMode) {
      const defaultSettings = { ...DEFAULT_LEVELS_SETTINGS };
      updateLevelsSettings(defaultSettings);
    } else if (isParametricMode) {
      const defaultSettings = { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS };
      setAdjustments((prev: any) => {
        const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
        return {
          ...prev,
          parametricCurve: { ...pC, [activeChannel]: defaultSettings },
          curves: { ...prev.curves, [activeChannel]: buildParametricPoints(defaultSettings) },
        };
      });
    } else {
      const defaultPoints = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      setLocalPoints(defaultPoints);
      setAdjustments((prev: any) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannel]: defaultPoints },
      }));
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const channelLabel = t(`adjustments.curves.channels.${activeChannel}`);

    if (isLevelsMode) {
      const handleCopyLevels = () => {
        levelsClipboard = { ...activeLevelsSettings };
      };

      const handlePasteLevels = () => {
        if (!levelsClipboard) return;
        updateLevelsSettings({ ...levelsClipboard });
      };

      const handleResetLevels = () => {
        updateLevelsSettings({ ...DEFAULT_LEVELS_SETTINGS });
      };

      const handleResetAllLevels = () => {
        const defaultLevels = getDefaultLevels();
        setLocalLevelsSettings(null);
        localLevelsSettingsRef.current = null;
        setAdjustments((prev: any) => ({
          ...prev,
          levels: defaultLevels,
          curves: buildLevelsCurves(defaultLevels),
        }));
      };

      const areOtherLevelsDirty = [ActiveChannel.Luma, ActiveChannel.Red, ActiveChannel.Green, ActiveChannel.Blue].some(
        (channel) => {
          const settings = normalizeLevelsSettings(levels[channel] || DEFAULT_LEVELS_SETTINGS);
          return (
            channel !== activeChannel &&
            (settings.inputBlack !== DEFAULT_LEVELS_SETTINGS.inputBlack ||
              settings.gamma !== DEFAULT_LEVELS_SETTINGS.gamma ||
              settings.inputWhite !== DEFAULT_LEVELS_SETTINGS.inputWhite ||
              settings.outputBlack !== DEFAULT_LEVELS_SETTINGS.outputBlack ||
              settings.outputWhite !== DEFAULT_LEVELS_SETTINGS.outputWhite)
          );
        },
      );

      const options = [
        {
          label: t('adjustments.curves.copyLevels', { channel: channelLabel }),
          icon: Copy,
          onClick: handleCopyLevels,
        },
        {
          label: t('adjustments.curves.pasteLevels'),
          icon: ClipboardPaste,
          onClick: handlePasteLevels,
          disabled: !levelsClipboard,
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('adjustments.curves.resetLevels', { channel: channelLabel }),
          icon: RotateCcw,
          onClick: handleResetLevels,
        },
      ];

      if (areOtherLevelsDirty) {
        options.push({
          label: t('adjustments.curves.resetAllLevels'),
          icon: RotateCcw,
          onClick: handleResetAllLevels,
        });
      }

      showContextMenu(e.clientX, e.clientY, options);
      return;
    }

    if (isParametricMode) {
      const handleCopyParametric = () => {
        parametricClipboard = { ...activeParametricSettings };
      };

      const handlePasteParametric = () => {
        if (!parametricClipboard) return;
        setAdjustments((prev: any) => {
          const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
          return {
            ...prev,
            parametricCurve: { ...pC, [activeChannel]: { ...parametricClipboard } },
            curves: { ...prev.curves, [activeChannel]: buildParametricPoints(parametricClipboard) },
          };
        });
      };

      const handleResetParametric = () => {
        setAdjustments((prev: any) => {
          const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
          return {
            ...prev,
            parametricCurve: { ...pC, [activeChannel]: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS } },
            curves: {
              ...prev.curves,
              [activeChannel]: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
            },
          };
        });
      };

      const handleResetAllParametric = () => {
        setLocalParametricSettings(null);
        localParametricSettingsRef.current = null;
        setAdjustments((prev: any) => {
          return {
            ...prev,
            parametricCurve: {
              luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
            },
            curves: {
              luma: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              red: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              green: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              blue: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
            },
          };
        });
      };

      const areOtherParametricCurvesDirty = [
        ActiveChannel.Luma,
        ActiveChannel.Red,
        ActiveChannel.Green,
        ActiveChannel.Blue,
      ].some((channel) => channel !== activeChannel && !isDefaultParametricCurve(parametricCurves[channel]));

      const options = [
        {
          label: t('adjustments.curves.copyParametric', { channel: channelLabel }),
          icon: Copy,
          onClick: handleCopyParametric,
        },
        {
          label: t('adjustments.curves.pasteParametric'),
          icon: ClipboardPaste,
          onClick: handlePasteParametric,
          disabled: !parametricClipboard,
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('adjustments.curves.resetParametric', { channel: channelLabel }),
          icon: RotateCcw,
          onClick: handleResetParametric,
        },
      ];

      if (areOtherParametricCurvesDirty) {
        options.push({
          label: t('adjustments.curves.resetAllParametric'),
          icon: RotateCcw,
          onClick: handleResetAllParametric,
        });
      }

      showContextMenu(e.clientX, e.clientY, options);
      return;
    }

    const handleCopy = () => {
      curveClipboard = activePoints.map((p: Coord) => ({ ...p }));
    };

    const handlePaste = () => {
      if (!curveClipboard) return;
      const newPoints = curveClipboard.map((p) => ({ ...p }));
      setLocalPoints(newPoints);
      localPointsRef.current = newPoints;
      setAdjustments((prev: any) => ({ ...prev, curves: { ...prev.curves, [activeChannel]: newPoints } }));
    };

    const handlePasteFromParametric = () => {
      if (!parametricClipboard) return;
      const newPoints = convertParametricToPoints(parametricClipboard);
      setLocalPoints(newPoints);
      localPointsRef.current = newPoints;
      setAdjustments((prev: any) => ({ ...prev, curves: { ...prev.curves, [activeChannel]: newPoints } }));
    };

    const handleReset = () => {
      const defaultPoints = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      setLocalPoints(defaultPoints);
      localPointsRef.current = defaultPoints;
      setAdjustments((prev: any) => ({ ...prev, curves: { ...prev.curves, [activeChannel]: defaultPoints } }));
    };

    const handleResetAllPoint = () => {
      const defaultPoints = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      setLocalPoints(defaultPoints);
      localPointsRef.current = defaultPoints;
      setAdjustments((prev: any) => ({
        ...prev,
        curves: {
          [ActiveChannel.Luma]: [...defaultPoints],
          [ActiveChannel.Red]: [...defaultPoints],
          [ActiveChannel.Green]: [...defaultPoints],
          [ActiveChannel.Blue]: [...defaultPoints],
        },
      }));
    };

    const areOtherPointCurvesDirty = [
      ActiveChannel.Luma,
      ActiveChannel.Red,
      ActiveChannel.Green,
      ActiveChannel.Blue,
    ].some((channel) => channel !== activeChannel && !isDefaultCurve(adjustments.curves?.[channel]));

    const options = [
      {
        label: t('adjustments.curves.copyPoint', { channel: channelLabel }),
        icon: Copy,
        onClick: handleCopy,
      },
      {
        label: t('adjustments.curves.pastePoint'),
        icon: ClipboardPaste,
        onClick: handlePaste,
        disabled: !curveClipboard,
      },
      {
        label: t('adjustments.curves.pasteFromParametric'),
        icon: ClipboardPaste,
        onClick: handlePasteFromParametric,
        disabled: !parametricClipboard,
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('adjustments.curves.resetPoint', { channel: channelLabel }),
        icon: RotateCcw,
        onClick: handleReset,
      },
    ];

    if (areOtherPointCurvesDirty) {
      options.push({
        label: t('adjustments.curves.resetAllPoint'),
        icon: RotateCcw,
        onClick: handleResetAllPoint,
      });
    }

    showContextMenu(e.clientX, e.clientY, options);
  };

  const splitPositions = useMemo(
    () => [
      { key: 'split1' as const, value: activeParametricSettings.split1 },
      { key: 'split2' as const, value: activeParametricSettings.split2 },
      { key: 'split3' as const, value: activeParametricSettings.split3 },
    ],
    [activeParametricSettings.split1, activeParametricSettings.split2, activeParametricSettings.split3],
  );

  const levelValues = [
    Math.round(activeLevelsSettings.inputBlack),
    activeLevelsSettings.gamma.toFixed(2),
    Math.round(activeLevelsSettings.inputWhite),
  ];

  const renderLevelHandle = (handle: LevelHandle, value: number, title: string, isOutput = false) => (
    <button
      aria-label={title}
      className={`absolute -translate-x-1/2 ${isOutput ? '-top-0.5' : '-top-1'} h-5 w-5 cursor-ew-resize touch-none`}
      onMouseDown={(e) => handleLevelHandleStart(handle, e)}
      onTouchStart={(e) => handleLevelHandleStart(handle, e)}
      style={{ left: `${(clamp(value, 0, 255) / 255) * 100}%` }}
      title={title}
      type="button"
    >
      <span
        className={`absolute left-1/2 -translate-x-1/2 ${isOutput ? 'top-1' : 'top-0'} h-0 w-0 border-l-[5px] border-r-[5px] border-l-transparent border-r-transparent ${
          isOutput ? 'border-b-[8px] border-b-text-primary' : 'border-t-[8px] border-t-text-primary'
        } drop-shadow`}
      />
    </button>
  );

  if (!activePoints) {
    return (
      <Text
        as="div"
        variant={TextVariants.small}
        className="w-full aspect-square bg-surface-secondary p-1 rounded-md flex items-center justify-center"
      >
        {t('adjustments.curves.curveDataUnavailable')}
      </Text>
    );
  }

  return (
    <div className="select-none touch-none" ref={containerRef}>
      <div className="flex items-center justify-between gap-2 mb-1.5 mt-1.5">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-secondary shrink-0">
          <button
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-all ${
              !isParametricMode && !isLevelsMode ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => handleToggleMode('point')}
            data-tooltip={t('adjustments.curves.pointCurve')}
            type="button"
          >
            <Spline size={16} />
          </button>
          <button
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-all ${
              isParametricMode ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => handleToggleMode('parametric')}
            data-tooltip={t('adjustments.curves.parametricCurve')}
            type="button"
          >
            <Settings2 size={16} />
          </button>
          <button
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-all ${
              isLevelsMode ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => handleToggleMode('levels')}
            data-tooltip={t('adjustments.curves.levels')}
            type="button"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {[ActiveChannel.Luma, ActiveChannel.Red, ActiveChannel.Green, ActiveChannel.Blue].map((channel: ActiveChannel) => {
            const selected = activeChannel === channel;
            const channelLabel = t(`adjustments.curves.channels.${channel}` as any) as string;
            return (
              <button
                key={channel}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  selected ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent' : 'bg-surface-secondary'
                } ${channel === ActiveChannel.Luma ? 'text-text-primary' : ''}`}
                onClick={() => setActiveChannel(channel as ActiveChannel)}
                type="button"
                style={{
                  backgroundColor:
                    channel !== ActiveChannel.Luma && !selected ? channelConfig[channel].color + '40' : undefined,
                }}
                title={t('adjustments.curves.channelTitle', { channel: channelLabel })}
              >
                <Text variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.bold}>
                  {channelLabel.charAt(0).toUpperCase()}
                </Text>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <div
          className={`w-full bg-surface-secondary p-1 rounded-md relative touch-none ${isLevelsMode ? 'h-36' : 'aspect-square'}`}
          onMouseDown={handleContainerStart}
          onTouchStart={handleContainerStart}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        >
          <svg ref={svgRef} viewBox="0 0 255 255" className="w-full h-full overflow-visible">
            <path
              d={
                isParametricMode || isLevelsMode
                  ? 'M 0,63.75 H 255 M 0,127.5 H 255 M 0,191.25 H 255'
                  : 'M 63.75,0 V 255 M 127.5,0 V 255 M 191.25,0 V 255 M 0,63.75 H 255 M 0,127.5 H 255 M 0,191.25 H 255'
              }
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="0.5"
            />
            <AnimatePresence>
              {histogramData && (
                <motion.path
                  key={activeChannel}
                  fill={color}
                  initial={{ d: getZeroHistogramPath(histogramData), opacity: 0 }}
                  animate={{
                    d: getHistogramPath(histogramData),
                    opacity: histogramOpacity,
                    transition: { d: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 1 } },
                  }}
                  exit={{
                    d: getZeroHistogramPath(histogramData),
                    opacity: 0,
                    transition: { d: { duration: 0.3, ease: [0.55, 0, 0.78, 0.34] }, opacity: { duration: 1 } },
                  }}
                />
              )}
            </AnimatePresence>
            <line
              x1="0"
              y1="255"
              x2="255"
              y2="0"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />

            {isParametricMode &&
              splitPositions.map(({ key, value }) => {
                const x = (value / 100) * 255;
                return <line key={key} x1={x} y1="0" x2={x} y2="255" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />;
              })}

            <path d={getCurvePath(activePoints)} fill="none" stroke={color} strokeWidth="2.5" />

            {isParametricMode && activePoints.length >= 2 && (
              <>
                <circle
                  cx={activePoints[0]?.x || 0}
                  cy={255 - (activePoints[0]?.y || 0)}
                  fill={color}
                  r="6"
                  stroke="#1e1e1e"
                  strokeWidth="2"
                />
                <circle
                  cx={activePoints[activePoints.length - 1]?.x || 255}
                  cy={255 - (activePoints[activePoints.length - 1]?.y || 255)}
                  fill={color}
                  r="6"
                  stroke="#1e1e1e"
                  strokeWidth="2"
                />
              </>
            )}

            {!isParametricMode && !isLevelsMode &&
              activePoints.map((p: Coord, i: number) => (
                <circle
                  className="cursor-pointer"
                  cx={p.x}
                  cy={255 - p.y}
                  fill={color}
                  key={i}
                  onMouseDown={(e: any) => handlePointStart(e, i)}
                  onTouchStart={(e: any) => handlePointStart(e, i)}
                  onContextMenu={(e: React.MouseEvent) => handlePointContextMenu(e, i)}
                  r="6"
                  stroke="#1e1e1e"
                  strokeWidth="2"
                />
              ))}
          </svg>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isLevelsMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden origin-top"
          >
            <div className="pt-3 pb-1 flex flex-col gap-3" onContextMenu={handleContextMenu}>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Text variant={TextVariants.small} color={TextColors.secondary} weight={TextWeights.medium}>
                    {t('adjustments.curves.inputLevels')}
                  </Text>
                  <div className="flex gap-1">
                    {levelValues.map((value, index) => (
                      <div key={index} className="min-w-10 rounded bg-surface-secondary px-1.5 py-0.5 text-center">
                        <Text variant={TextVariants.small} color={TextColors.primary}>
                          {value}
                        </Text>
                      </div>
                    ))}
                  </div>
                </div>
                <div ref={inputLevelsContainerRef} className="relative h-7 px-0.5">
                  <div
                    className="absolute left-0 right-0 top-2 h-3 rounded-sm border border-surface bg-surface overflow-hidden"
                    style={{ background: getSplitterGradient(activeChannel) }}
                  />
                  {renderLevelHandle('inputBlack', activeLevelsSettings.inputBlack, t('adjustments.curves.inputBlack'))}
                  {renderLevelHandle('gamma', gammaToMidpoint(activeLevelsSettings), t('adjustments.curves.gamma'))}
                  {renderLevelHandle('inputWhite', activeLevelsSettings.inputWhite, t('adjustments.curves.inputWhite'))}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Text variant={TextVariants.small} color={TextColors.secondary} weight={TextWeights.medium}>
                    {t('adjustments.curves.outputLevels')}
                  </Text>
                  <div className="flex gap-1">
                    {[Math.round(activeLevelsSettings.outputBlack), Math.round(activeLevelsSettings.outputWhite)].map(
                      (value, index) => (
                        <div key={index} className="min-w-10 rounded bg-surface-secondary px-1.5 py-0.5 text-center">
                          <Text variant={TextVariants.small} color={TextColors.primary}>
                            {value}
                          </Text>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div ref={outputLevelsContainerRef} className="relative h-7 px-0.5">
                  <div className="absolute left-0 right-0 top-2 h-3 rounded-sm border border-surface bg-gradient-to-r from-black via-gray-400 to-white" />
                  {renderLevelHandle(
                    'outputBlack',
                    activeLevelsSettings.outputBlack,
                    t('adjustments.curves.outputBlack'),
                    true,
                  )}
                  {renderLevelHandle(
                    'outputWhite',
                    activeLevelsSettings.outputWhite,
                    t('adjustments.curves.outputWhite'),
                    true,
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {isParametricMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden origin-top"
          >
            <div className="pt-3 pb-1 flex flex-col gap-3" onContextMenu={handleContextMenu}>
              <div className="px-1">
                <div className="relative" ref={splitterContainerRef}>
                  <div className="h-7 rounded-md bg-surface overflow-hidden relative">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: getSplitterGradient(activeChannel),
                      }}
                    />
                    {splitPositions.map(({ key, value }) => (
                      <button
                        key={key}
                        className="absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize group"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          localParametricSettingsRef.current = { ...activeParametricSettings };
                          setDraggingSplitKey(key);
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          localParametricSettingsRef.current = { ...activeParametricSettings };
                          setDraggingSplitKey(key);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          updateParametricValue(key, DEFAULT_PARAMETRIC_CURVE_SETTINGS[key]);
                        }}
                        style={{ left: `${value}%` }}
                        type="button"
                      >
                        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/70 group-hover:bg-white" />
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-white/80 border border-white/60 group-hover:bg-white group-hover:border-white" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Slider
                  label={t('adjustments.curves.params.whiteLevel')}
                  min={-100}
                  max={0}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.whiteLevel}
                  onChange={(e: any) => updateParametricValue('whiteLevel', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
                <Slider
                  label={t('adjustments.curves.params.highlights')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.highlights}
                  onChange={(e: any) => updateParametricValue('highlights', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
                <Slider
                  label={t('adjustments.curves.params.lights')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.lights}
                  onChange={(e: any) => updateParametricValue('lights', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
                <Slider
                  label={t('adjustments.curves.params.darks')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.darks}
                  onChange={(e: any) => updateParametricValue('darks', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
                <Slider
                  label={t('adjustments.curves.params.shadows')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.shadows}
                  onChange={(e: any) => updateParametricValue('shadows', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
                <Slider
                  label={t('adjustments.curves.params.blackLevel')}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.blackLevel}
                  onChange={(e: any) => updateParametricValue('blackLevel', parseFloat(e.target.value))}
                  onDragStateChange={onDragStateChange}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
