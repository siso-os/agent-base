export const ICON_NAMES = [
  "briefcase-business", "flask", "home", "brain", "layout-panel-top", "zap", "stethoscope", "chess-king", "radio-tower", "gauge", "layout-grid", "heart-handshake", "construction", "sparkles", "blocks", "book-text", "wallet", "gavel", "graduation-cap", "rocket", "map-pin-house", "bot", "route", "box", "stamp", "coffee", "hammer", "user-check", "cart", "palette", "shield-check", "cooking-pot", "layers", "users", "compass", "plane-takeoff", "bell", "badge-alert", "history", "message-circle-more", "clipboard-check", "search", "circle-dollar-sign", "cpu", "terminal", "laptop-minimal-check", "map-pin", "chevron-right", "workflow", "atom", "circle-check", "monitor-check", "server", "timer", "activity",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && (ICON_NAMES as readonly string[]).includes(value);
}
