import {
  Bath,
  BookOpen,
  Bike,
  Code,
  Coffee,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Heart,
  House,
  Laptop,
  type LucideIcon,
  Moon,
  Music,
  Navigation,
  Pencil,
  Phone,
  Sparkles,
  Sun,
  Tv,
  Users,
  Utensils,
} from "lucide-react";

/**
 * 活動記録の項目に付けられるアイコン（issue #907）。
 *
 * 他の種類の印に使っている図柄は入れない。移動（`TravelMark`: Car / TrainFront / Footprints / Route）、
 * 買い物・ゴミの日（`ReminderMark`: ShoppingCart / Trash）、出張（`WorkPlaceChip`: Briefcase）と
 * 同じ図柄だと、終日エリア・時間グリッドで並んだときに種類を読み違える。
 * ここを足すときも、カレンダー上の他の印と重ならないかを先に確かめる。
 */
export const ACTIVITY_ICONS = {
  moon: Moon,
  sun: Sun,
  navigation: Navigation,
  laptop: Laptop,
  code: Code,
  gamepad: Gamepad2,
  utensils: Utensils,
  coffee: Coffee,
  dumbbell: Dumbbell,
  bike: Bike,
  book: BookOpen,
  graduation: GraduationCap,
  bath: Bath,
  music: Music,
  tv: Tv,
  users: Users,
  phone: Phone,
  house: House,
  sparkles: Sparkles,
  heart: Heart,
  pencil: Pencil,
} as const satisfies Record<string, LucideIcon>;

export type ActivityIconKey = keyof typeof ACTIVITY_ICONS;

export const ACTIVITY_ICON_KEYS = Object.keys(ACTIVITY_ICONS) as ActivityIconKey[];

/** 未設定でも初期項目にはアイコンが付くよう、名前から引く既定。 */
const DEFAULT_ICON_BY_NAME: Record<string, ActivityIconKey> = {
  睡眠: "moon",
  移動: "navigation",
  仕事: "laptop",
  プログラミング: "code",
  遊び: "gamepad",
};

export function isActivityIconKey(value: unknown): value is ActivityIconKey {
  return typeof value === "string" && Object.hasOwn(ACTIVITY_ICONS, value);
}

/** 項目名と保存済みのキーから、出すアイコンを決める。無ければ null（従来の円）。 */
export function resolveActivityIcon(
  name: string,
  icon: string | null | undefined,
): ActivityIconKey | null {
  if (isActivityIconKey(icon)) return icon;
  return Object.hasOwn(DEFAULT_ICON_BY_NAME, name) ? DEFAULT_ICON_BY_NAME[name] : null;
}
