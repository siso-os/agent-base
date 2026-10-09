import { ActivityIcon, AtomIcon, BadgeAlertIcon, BellIcon, BlocksIcon, BookTextIcon, BotIcon, BrainIcon, BriefcaseBusinessIcon, CheckCircleIcon, ChevronRightIcon, CircleDollarSignIcon, ClipboardCheckIcon, CoffeeIcon, CompassIcon, ConstructionIcon, CookingPotIcon, CpuIcon, CrownIcon, FlaskConicalIcon, GavelIcon, GaugeIcon, GraduationCapIcon, HammerIcon, HeartHandshakeIcon, HistoryIcon, HouseIcon, LaptopMinimalCheckIcon, LayersIcon, LayoutGridIcon, LayoutPanelTopIcon, MapPinHouseIcon, MapPinIcon, MessageCircleMoreIcon, MonitorCheckIcon, PaletteIcon, PlaneTakeoffIcon, RadioTowerIcon, RocketIcon, RouteIcon, SearchIcon, ServerIcon, ShieldCheckIcon, ShoppingCartIcon, SparklesIcon, StampIcon, StethoscopeIcon, TerminalIcon, TimerIcon, UserCheckIcon, UsersIcon, WalletIcon, WorkflowIcon, ZapIcon, BoxIcon, type LucideIcon } from "lucide-react";
import { ICON_NAMES, isIconName, type IconName } from "./icon-names";

/** Names match the HALO icon set; swap this map to @siso/icons when its port lands. */
export { ICON_NAMES, isIconName, type IconName };

const glyphs: Record<IconName, LucideIcon> = {
  "briefcase-business": BriefcaseBusinessIcon,
  flask: FlaskConicalIcon,
  home: HouseIcon,
  brain: BrainIcon,
  "layout-panel-top": LayoutPanelTopIcon,
  zap: ZapIcon,
  stethoscope: StethoscopeIcon,
  "chess-king": CrownIcon,
  "radio-tower": RadioTowerIcon,
  gauge: GaugeIcon,
  "layout-grid": LayoutGridIcon,
  "heart-handshake": HeartHandshakeIcon,
  construction: ConstructionIcon,
  sparkles: SparklesIcon,
  blocks: BlocksIcon,
  "book-text": BookTextIcon,
  wallet: WalletIcon,
  gavel: GavelIcon,
  "graduation-cap": GraduationCapIcon,
  rocket: RocketIcon,
  "map-pin-house": MapPinHouseIcon,
  bot: BotIcon,
  route: RouteIcon,
  box: BoxIcon,
  stamp: StampIcon,
  coffee: CoffeeIcon,
  hammer: HammerIcon,
  "user-check": UserCheckIcon,
  cart: ShoppingCartIcon,
  palette: PaletteIcon,
  "shield-check": ShieldCheckIcon,
  "cooking-pot": CookingPotIcon,
  layers: LayersIcon,
  users: UsersIcon,
  compass: CompassIcon,
  "plane-takeoff": PlaneTakeoffIcon,
  bell: BellIcon,
  "badge-alert": BadgeAlertIcon,
  history: HistoryIcon,
  "message-circle-more": MessageCircleMoreIcon,
  "clipboard-check": ClipboardCheckIcon,
  search: SearchIcon,
  "circle-dollar-sign": CircleDollarSignIcon,
  cpu: CpuIcon,
  terminal: TerminalIcon,
  "laptop-minimal-check": LaptopMinimalCheckIcon,
  "map-pin": MapPinIcon,
  "chevron-right": ChevronRightIcon,
  workflow: WorkflowIcon,
  atom: AtomIcon,
  "circle-check": CheckCircleIcon,
  "monitor-check": MonitorCheckIcon,
  server: ServerIcon,
  timer: TimerIcon,
  activity: ActivityIcon,
};

export function Icon({ name, ...props }: { name: IconName; size?: number; className?: string; "aria-hidden"?: boolean }) {
  const Glyph = glyphs[name];
  return <Glyph {...props} aria-hidden={props["aria-hidden"] ?? true} />;
}
