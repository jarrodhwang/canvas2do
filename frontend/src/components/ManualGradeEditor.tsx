import { Calculator, CheckCircle2 } from 'lucide-react';

import { useLanguage } from '../context/LanguageContext';
import {
  defaultGradeProgressColorThresholds,
  getGradeProgressColor,
  type GradeProgressColorThresholds,
} from '../lib/gradeProgress';
import type {
  ManualLectureAssessment,
  ManualLectureGradeInputMode,
  ManualLectureGradeItem,
} from './ManualLectureDialog';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface ManualGradeEditorProps {
  assessments: ManualLectureAssessment[];
  gradeProgressThresholds?: GradeProgressColorThresholds;
  onChange?: (assessments: ManualLectureAssessment[]) => void;
}

export interface ManualGradeSummary {
  currentPercent?: number;
  earnedContribution: number;
  gradedItems: number;
  gradedWeight: number;
  totalItems: number;
  totalWeight: number;
}

function createGradeItemId(assessmentId: string, index: number) {
  return `${assessmentId}-grade-${index + 1}`;
}

function parsePositiveNumber(value?: string) {
  const numberValue = Number.parseFloat(value ?? '');

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function normalizeDecimalInput(value: string) {
  if (!value.trim()) {
    return '';
  }

  return value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
}

function getAssessmentCount(assessment: ManualLectureAssessment) {
  const count = Number.parseInt(assessment.count, 10);

  return Number.isFinite(count) && count > 0 ? count : 1;
}

function getAssessmentWeight(assessment: ManualLectureAssessment) {
  return parsePositiveNumber(assessment.gradePortion) ?? 0;
}

function getItemWeight(assessment: ManualLectureAssessment) {
  const count = getAssessmentCount(assessment);

  return count > 0 ? getAssessmentWeight(assessment) / count : 0;
}

function getGeneratedGradeItems(assessment: ManualLectureAssessment) {
  const existingItems = Array.isArray(assessment.gradeItems) ? assessment.gradeItems : [];
  const count = getAssessmentCount(assessment);

  return Array.from({ length: count }, (_, index) => {
    const existingItem = existingItems[index];

    return {
      id: existingItem?.id || createGradeItemId(assessment.id, index),
      label: existingItem?.label || `${assessment.label} ${index + 1}`,
      percentage: existingItem?.percentage ?? '',
      pointsEarned: existingItem?.pointsEarned ?? '',
      pointsPossible: existingItem?.pointsPossible ?? '',
    } satisfies ManualLectureGradeItem;
  });
}

function formatStoredNumber(value: number) {
  const roundedValue = Math.round(value * 100) / 100;

  return Number.isInteger(roundedValue)
    ? String(roundedValue)
    : String(roundedValue).replace(/0+$/, '').replace(/\.$/, '');
}

function getPercentageModePercent(item: ManualLectureGradeItem) {
  const percent = parsePositiveNumber(item.percentage);

  return typeof percent === 'number' ? Math.min(percent, 100) : undefined;
}

function getPointsModePercent(item: ManualLectureGradeItem) {
  const earned = parsePositiveNumber(item.pointsEarned);
  const possible = parsePositiveNumber(item.pointsPossible);

  if (typeof earned !== 'number' || typeof possible !== 'number' || possible <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(100, (earned / possible) * 100));
}

function getGradeItemPercent(item: ManualLectureGradeItem, mode: ManualLectureGradeInputMode) {
  if (mode === 'percentage') {
    return getPercentageModePercent(item) ?? getPointsModePercent(item);
  }

  return getPointsModePercent(item);
}

function formatPercent(value?: number) {
  return typeof value === 'number' ? `${Math.round(value * 10) / 10}%` : '--';
}

export function calculateManualGradeSummary(assessments: ManualLectureAssessment[]): ManualGradeSummary {
  return assessments
    .filter((assessment) => assessment.enabled)
    .reduce<ManualGradeSummary>((summary, assessment) => {
      const mode = assessment.gradeInputMode ?? 'points';
      const itemWeight = getItemWeight(assessment);
      const items = getGeneratedGradeItems(assessment);

      summary.totalWeight += getAssessmentWeight(assessment);
      summary.totalItems += items.length;

      items.forEach((item) => {
        const itemPercent = getGradeItemPercent(item, mode);

        if (typeof itemPercent !== 'number') {
          return;
        }

        summary.gradedItems += 1;
        summary.gradedWeight += itemWeight;
        summary.earnedContribution += (itemPercent / 100) * itemWeight;
      });

      summary.currentPercent = summary.gradedWeight > 0
        ? (summary.earnedContribution / summary.gradedWeight) * 100
        : undefined;

      return summary;
    }, {
      earnedContribution: 0,
      gradedItems: 0,
      gradedWeight: 0,
      totalItems: 0,
      totalWeight: 0,
    });
}

export function ManualGradeEditor({
  assessments,
  gradeProgressThresholds = defaultGradeProgressColorThresholds,
  onChange,
}: ManualGradeEditorProps) {
  const { dictionary } = useLanguage();
  const enabledAssessments = assessments.filter((assessment) => assessment.enabled);
  const summary = calculateManualGradeSummary(assessments);

  const updateAssessment = (assessmentId: string, update: Partial<ManualLectureAssessment>) => {
    onChange?.(assessments.map((assessment) => (
      assessment.id === assessmentId ? { ...assessment, ...update } : assessment
    )));
  };

  const updateGradeItem = (
    assessment: ManualLectureAssessment,
    itemIndex: number,
    update: Partial<ManualLectureGradeItem>,
  ) => {
    const items = getGeneratedGradeItems(assessment).map((item, index) => (
      index === itemIndex ? { ...item, ...update } : item
    ));

    updateAssessment(assessment.id, { gradeItems: items });
  };

  const handleGradeInputModeChange = (
    assessment: ManualLectureAssessment,
    nextMode: ManualLectureGradeInputMode,
  ) => {
    const currentMode = assessment.gradeInputMode ?? 'points';
    const items = getGeneratedGradeItems(assessment).map((item) => {
      if (nextMode === 'percentage' && currentMode !== 'percentage') {
        const percent = getPointsModePercent(item);

        return typeof percent === 'number'
          ? { ...item, percentage: formatStoredNumber(percent) }
          : item;
      }

      if (nextMode === 'points' && currentMode !== 'points') {
        const hasPoints = Boolean(item.pointsEarned || item.pointsPossible);
        const percent = getPercentageModePercent(item);

        return !hasPoints && typeof percent === 'number'
          ? { ...item, pointsEarned: formatStoredNumber(percent), pointsPossible: '100' }
          : item;
      }

      return item;
    });

    updateAssessment(assessment.id, {
      gradeInputMode: nextMode,
      gradeItems: items,
    });
  };

  if (enabledAssessments.length === 0) {
    return (
      <div className="rounded-lg border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
        {dictionary.academyGradesNoBreakdown}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border bg-background/70 p-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] font-black uppercase text-muted-foreground">{dictionary.manualGradeCurrent}</div>
          <div className="mt-1 text-lg font-black text-foreground">{formatPercent(summary.currentPercent)}</div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase text-muted-foreground">{dictionary.manualGradeContribution}</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {formatPercent(summary.earnedContribution)} / {formatPercent(summary.totalWeight)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase text-muted-foreground">{dictionary.manualGradeCompleted}</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {summary.gradedItems} / {summary.totalItems}
          </div>
        </div>
      </div>

      {enabledAssessments.map((assessment) => {
        const mode = assessment.gradeInputMode ?? 'points';
        const itemWeight = getItemWeight(assessment);
        const items = getGeneratedGradeItems(assessment);

        return (
          <section className="rounded-xl border bg-background/70" key={assessment.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-black text-foreground">{assessment.label}</h3>
                  <Badge className="rounded-md" variant="outline">
                    {assessment.gradePortion || 0}%
                  </Badge>
                  <Badge className="rounded-md" variant="secondary">
                    {items.length} x {formatPercent(itemWeight)}
                  </Badge>
                </div>
                {assessment.details ? (
                  <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">{assessment.details}</p>
                ) : null}
              </div>
              <Select
                onValueChange={(value) => handleGradeInputModeChange(assessment, value as ManualLectureGradeInputMode)}
                value={mode}
              >
                <SelectTrigger className="h-8 w-[132px] rounded-md text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="points">{dictionary.manualGradeModePoints}</SelectItem>
                  <SelectItem value="percentage">{dictionary.manualGradeModePercentage}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 p-2">
              {items.map((item, index) => {
                const itemPercent = getGradeItemPercent(item, mode);
                const isGraded = typeof itemPercent === 'number';

                return (
                  <div className="rounded-lg border bg-card p-3" key={item.id}>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,300px)_72px] md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {isGraded ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          ) : (
                            <Calculator className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <Input
                            aria-label={item.label}
                            className="h-8 rounded-md border-transparent bg-transparent px-0 text-sm font-black shadow-none focus-visible:border-input focus-visible:px-2"
                            onChange={(event) => updateGradeItem(assessment, index, { label: event.target.value })}
                            tabIndex={-1}
                            value={item.label}
                          />
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              backgroundColor: getGradeProgressColor(itemPercent, gradeProgressThresholds),
                              width: `${itemPercent ?? 0}%`,
                            }}
                          />
                        </div>
                      </div>

                      {mode === 'percentage' ? (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                          <Input
                            className="h-9 rounded-md"
                            inputMode="decimal"
                            max="100"
                            min="0"
                            onChange={(event) => updateGradeItem(assessment, index, {
                              percentage: normalizeDecimalInput(event.target.value),
                            })}
                            placeholder="0"
                            type="number"
                            value={item.percentage ?? ''}
                          />
                          <span className="text-xs font-black text-muted-foreground">%</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                          <Input
                            className="h-9 rounded-md"
                            inputMode="decimal"
                            min="0"
                            onChange={(event) => updateGradeItem(assessment, index, {
                              pointsEarned: normalizeDecimalInput(event.target.value),
                            })}
                            placeholder="9"
                            type="number"
                            value={item.pointsEarned ?? ''}
                          />
                          <span className="text-xs font-black text-muted-foreground">/</span>
                          <Input
                            className="h-9 rounded-md"
                            inputMode="decimal"
                            min="0"
                            onChange={(event) => updateGradeItem(assessment, index, {
                              pointsPossible: normalizeDecimalInput(event.target.value),
                            })}
                            placeholder="10"
                            type="number"
                            value={item.pointsPossible ?? ''}
                          />
                        </div>
                      )}

                      <div className="text-right text-sm font-black text-foreground">
                        {formatPercent(itemPercent)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
