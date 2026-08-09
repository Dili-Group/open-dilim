import {
  ChartNoAxesColumn,
  ChevronDown,
  Clock,
  Compass,
  MessageCircle,
  PackageX,
  ReceiptText,
  Settings2,
  ShoppingBag,
  UserRound,
  Warehouse,
  Zap,
} from "lucide-react";

// design-system §7: icon line 24px, nét 2px, đơn sắc `currentColor`, KHÔNG emoji.
// Map tường minh thay vì import động — chỉ những icon thật sự dùng mới vào bundle.
const ICONS = {
  clock: Clock,
  "chevron-down": ChevronDown,
  "package-x": PackageX,
  "receipt-text": ReceiptText,
  "shopping-bag": ShoppingBag,
  "settings-2": Settings2,
  warehouse: Warehouse,
  "chart-no-axes-column": ChartNoAxesColumn,
  "user-round": UserRound,
  compass: Compass,
  "message-circle": MessageCircle,
  zap: Zap,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 24,
  className = "",
}: {
  readonly name: IconName;
  /** §7 mặc định 24px; chỉ badge trong hero dùng cỡ nhỏ hơn. */
  readonly size?: number;
  readonly className?: string;
}) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={2} aria-hidden className={className} />;
}
