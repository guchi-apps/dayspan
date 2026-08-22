import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `rounded-item`（カレンダーに置く項目の角丸。globals.css の --radius-item）を角丸の仲間として教える。
// tailwind-merge は Tailwind 標準の名前しか知らず、教えないと `rounded-sm` と `rounded-item` の
// 両方を残す。どちらが効くかはCSSの並び順次第になり、上書きしたつもりの角丸が効かないことがある。
const twMerge = extendTailwindMerge({
  extend: { classGroups: { rounded: [{ rounded: ["item"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
