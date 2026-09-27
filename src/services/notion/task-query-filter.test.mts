import assert from "node:assert/strict";
import test from "node:test";

import { taskRangeFilter } from "@/services/notion/task-query-filter";

test("期限切れの追加取得は指定した期間に限る", () => {
  assert.deepEqual(
    taskRangeFilter(
      "期限",
      undefined,
      { from: "2026-09-01", to: "2026-09-30" },
      { from: "2026-06-29", before: "2026-09-27" },
    ),
    {
      or: [
        {
          and: [
            { property: "期限", date: { on_or_after: "2026-09-01" } },
            { property: "期限", date: { on_or_before: "2026-09-30" } },
          ],
        },
        {
          and: [
            { property: "期限", date: { on_or_after: "2026-06-29" } },
            { property: "期限", date: { before: "2026-09-27" } },
          ],
        },
      ],
    },
  );
});
