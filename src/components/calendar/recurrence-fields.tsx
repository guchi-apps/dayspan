"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  END_OPTIONS,
  FREQUENCY_OPTIONS,
  intervalLabel,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceInput,
} from "./recurrence-rule";

/**
 * 予定の繰り返しの入力欄。
 *
 * 間隔と終了条件は繰り返す場合にしか意味を持たないため、頻度を選ぶまでは出さない。
 * 繰り返さない予定のほうが多く、常に3欄あると入力画面が縦に伸びるため。
 */
export function RecurrenceFields({
  value,
  onChange,
}: {
  value: RecurrenceInput;
  onChange: (value: RecurrenceInput) => void;
}) {
  const repeating = value.frequency !== "none";

  return (
    <div className="flex flex-col gap-3 sm:gap-2">
      <Select
        value={value.frequency}
        onValueChange={(next) =>
          onChange({ ...value, frequency: next as RecurrenceFrequency })
        }
      >
        <SelectTrigger label="繰り返し">
          <SelectValue placeholder="繰り返さない" />
        </SelectTrigger>
        <SelectContent>
          {FREQUENCY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {repeating && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
          <Input
            id="event-recurrence-interval"
            label={intervalLabel(value.frequency)}
            type="number"
            inputMode="numeric"
            min={1}
            value={value.interval}
            onChange={(e) => onChange({ ...value, interval: e.target.value })}
          />

          <Select
            value={value.end}
            onValueChange={(next) => onChange({ ...value, end: next as RecurrenceEnd })}
          >
            <SelectTrigger label="繰り返しの終了">
              <SelectValue placeholder="終了日なし" />
            </SelectTrigger>
            <SelectContent>
              {END_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 終了条件の詳細は、選んだ欄の下に続けて出す。 */}
          {value.end === "until" && (
            <div className="sm:col-start-2">
              <Input
                id="event-recurrence-until"
                label="繰り返しの終了日"
                type="date"
                value={value.until}
                onChange={(e) => onChange({ ...value, until: e.target.value })}
              />
            </div>
          )}

          {value.end === "count" && (
            <div className="sm:col-start-2">
              <Input
                id="event-recurrence-count"
                label="繰り返す回数"
                type="number"
                inputMode="numeric"
                min={1}
                value={value.count}
                onChange={(e) => onChange({ ...value, count: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
