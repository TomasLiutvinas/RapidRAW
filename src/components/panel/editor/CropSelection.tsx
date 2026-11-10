import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import ReactCrop, { type Crop, type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import './CropSelection.css';
import type { CropChangeOptions } from '../../../utils/cropUtils';
import type { OverlayMode } from '../right/CropPanel';
import CompositionOverlays from './overlays/CompositionOverlays';

interface CropSelectionProps {
  crop: Crop | null;
  active: boolean;
  onOffsetChange?(offset: { x: number; y: number }): void;
  aspect?: number;
  width: number;
  height: number;
  sizerRef: RefObject<HTMLDivElement | null>;
  imageUrl?: string;
  imageTransform: string;
  overlayMode: OverlayMode;
  overlayRotation: number;
  denseGrid: boolean;
  onChange(crop: Crop, percent: PercentCrop, options?: CropChangeOptions): PercentCrop | undefined;
  onComplete(crop: Crop, percent: PercentCrop): void;
  rotationEvents?: {
    onPointerDown(event: PointerEvent<HTMLDivElement>): void;
    onPointerMove(event: PointerEvent<HTMLDivElement>): void;
    onPointerUp(event: PointerEvent<HTMLDivElement>): void;
    onPointerCancel(event: PointerEvent<HTMLDivElement>): void;
  };
}

const asPercent = (crop: Crop | null, width: number, height: number): PercentCrop => {
  if (!crop) return { unit: '%', x: 0, y: 0, width: 100, height: 100 };
  if (crop.unit === '%') return crop as PercentCrop;
  return {
    unit: '%',
    x: (crop.x / width) * 100,
    y: (crop.y / height) * 100,
    width: (crop.width / width) * 100,
    height: (crop.height / height) * 100,
  };
};

/** Keep pointer-frequency work out of the editor, preview pipeline and undo history. */
export default function CropSelection(props: CropSelectionProps) {
  const { crop, width, height, sizerRef, imageUrl, imageTransform, rotationEvents } = props;
  const [draft, setDraft] = useState(() => asPercent(crop, width, height));
  const draftRef = useRef(draft);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  const frame = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const gesture = useRef<{
    kind: 'pan' | 'resize';
    crop: PercentCrop;
    offset: { x: number; y: number };
    x: number;
    y: number;
    width: number;
    height: number;
    centered: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (props.active) props.onOffsetChange?.({ x: 0, y: 0 });
  }, [props.active, props.onOffsetChange]);

  useLayoutEffect(() => {
    if (gesture.current) return;
    const next = asPercent(crop, width, height);
    draftRef.current = next;
    setDraft(next);
    if (next.width > 99.9 && next.height > 99.9) {
      offsetRef.current = { x: 0, y: 0 };
      setOffset(offsetRef.current);
      if (props.active) props.onOffsetChange?.(offsetRef.current);
    }
  }, [crop, width, height]);

  useLayoutEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const paint = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setDraft(draftRef.current);
      setOffset(offsetRef.current);
    });
  };

  const change = (pixels: Crop, percent: PercentCrop) => {
    const drag = gesture.current;
    const accepted = props.onChange(pixels, percent, {
      previewOnly: true,
      centered: drag?.kind === 'resize' && drag.centered,
      startCrop: drag?.kind === 'resize' ? drag.crop : undefined,
    });
    if (accepted) {
      draftRef.current = accepted;
      paint();
    }
    return accepted;
  };

  const restore = () => {
    const drag = gesture.current;
    if (!drag) return;
    // Restore the constraint anchor too, without generating a saved edit.
    props.onChange(drag.crop, drag.crop, { previewOnly: true });
    draftRef.current = drag.crop;
    offsetRef.current = drag.offset;
    props.onOffsetChange?.(offsetRef.current);
    paint();
  };

  const complete = () => {
    if (!cancelled.current) props.onComplete(draftRef.current, draftRef.current);
    gesture.current = null;
    cancelled.current = false;
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const handle = target.closest('[data-ord]');
    if (!handle && (!imageUrl || !target.closest('.ReactCrop__crop-selection'))) return;
    const rect = root.current!.getBoundingClientRect();
    gesture.current = {
      kind: handle ? 'resize' : 'pan',
      crop: draftRef.current,
      offset: offsetRef.current,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      centered: event.altKey || event.ctrlKey || event.metaKey,
    };
    cancelled.current = false;
    if (!handle) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (drag?.kind !== 'pan') return;
    event.preventDefault();
    event.stopPropagation();
    const proposed: PercentCrop = {
      ...drag.crop,
      x: drag.crop.x - ((event.clientX - drag.x) / drag.width) * 100,
      y: drag.crop.y - ((event.clientY - drag.y) / drag.height) * 100,
    };
    const accepted = change(proposed, proposed);
    if (accepted) {
      offsetRef.current = {
        x: drag.offset.x + drag.crop.x - accepted.x,
        y: drag.offset.y + drag.crop.y - accepted.y,
      };
      props.onOffsetChange?.(offsetRef.current);
    }
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.kind !== 'pan') return;
    pointerMove(event);
    complete();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const left = draft.x;
  const top = draft.y;
  const right = left + draft.width;
  const bottom = top + draft.height;
  const zones = [
    { left: '-44px', top: '-44px', width: 'calc(100% + 88px)', height: `calc(${top}% + 44px)` },
    { left: '-44px', top: `${bottom}%`, width: 'calc(100% + 88px)', height: `calc(${100 - bottom}% + 44px)` },
    { left: '-44px', top: `${top}%`, width: `calc(${left}% + 44px)`, height: `${draft.height}%` },
    { left: `${right}%`, top: `${top}%`, width: `calc(${100 - right}% + 44px)`, height: `${draft.height}%` },
  ];

  return (
    <div
      ref={root}
      className="rapidraw-crop-viewport"
      style={{ transform: `translate(${offset.x}%, ${offset.y}%)` }}
      onPointerDownCapture={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        if (gesture.current?.kind === 'pan') {
          restore();
          gesture.current = null;
        }
      }}
    >
      <ReactCrop
        className="rapidraw-crop ReactCrop--no-animate"
        crop={draft}
        aspect={props.aspect}
        keepSelection
        renderSelectionAddon={() => (
          <CompositionOverlays
            width={(width * draft.width) / 100}
            height={(height * draft.height) / 100}
            mode={props.overlayMode}
            rotation={props.overlayRotation}
            denseVisible={props.denseGrid}
          />
        )}
        onChange={change}
        onComplete={complete}
        onDragEnd={(event) => {
          cancelled.current = event.type === 'pointercancel';
          if (cancelled.current) restore();
        }}
      >
        <div ref={sizerRef} style={{ position: 'relative', overflow: 'hidden' }}>
          {imageUrl && (
            <img
              alt=""
              draggable={false}
              src={imageUrl}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                transform: imageTransform,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </ReactCrop>
      {rotationEvents &&
        zones.map((zone, index) => (
          <div key={index} className="rapidraw-crop-rotate" style={zone} {...rotationEvents} />
        ))}
    </div>
  );
}
