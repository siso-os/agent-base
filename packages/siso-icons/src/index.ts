import { ActivityIcon } from "./pq/activity";
import { BadgeAlertIcon } from "./pq/badge-alert";
import { BellIcon } from "./pq/bell";
import { BlocksIcon } from "./pq/blocks";
import { BookTextIcon } from "./pq/book-text";
import { BotIcon } from "./pq/bot";
import { BoxIcon } from "./pq/box";
import { BrainIcon } from "./pq/brain";
import { BriefcaseBusinessIcon } from "./pq/briefcase-business";
import { CartIcon } from "./pq/cart";
import { ChessKingIcon } from "./pq/chess-king";
import { ChevronRightIcon } from "./pq/chevron-right";
import { CircleCheckIcon } from "./pq/circle-check";
import { CircleDollarSignIcon } from "./pq/circle-dollar-sign";
import { ClipboardCheckIcon } from "./pq/clipboard-check";
import { CoffeeIcon } from "./pq/coffee";
import { CompassIcon } from "./pq/compass";
import { ConstructionIcon } from "./pq/construction";
import { CookingPotIcon } from "./pq/cooking-pot";
import { CpuIcon } from "./pq/cpu";
import { FlaskIcon } from "./pq/flask";
import { GavelIcon } from "./pq/gavel";
import { GaugeIcon } from "./pq/gauge";
import { GraduationCapIcon } from "./pq/graduation-cap";
import { HammerIcon } from "./pq/hammer";
import { HeartHandshakeIcon } from "./pq/heart-handshake";
import { HistoryIcon } from "./pq/history";
import { HomeIcon } from "./pq/home";
import { AtomIcon as BrandAtomIcon } from "./pq/atom";
import { LaptopMinimalCheckIcon } from "./pq/laptop-minimal-check";
import { LayersIcon } from "./pq/layers";
import { LayoutGridIcon } from "./pq/layout-grid";
import { LayoutPanelTopIcon } from "./pq/layout-panel-top";
import { MapPinIcon } from "./pq/map-pin";
import { MapPinHouseIcon } from "./pq/map-pin-house";
import { MessageCircleMoreIcon } from "./pq/message-circle-more";
import { MonitorCheckIcon } from "./pq/monitor-check";
import { PaletteIcon } from "./pq/palette";
import { PlaneTakeoffIcon } from "./pq/plane-takeoff";
import { RadioTowerIcon } from "./pq/radio-tower";
import { RocketIcon } from "./pq/rocket";
import { RouteIcon } from "./pq/route";
import { SearchIcon } from "./pq/search";
import { ServerIcon } from "./pq/server";
import { ShieldCheckIcon } from "./pq/shield-check";
import { SparklesIcon } from "./pq/sparkles";
import { StethoscopeIcon } from "./pq/stethoscope";
import { StampIcon } from "./pq/stamp";
import { TerminalIcon } from "./pq/terminal";
import { TimerIcon } from "./pq/timer";
import { UserCheckIcon } from "./pq/user-check";
import { UsersIcon } from "./pq/users";
import { WalletIcon } from "./pq/wallet";
import { WorkflowIcon } from "./pq/workflow";
import { ZapIcon } from "./pq/zap";

export { AnimatedNavIcon, type AnimatedNavIconProps } from "./AnimatedNavIcon";
export { staticGlyph } from "./staticGlyph";
export type { AnimatedIcon, AnimatedIconHandle, AnimatedIconProps } from "./types";

/** Every animated glyph referenced by Agent Base's ICON-MAP. */
export const ICONS = {
  "briefcase-business": BriefcaseBusinessIcon,
  flask: FlaskIcon,
  home: HomeIcon,
  brain: BrainIcon,
  "layout-panel-top": LayoutPanelTopIcon,
  zap: ZapIcon,
  stethoscope: StethoscopeIcon,
  "chess-king": ChessKingIcon,
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
  cart: CartIcon,
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
  atom: BrandAtomIcon,
  "circle-check": CircleCheckIcon,
  "monitor-check": MonitorCheckIcon,
  server: ServerIcon,
  timer: TimerIcon,
  activity: ActivityIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ICONS, value);
}
