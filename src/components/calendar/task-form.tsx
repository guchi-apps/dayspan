"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { ExternalLink } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagPicker } from "@/components/tags/tag-picker";
import { Textarea } from "@/components/ui/textarea";
import { RECURRENCE_PRESETS } from "@/services/notion/recurrence";
import type { TagOption } from "@/services/notion/tag-options";
import {
  TASK_EVENT_STAGE_LABELS,
  type TaskEventLinkItem,
  type TaskEventStage,
  type TaskItem,
  type TaskLinkTarget,
} from "@/types/calendar";

import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { ItemFormActions } from "./item-form-actions";
import { readErrorMessage } from "./response-error";
import { formatLinkedDate, taskLinkFullLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

const PRIORITY_OPTIONS = ["高", "中", "低"];
const NO_VALUE = "__none__";

/** 期限・予定日の指定方法（docs/spec.md §15）。 */
type DueMode = "datetime" | "date" | "none";

const DATE_MODES: [DueMode, string][] = [
  ["datetime", "日時指定"],
  ["date", "日付のみ"],
  ["none", "未設定"],
];

// 日時指定へ切り替えたときの初期時刻。期限はその日のうちに片付ける想定の時刻、
// 予定日は取りかかる時間帯として朝から始める。
const DEFAULT_DUE_TIME = "18:00";
const DEFAULT_PLANNED_TIME = "09:00";

export type TaskDraft = {
  task?: TaskItem;
  dueMode: DueMode;
  /** dueMode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  due: string;
  /** 予定日の指定方法。追加のときは省略してよい（未設定から始める）。 */
  plannedMode?: DueMode;
  planned?: string;
  /**
   * 紐づけた状態で作る（docs/spec.md §31）。予定の詳細の「タスクを紐づける」から来る。
   * 保存してタスクのIDが決まってからでないと紐づけられないため、ここでは相手だけを持ち回る。
   */
  linkTo?: {
    calendarId: string;
    eventId: string;
    eventTitle: string;
    stage: TaskEventStage;
    /** 決まった日時の行き先。期限と予定日のどちらへ入れるか。 */
    target: TaskLinkTarget;
  };
};

/**
 * タスクの入力欄。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 * 開閉のアニメーションもそちらが持つため、ここでは保存できたことだけを伝える。
 */
export function TaskForm({
  draft,
  timeZone,
  tagOptions,
  title,
  autoFocusTitle,
  onTitleChange,
  onSaved,
}: {
  draft: TaskDraft;
  timeZone: string;
  /** 設定画面で登録済みのタグ。無い名前もここから足せる（Notionが選択肢を増やす）。 */
  tagOptions: TagOption[];
  /** タイトルは種類を切り替えても引き継ぐため、ItemDialog が持つ。 */
  title: string;
  autoFocusTitle: boolean;
  onTitleChange: (value: string) => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.task;

  const [dueMode, setDueMode] = useState<DueMode>(draft.dueMode);
  const [due, setDue] = useState(draft.due);
  // 予定日は必須ではないため、追加のときは未設定から始める。
  const [plannedMode, setPlannedMode] = useState<DueMode>(draft.plannedMode ?? "none");
  const [planned, setPlanned] = useState(draft.planned ?? "");
  const [done, setDone] = useState(editing?.done ?? false);
  const [priority, setPriority] = useState(editing?.priority ?? NO_VALUE);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [tags, setTags] = useState<string[]>(editing?.tags ?? []);
  const [recurrence, setRecurrence] = useState(editing?.recurrence ?? "なし");
  // 予定への紐づけ（docs/spec.md §31）。解除は保存を待たずにその場で効かせる。
  // 日付を直せるようにするための操作で、押した直後に欄が開かないと解除できたのか分からない。
  const [links, setLinks] = useState(editing?.links ?? []);
  // 紐づけて作る途中で、タスクだけ作れて紐づけが失敗したときの作成済みID。
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は押した直後には実行せず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  // 日付を選ぶモードなのに空欄のままだと、保存時の日時変換で失敗する。先に画面で知らせる。
  const missingDateError = (label: string, mode: DueMode, value: string): string | null => {
    if (mode === "none" || value) return null;
    return mode === "datetime"
      ? `${label}の日付と時刻を入力してください。`
      : `${label}の日付を入力してください。`;
  };

  /**
   * 紐づけ中の日付は予定から決まる（docs/spec.md §31）。編集中のタスクの紐づけと、これから
   * 紐づけて作る相手のどちらでも、その行き先の欄は出さずに紐づけ先を示す。直したいときは
   * 解除してもらう。ここで直せるようにすると、次に予定が動いた時点で入れた値が黙って
   * 書き戻される。
   */
  const linkedFor = (target: TaskLinkTarget) => {
    const existing = links.find((item) => item.target === target);
    if (existing) {
      return { label: taskLinkFullLabel(existing), stage: existing.stage, link: existing };
    }

    if (draft.linkTo?.target === target) {
      return {
        label: `${draft.linkTo.eventTitle} の${TASK_EVENT_STAGE_LABELS[draft.linkTo.stage]}`,
        stage: draft.linkTo.stage,
        link: null,
      };
    }

    return null;
  };

  const linkedDue = linkedFor("DUE");
  const linkedPlanned = linkedFor("PLANNED");

  const dueError = linkedDue ? null : missingDateError("期限", dueMode, due);
  const plannedError = linkedPlanned ? null : missingDateError("予定日", plannedMode, planned);

  const unlink = async (link: TaskEventLinkItem) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/task-links/${encodeURIComponent(link.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけを解除できませんでした。"));
        return;
      }
      setLinks((current) => current.filter((item) => item.id !== link.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけを解除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const buildDate = (mode: DueMode, value: string): string | null => {
    if (mode === "none") return null;
    if (mode === "date") return value.slice(0, 10);
    return localInputToIso(value, timeZone);
  };

  /** 作ったばかりのタスクを予定へ紐づける。行き先へ入った日時を返す。 */
  const linkCreatedTask = async (
    taskId: string,
    linkTo: NonNullable<TaskDraft["linkTo"]>,
  ): Promise<string | null> => {
    const response = await fetch("/api/task-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        calendarId: linkTo.calendarId,
        eventId: linkTo.eventId,
        stage: linkTo.stage,
        target: linkTo.target,
      }),
    });

    // タスクは作れているため、紐づけだけが失敗した場合も保存は成立させる。
    // 黙って閉じると紐づいたつもりのタスクが残るため、理由は画面に出す。
    if (!response.ok) {
      setError(await readErrorMessage(response, "タスクは作れましたが、紐づけできませんでした。"));
      return null;
    }

    const result = (await response.json()) as { date?: string };
    return result.date ?? null;
  };

  const save = async () => {
    // 開いている最中に通信が落ちることもある。押せない状態にするだけでなく、ここでも断つ。
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // 紐づけ中の日付は送らない。画面から直せない値をそのまま送り返すと、Notion側で
      // ずれている場合に「手で書き換えられた」と読まれ、紐づけが黙って外れる
      // （api/tasks/[taskId] の dropLinksIfDateOverridden）。期限・予定日のどちらも
      // 紐づけの行き先になりうるため、行き先ごとに判断する。
      const nextDue = linkedDue ? undefined : buildDate(dueMode, due);
      const nextPlanned = linkedPlanned ? undefined : buildDate(plannedMode, planned);

      const payload = {
        title,
        ...(nextDue === undefined ? {} : { due: nextDue }),
        ...(nextPlanned === undefined ? {} : { planned: nextPlanned }),
        done,
        priority: priority === NO_VALUE ? null : priority,
        memo: memo.trim() || null,
        tags,
        recurrence,
      };

      /**
       * 保存後の日付。紐づけから入った日時は行き先の側へ入れ、紐づけ中で送らなかった日付は
       * いま入っている値のままとする（未設定にした場合の null と、送っていない undefined を
       * 分けて扱う。混ぜると、消したはずの日付を入っているものとして数えることになる）。
       */
      const rangesWithLink = (linkedDate: string | null): TouchedRange[] =>
        taskRanges({
          due:
            draft.linkTo?.target === "DUE"
              ? linkedDate
              : nextDue === undefined
                ? (editing?.due ?? null)
                : nextDue,
          planned:
            draft.linkTo?.target === "PLANNED"
              ? linkedDate
              : nextPlanned === undefined
                ? (editing?.planned ?? null)
                : nextPlanned,
        });

      // 前回の保存でタスクは作れて紐づけだけ失敗している場合は、紐づけからやり直す。
      if (createdId && draft.linkTo) {
        const linkedDate = await linkCreatedTask(createdId, draft.linkTo);
        if (linkedDate === null) return;

        onSaved(rangesWithLink(linkedDate));
        return;
      }

      const response = await fetch(
        editing ? `/api/tasks/${encodeURIComponent(editing.id)}` : "/api/tasks",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }

      // 新しく作ったタスクを予定へ紐づける。行き先の日付はこの呼び出しが入れるため、
      // 作成の時点では送っていない（同じ値をNotionへ2回書かないため）。
      let dateFromLink: string | null = null;
      if (!editing && draft.linkTo) {
        const created = (await response.json()) as { id?: string };
        if (!created.id) {
          setError("タスクは作れましたが、紐づけできませんでした。");
          return;
        }

        // 紐づけだけが失敗した場合、もう一度押せばここからやり直せるようにする。
        // 作り直すと同じタスクが2つ並ぶため、作れたIDは覚えておく。
        setCreatedId(created.id);
        dateFromLink = await linkCreatedTask(created.id, draft.linkTo);
        if (dateFromLink === null) return;
      }

      // 期限・予定日を動かした場合は移動元も変わる。どちらも未設定の状態は
      // カレンダーに出ないため、対象から外れる。
      const touched: TouchedRange[] = [
        ...rangesWithLink(dateFromLink),
        ...(editing ? taskRanges(editing) : []),
      ];

      onSaved(touched);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing && confirmingDelete && (
        <DeleteItemDialog
          item={{ kind: "task", task: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <Input
          id="task-title"
          label="タイトル"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onClear={() => onTitleChange("")}
          autoFocus={autoFocusTitle}
        />

        {/*
          期限も予定日も予定へ紐づけられる（docs/spec.md §31）。紐づいている間はその日付が
          予定から決まるため、欄ではなく紐づけ先を出す。直したいときは解除してもらう。
          ここで直せるようにすると、次に予定が動いた時点で入れた値が黙って書き戻される。
        */}
        {linkedDue ? (
          <LinkedDateField
            label="期限"
            linked={linkedDue}
            // 出すのはDaySpanが最後に書いた値ではなく、いまタスクに入っている日付。
            // 外で予定が動いていると両者は食い違い、画面に出ているほうが実際の値になる。
            current={editing?.due ?? null}
            timeZone={timeZone}
            busy={busy}
            onUnlink={unlink}
          />
        ) : (
          <DateModeField
            id="task-due"
            label="期限"
            mode={dueMode}
            value={due}
            timeZone={timeZone}
            defaultTime={DEFAULT_DUE_TIME}
            onChange={(next) => {
              setDueMode(next.mode);
              setDue(next.value);
            }}
          />
        )}

        {/*
          予定日は期限までのどの辺りで片付けるかの見込み。締切とは別に持つ（docs/spec.md §9）。
        */}
        {linkedPlanned ? (
          <LinkedDateField
            label="予定日"
            linked={linkedPlanned}
            current={editing?.planned ?? null}
            timeZone={timeZone}
            busy={busy}
            onUnlink={unlink}
          />
        ) : (
          <DateModeField
            id="task-planned"
            label="予定日"
            mode={plannedMode}
            value={planned}
            timeZone={timeZone}
            defaultTime={DEFAULT_PLANNED_TIME}
            onChange={(next) => {
              setPlannedMode(next.mode);
              setPlanned(next.value);
            }}
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger label="優先度">
              <SelectValue placeholder="未設定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>未設定</SelectItem>
              {PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={recurrence} onValueChange={setRecurrence}>
            <SelectTrigger label="繰り返し">
              <SelectValue placeholder="なし" />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCE_PRESETS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
              {/* 曜日指定はNotion側で「毎週(月・水・金)」の形で保存されている。
                  既存の値をそのまま選び直せるよう、選択肢に足しておく。 */}
              {editing?.recurrence &&
                !RECURRENCE_PRESETS.includes(editing.recurrence) && (
                  <SelectItem value={editing.recurrence}>{editing.recurrence}</SelectItem>
                )}
            </SelectContent>
          </Select>
        </div>

        <TagPicker label="タグ" options={tagOptions} value={tags} multiple onChange={setTags} />

        <Textarea
          id="task-memo"
          label="メモ"
          rows={3}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onClear={() => setMemo("")}
        />

        <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
          <Checkbox checked={done} onCheckedChange={(v) => setDone(v === true)} />
          完了
        </label>

        {editing?.url && (
          <a
            href={editing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ExternalLink className="size-3" />
            Notionで開く
          </a>
        )}

        {dueError && <p className="text-sm text-destructive">{dueError}</p>}
        {plannedError && <p className="text-sm text-destructive">{plannedError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <ItemFormActions
        saveDisabled={
          busy || offline || !title.trim() || dueError !== null || plannedError !== null
        }
        onSave={save}
        onDelete={editing ? () => setConfirmingDelete(true) : undefined}
        deleteDisabled={busy || offline}
      />
    </>
  );
}

/**
 * 予定へ紐づいている日付の欄（docs/spec.md §31）。入力欄の代わりに紐づけ先を出す。
 *
 * 期限と予定日のどちらでも同じ形にする。どちらが紐づいているかで見え方が変わると、
 * 同じ「予定から決まる日付」であることが読めなくなるため。
 */
function LinkedDateField({
  label,
  linked,
  current,
  timeZone,
  busy,
  onUnlink,
}: {
  label: string;
  /** 紐づけ済み（link あり）と、これから紐づけて作る相手（link なし）の両方を受ける。 */
  linked: { label: string; stage: TaskEventStage; link: TaskEventLinkItem | null };
  /** いまタスクに入っている日付。紐づけ済みのときだけ出す。 */
  current: string | null;
  timeZone: string;
  busy: boolean;
  onUnlink: (link: TaskEventLinkItem) => void;
}) {
  const link = linked.link;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary-container px-2.5 py-1 text-sm text-on-secondary-container">
          <TaskStageMark stage={linked.stage} className="h-3.5 w-4.5 text-on-secondary-container" />
          {linked.label}
        </span>
        {link && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUnlink(link)}>
            紐づけを解除
          </Button>
        )}
      </div>
      <p className="text-xs text-on-surface-variant">
        {link
          ? current
            ? `予定に合わせて ${formatLinkedDate(current, timeZone)} が入っています。直すには紐づけを解除してください。`
            : `${label}が入っていません。表示画面の「予定に合わせる」で入れ直せます。`
          : `保存すると、選んだ段階から決まる日時が${label}に入ります。`}
      </p>
    </div>
  );
}

/**
 * 期限・予定日の入力欄。指定方法（日時／日付のみ／未設定）と入力欄を組で出す。
 * 2つの日付で形を揃えるため、1つの部品にまとめる。
 */
function DateModeField({
  id,
  label,
  mode,
  value,
  timeZone,
  defaultTime,
  onChange,
}: {
  id: string;
  label: string;
  mode: DueMode;
  /** mode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  value: string;
  timeZone: string;
  /** 日時指定へ切り替えたときの初期時刻（HH:mm）。 */
  defaultTime: string;
  onChange: (next: { mode: DueMode; value: string }) => void;
}) {
  const changeMode = (next: DueMode) => {
    if (next === "none") {
      onChange({ mode: next, value });
      return;
    }

    // 未設定から切り替えた直後は日付を持っていない。設定タイムゾーンでの今日を入れる。
    // 実行環境のローカル時刻ではなく設定タイムゾーンで求めるのは、他の日時と揃えるため。
    const date =
      value.slice(0, 10) || isoToLocalInput(new Date().toISOString(), timeZone).slice(0, 10);

    onChange({
      mode: next,
      value: next === "datetime" ? `${date}T${value.slice(11, 16) || defaultTime}` : date,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        {DATE_MODES.map(([option, optionLabel]) => (
          <Button
            key={option}
            type="button"
            variant={mode === option ? "secondary" : "outline"}
            size="sm"
            onClick={() => changeMode(option)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
      {mode === "datetime" && (
        <DateTimeInput
          id={id}
          dateLabel={`${label}の日付`}
          timeLabel={`${label}の時刻`}
          value={value}
          onChange={(next) => onChange({ mode, value: next })}
        />
      )}
      {mode === "date" && (
        <Input
          id={`${id}-date`}
          label={`${label}の日付`}
          type="date"
          value={value}
          onChange={(e) => onChange({ mode, value: e.target.value })}
        />
      )}
    </div>
  );
}

export function toTaskDraft(task: TaskItem, timeZone: string): TaskDraft {
  const field = (date: string | null, hasTime: boolean) => {
    if (!date) return { mode: "none" as DueMode, value: "" };
    if (!hasTime) return { mode: "date" as DueMode, value: date };
    return { mode: "datetime" as DueMode, value: isoToLocalInput(date, timeZone) };
  };

  const due = field(task.due, task.hasTime);
  const planned = field(task.planned, task.plannedHasTime);

  return {
    task,
    dueMode: due.mode,
    due: due.value,
    plannedMode: planned.mode,
    planned: planned.value,
  };
}
