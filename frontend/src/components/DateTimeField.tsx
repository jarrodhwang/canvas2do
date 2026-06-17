import { CalendarDays, ChevronLeft, ChevronRight, Clock, Minus, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface DateTimeFieldProps {
  defaultTime?: string;
  disabled?: boolean;
  id?: string;
  label?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value?: string;
}

const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const commonTimes = ['09:00', '12:00', '15:00', '18:00', '23:59'];

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeValue(value?: string) {
  if (!value) {
    return null;
  }

  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;

    return new Date(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10),
      Number.parseInt(hour, 10),
      Number.parseInt(minute, 10),
    );
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMonthDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlankCount = firstDay.getDay();

  return [
    ...Array.from({ length: leadingBlankCount }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
  ];
}

function applyDatePart(currentValue: string | undefined, selectedDate: Date, defaultTime: string) {
  const currentDate = parseDateTimeValue(currentValue);
  const [defaultHour, defaultMinute] = defaultTime.split(':').map((part) => Number.parseInt(part, 10));
  const nextDate = new Date(selectedDate);

  nextDate.setHours(
    currentDate?.getHours() ?? defaultHour ?? 23,
    currentDate?.getMinutes() ?? defaultMinute ?? 59,
    0,
    0,
  );

  return toLocalDateTimeValue(nextDate);
}

function applyTimePart(currentValue: string | undefined, nextTime: string) {
  const currentDate = parseDateTimeValue(currentValue) ?? new Date();
  const [hour, minute] = nextTime.split(':').map((part) => Number.parseInt(part, 10));
  const nextDate = new Date(currentDate);

  nextDate.setHours(hour || 0, minute || 0, 0, 0);

  return toLocalDateTimeValue(nextDate);
}

function adjustDateTimePart(currentValue: string | undefined, minutes: number) {
  const nextDate = parseDateTimeValue(currentValue) ?? new Date();

  nextDate.setMinutes(nextDate.getMinutes() + minutes);

  return toLocalDateTimeValue(nextDate);
}

function getDisplayValue(value: string | undefined, locale: string) {
  const date = parseDateTimeValue(value);

  if (!date) {
    return '';
  }

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    weekday: 'short',
    year: 'numeric',
  }).format(date);
}

export function DateTimeField({
  defaultTime = '23:59',
  disabled = false,
  id,
  label,
  onChange,
  placeholder,
  value,
}: DateTimeFieldProps) {
  const { dictionary, language } = useLanguage();
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const selectedDate = parseDateTimeValue(value);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? new Date());
  const selectedDateKey = selectedDate ? getDateKey(selectedDate) : '';
  const today = useMemo(() => new Date(), []);
  const todayKey = getDateKey(today);
  const visibleMonthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(visibleMonth);
  const displayValue = getDisplayValue(value, locale);
  const currentTime = selectedDate ? `${pad(selectedDate.getHours())}:${pad(selectedDate.getMinutes())}` : defaultTime;
  const currentHour = currentTime.slice(0, 2);
  const currentMinute = currentTime.slice(3, 5);

  useEffect(() => {
    if (selectedDate) {
      setVisibleMonth(selectedDate);
    }
  }, [value]);

  const chooseRelativeDate = (offsetDays: number) => {
    const nextDate = new Date();

    nextDate.setDate(nextDate.getDate() + offsetDays);
    onChange(applyDatePart(value, nextDate, defaultTime));
  };

  const chooseNow = () => {
    const now = new Date();

    setVisibleMonth(now);
    onChange(toLocalDateTimeValue(now));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={label}
          className={cn(
            'h-auto min-h-10 w-full justify-start rounded-lg border-border bg-background px-3 py-2 text-left shadow-none',
            !displayValue && 'text-muted-foreground',
          )}
          disabled={disabled}
          id={id}
          type="button"
          variant="outline"
        >
          <CalendarDays className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            {displayValue || placeholder || dictionary.dateTimeSelect}
          </span>
          {value ? (
            <span
              className="ml-2 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange('');
              }}
              role="button"
              tabIndex={-1}
            >
              <X className="size-3.5" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              aria-label={dictionary.dateTimePreviousMonth}
              className="size-8 rounded-md"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="text-sm font-black text-foreground">{visibleMonthLabel}</div>
            <Button
              aria-label={dictionary.dateTimeNextMonth}
              className="size-8 rounded-md"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {weekdayLabels.map((weekday, index) => (
              <div
                className={cn(
                  'grid h-6 place-items-center text-[10px] font-black text-muted-foreground',
                  index === 0 && 'text-red-500',
                  index === 6 && 'text-blue-500',
                )}
                key={`${weekday}-${index}`}
              >
                {weekday}
              </div>
            ))}
            {getMonthDays(visibleMonth).map((date, index) => {
              if (!date) {
                return <div aria-hidden="true" className="h-9" key={`blank-${index}`} />;
              }

              const dateKey = getDateKey(date);

              return (
                <button
                  className={cn(
                    'grid h-9 place-items-center rounded-lg text-sm font-black transition-colors hover:bg-muted',
                    dateKey === todayKey && 'ring-1 ring-primary/45',
                    dateKey === selectedDateKey && 'bg-primary text-primary-foreground hover:bg-primary',
                    date.getDay() === 0 && dateKey !== selectedDateKey && 'text-red-500',
                    date.getDay() === 6 && dateKey !== selectedDateKey && 'text-blue-500',
                  )}
                  key={dateKey}
                  onClick={() => onChange(applyDatePart(value, date, defaultTime))}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Button className="rounded-md" onClick={() => chooseRelativeDate(0)} size="sm" type="button" variant="outline">
              {dictionary.dateTimeToday}
            </Button>
            <Button className="rounded-md" onClick={chooseNow} size="sm" type="button" variant="default">
              {dictionary.dateTimeNow}
            </Button>
            <Button className="rounded-md" onClick={() => chooseRelativeDate(1)} size="sm" type="button" variant="outline">
              {dictionary.dateTimeTomorrow}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Button className="rounded-md" onClick={() => chooseRelativeDate(7)} size="sm" type="button" variant="outline">
              {dictionary.dateTimeNextWeek}
            </Button>
            <Button
              className="rounded-md"
              onClick={() => onChange(adjustDateTimePart(value, -60))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Minus className="size-3.5" />
              1h
            </Button>
            <Button
              className="rounded-md"
              onClick={() => onChange(adjustDateTimePart(value, 60))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus className="size-3.5" />
              1h
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              className="rounded-md"
              onClick={() => onChange(adjustDateTimePart(value, -5))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Minus className="size-3.5" />
              5m
            </Button>
            <Button
              className="rounded-md"
              onClick={() => onChange(adjustDateTimePart(value, 5))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus className="size-3.5" />
              5m
            </Button>
          </div>

          <div className="rounded-lg border bg-muted/25 p-2">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
              <Clock className="size-3.5" />
              {dictionary.dateTimeTime}
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Select
                onValueChange={(hour) => onChange(applyTimePart(value, `${hour}:${currentMinute}`))}
                value={currentHour}
              >
                <SelectTrigger aria-label={dictionary.dateTimeHour} className="h-9 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, hour) => pad(hour)).map((hour) => (
                    <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm font-black text-muted-foreground">:</span>
              <Select
                onValueChange={(minute) => onChange(applyTimePart(value, `${currentHour}:${minute}`))}
                value={currentMinute}
              >
                <SelectTrigger aria-label={dictionary.dateTimeMinute} className="h-9 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '59'].map((minute) => (
                    <SelectItem key={minute} value={minute}>{minute}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {commonTimes.map((time) => (
                <Button
                  className="h-7 rounded-md px-1 text-[10px]"
                  key={time}
                  onClick={() => onChange(applyTimePart(value, time))}
                  type="button"
                  variant={currentTime === time ? 'default' : 'outline'}
                >
                  {time}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
