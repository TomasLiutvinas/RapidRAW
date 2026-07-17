import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import { Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Partial<Adjustments>) => Partial<Adjustments>)): void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

type SliderChangeEvent = { target: { value: number | string } };

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: number | string) => {
    const numericValue = parseFloat(String(value));
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-3">
      {adjustmentVisibility.sharpening !== false && (
        <div className="p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-1.5">
            {t('adjustments.details.sharpening')}
          </Text>
          <Slider
            label={t('adjustments.details.amount')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => handleAdjustmentChange(DetailsAdjustment.Sharpness, e.target.value)}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <Slider
                label={t('adjustments.details.radius')}
                max={3}
                min={0.5}
                onChange={(e: SliderChangeEvent) =>
                  handleAdjustmentChange(DetailsAdjustment.SharpenRadius, e.target.value)
                }
                step={0.1}
                value={adjustments.sharpenRadius ?? 1.0}
                onDragStateChange={onDragStateChange}
                defaultValue={1.0}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.detail')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) =>
                  handleAdjustmentChange(DetailsAdjustment.SharpenDetail, e.target.value)
                }
                step={1}
                value={adjustments.sharpenDetail ?? 25}
                onDragStateChange={onDragStateChange}
                defaultValue={25}
                fillOrigin="min"
              />
            </>
          )}
          <Slider
            label={t('adjustments.details.masking')}
            max={100}
            min={0}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, e.target.value)
            }
            step={1}
            value={adjustments.sharpnessThreshold ?? 15}
            onDragStateChange={onDragStateChange}
            defaultValue={15}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility.presence !== false && (
        <div className="p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-1.5">
            {t('adjustments.details.presence')}
          </Text>
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => handleAdjustmentChange(DetailsAdjustment.Clarity, e.target.value)}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => handleAdjustmentChange(DetailsAdjustment.Dehaze, e.target.value)}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.structure')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => handleAdjustmentChange(DetailsAdjustment.Structure, e.target.value)}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(DetailsAdjustment.Centré, e.target.value)}
              step={1}
              value={adjustments.centré}
              onDragStateChange={onDragStateChange}
            />
          )}
        </div>
      )}

      {adjustmentVisibility.noiseReduction !== false && (
        <div className="p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-1.5">
            {t('adjustments.details.noiseReduction')}
          </Text>
          <Slider
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, e.target.value)
            }
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, e.target.value)
            }
            step={1}
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      {!isForMask && adjustmentVisibility.chromaticAberration !== false && (
        <div className="p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-1.5">
            {t('adjustments.details.chromaticAberration')}
          </Text>
          <Slider
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, e.target.value)
            }
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, e.target.value)
            }
            step={1}
            value={adjustments.chromaticAberrationBlueYellow}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </div>
  );
}
