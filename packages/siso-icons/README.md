# @siso/icons

HALO CRM's pqoqubbw animated icon set, ported from the upstream MIT source. Each animated icon is a forward-ref
component with `startAnimation()` and `stopAnimation()` controls. The package also exports `AnimatedNavIcon`,
`staticGlyph`, the `ICONS` map, and the `IconName` / `isIconName()` contract.

```tsx
import { AnimatedNavIcon, ICONS } from "@siso/icons";

<a href="/agents" aria-current={active ? "page" : undefined}>
  <AnimatedNavIcon icon={ICONS["radio-tower"]} active={active} />
  Agents
</a>
```

`AnimatedNavIcon` plays when its nearest link or button is entered or when `active` becomes true. It does nothing when
the user requests reduced motion. `staticGlyph(LucideIcon)` provides the same handle API for a static glyph.

The preview grid shows every name in Agent Base's `ICON-MAP.md`. Add upstream ports with:

```sh
node scripts/port.mjs <pqoqubbw-icons>/icons <icon-name> [icon-name...]
```

Run `pnpm --filter @siso/icons build` to type-check and build `preview/icons.html`.
