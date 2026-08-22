/**
 * 通知に付ける印（tag）。同じ印の通知は、新しいものが古いものを置き換える。
 *
 * サーバー（送るとき）とブラウザ（消すとき）の両方で同じ値を使う必要があるため、ここに置く。
 */

/** 記録中であることを示す1件（docs/spec.md §27・§32）。 */
export const ACTIVITY_NOTIFICATION_TAG = "dayspan-activity";
