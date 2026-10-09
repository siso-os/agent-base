/** Durable owner slots and sealed conversations. Display names are labels, never routing keys.
 * Owner pins follow the configured workspace role across legitimate owner/session changes. A sole current
 * claimant is the configured occupant, not proof of independent process ownership; multiple claimants never route.
 */
export type PinTarget = { kind: 'owner'; workspaceId: string } | { kind: 'conversation'; machine: string; harness: string; session: string };
export type AgentPin = { id: string; name: string; target: PinTarget | null; /** Storage-only preservation; never projected into the API. */ unresolvedSource?: unknown };
export type PinView = AgentPin & { state: 'ready' | 'ambiguous' | 'unavailable' | 'unresolved'; agentId?: string; detail?: string };
export type PinWorkspace = { id: string; owner: string };
export type PinRow = { id: string; name: string; workspace?: string | null; kind?: string | null; main?: boolean; navOwner?: boolean; zero?: boolean; machineKey?: string; machine?: string; tool?: string; session?: string | null; row?: string; serviceHost?: unknown; host?: unknown };
export type PinRegistry = { workspaces: PinWorkspace[]; pinned: string[]; pinRefs?: AgentPin[] };

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);
const nameKey = (name: string) => name.trim().toUpperCase();
const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
/** Synthetic siso-host terminal rows and pane-less Claude rows share a provider. */
export const pinHarness = (tool: string) => tool === 'siso' ? 'claude' : tool;
export function readPinTarget(value: unknown): PinTarget | null {
  if (!object(value)) return null;
  if (value.kind === 'owner' && Object.keys(value).every(key => ['kind', 'workspaceId'].includes(key)) && text(value.workspaceId, 80) && /^[a-z0-9][a-z0-9-]*$/.test(value.workspaceId)) return { kind: 'owner', workspaceId: value.workspaceId };
  if (value.kind === 'conversation' && Object.keys(value).every(key => ['kind', 'machine', 'harness', 'session'].includes(key)) && text(value.machine, 160) && text(value.harness, 80) && text(value.session, 300)) return { kind: 'conversation', machine: value.machine, harness: pinHarness(value.harness), session: value.session };
  return null;
}
export const pinTargetKey = (target: PinTarget) => target.kind === 'owner' ? JSON.stringify(['owner', target.workspaceId]) : JSON.stringify(['conversation', target.machine, target.harness, target.session]);
const sameTarget = (a: PinTarget | null, b: PinTarget | null) => !!a && !!b && pinTargetKey(a) === pinTargetKey(b);

/** Retain damaged saved entries as visible unresolved pins; never turn parse damage into a name lookup. */
export function normalizePinRefs(value: unknown): AgentPin[] {
  const used = new Set<string>();
  const entries = Array.isArray(value) ? value : [value];
  const reserved = new Set(entries.flatMap(entry => object(entry) && text(entry.id, 160) ? [entry.id] : []));
  return entries.map((entry, i) => {
    const item = object(entry) ? entry : {};
    let id: string;
    if (text(item.id, 160) && !used.has(item.id)) id = item.id;
    else {
      let suffix = 0;
      id = `recovered-pin-${i}`;
      while (used.has(id) || reserved.has(id)) id = `recovered-pin-${i}-${++suffix}`;
    }
    used.add(id);
    const target = readPinTarget(item.target);
    const name = text(item.name, 120) ? item.name : text(entry, 120) ? entry : 'Saved agent';
    const changed = !object(entry) || item.id !== id || item.name !== name || item.target !== null && !target;
    return { ...item, id, name, target, ...(changed ? { unresolvedSource: entry } : {}) };
  });
}

const workspaceFor = (target: Extract<PinTarget, {kind: 'owner'}>, workspaces: PinWorkspace[]) => workspaces.filter(w => w.id === target.workspaceId && text(w.owner, 120));
const ownerRole = (row: PinRow) => row.kind === 'owner' || row.kind !== 'worker' && (row.navOwner === true || row.main === true || row.zero === true);
const ownerRows = (workspace: PinWorkspace, rows: PinRow[]) => rows.filter(row => row.workspace === workspace.id && ownerRole(row) && sameName(row.name, workspace.owner));
function legacyOwner(name: string, workspaces: PinWorkspace[], rows: PinRow[] | undefined): PinTarget | null {
  // An absent snapshot cannot prove absence of duplicate live names. Preserve unresolved until an explicit choice.
  if (!rows) return null;
  const configured = workspaces.filter(w => text(w.owner, 120) && sameName(w.owner, name));
  const matching = rows.filter(row => sameName(row.name, name));
  if (configured.length !== 1 || workspaces.filter(w => w.id === configured[0].id).length !== 1 || matching.length > 1) return null;
  if (matching.length && !ownerRows(configured[0], matching).length) return null;
  return { kind: 'owner', workspaceId: configured[0].id };
}

/** Called once, after inventory assembly. Presence of pinRefs is the migration marker, even when empty. */
export function migrateAgentPins(registry: PinRegistry, rows: PinRow[] | undefined, newId: () => string): boolean {
  if (registry.pinRefs !== undefined) return false;
  const names: unknown[] = Array.isArray(registry.pinned) ? registry.pinned : [registry.pinned];
  registry.pinRefs = names.map(value => {
    if (!text(value, 120)) return { id: newId(), name: typeof value === 'string' && value.trim() ? value.trim().replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) : 'Saved agent', target: null, unresolvedSource: value };
    return { id: newId(), name: value, target: names.filter(other => typeof other === 'string' && sameName(other, value)).length === 1 ? legacyOwner(value, registry.workspaces, rows) : null };
  });
  return true;
}

export function pinTargetForRow(row: PinRow, workspaces: PinWorkspace[]): PinTarget | undefined {
  const owners = workspaces.filter(w => w.id === row.workspace && text(w.owner, 120) && sameName(w.owner, row.name) && ownerRole(row));
  if (owners.length === 1 && workspaces.filter(w => w.id === owners[0].id).length === 1) return { kind: 'owner', workspaceId: owners[0].id };
  const machine = row.machineKey || row.machine;
  if (text(machine, 160) && text(row.tool, 80) && text(row.session, 300)) return { kind: 'conversation', machine, harness: pinHarness(row.tool), session: row.session };
  return undefined;
}
export function conversationTarget(row: PinRow): PinTarget | null {
  const machine = row.machineKey || row.machine;
  return text(machine, 160) && text(row.tool, 80) && text(row.session, 300) ? { kind: 'conversation', machine, harness: pinHarness(row.tool), session: row.session } : null;
}
function available(row: PinRow): boolean {
  const host = object(row.serviceHost) ? row.serviceHost : object(row.host) ? row.host : null;
  return (!row.row || row.row === 'live') && (!host || !host.state || host.state === 'live');
}
export function resolveAgentPin(pin: AgentPin, rows: PinRow[], workspaces: PinWorkspace[]): PinView {
  // Unsupported identity dimensions must not be narrowed away. Opaque preserved bytes stay in storage only.
  pin = { id: pin.id, name: pin.name, target: readPinTarget(pin.target) };
  if (!pin.target) return { ...pin, state: 'unresolved', detail: 'Choose an owner or conversation for this saved pin' };
  let candidates: PinRow[];
  let name = pin.name;
  if (pin.target.kind === 'owner') {
    const configured = workspaceFor(pin.target, workspaces);
    const workspaceId = pin.target.workspaceId;
    const count = workspaces.filter(w => w.id === workspaceId).length;
    if (configured.length !== 1 || count !== 1) return { ...pin, state: count > 1 ? 'ambiguous' : 'unavailable', detail: 'Owner configuration is unavailable or ambiguous' };
    name = configured[0].owner;
    candidates = ownerRows(configured[0], rows);
  } else candidates = rows.filter(row => sameTarget(conversationTarget(row), pin.target));
  // Count before filtering settled, sleeping, or unavailable rows: hiding one cannot select its namesake.
  if (candidates.length > 1 || candidates.length === 1 && rows.filter(row => row.id === candidates[0].id).length > 1) return { ...pin, name, state: 'ambiguous', detail: 'More than one agent claims this pin' };
  const row = candidates[0];
  if (!row || !available(row)) return { ...pin, name, state: 'unavailable', detail: pin.target.kind === 'owner' ? 'Owner is offline' : 'This conversation is unavailable' };
  return { ...pin, name: row.name, state: 'ready', agentId: row.id };
}

export function projectAgentPins<T extends PinRow>(registry: PinRegistry, rows: T[], identityRows: PinRow[] = rows) {
  const pins = (registry.pinRefs ?? []).map(pin => {
    const view = resolveAgentPin(pin, identityRows, registry.workspaces);
    if (view.state === 'ready' && !rows.some(row => row.id === view.agentId)) {
      const { agentId: _agentId, ...unavailable } = view;
      return { ...unavailable, state: 'unavailable' as const, detail: 'This agent is not currently available in navigation' };
    }
    return view;
  });
  const agents = rows.map(row => {
    const pinIds = pins.filter(pin => pin.state === 'ready' && pin.agentId === row.id).map(pin => pin.id);
    return { ...row, pinTarget: pinTargetForRow(row, registry.workspaces), pinIds, pinned: pinIds.length > 0 };
  });
  // Older clients still select by name. Never give them a name with multiple inventory claimants.
  const pinned = [...new Set(pins.filter(pin => pin.state === 'ready' && identityRows.filter(row => sameName(row.name, pin.name)).length === 1).map(pin => pin.name))];
  return { agents, pins, pinned };
}

export const isPinEdit = (op: unknown) => ['pin-target', 'bind-pin', 'unpin-ref', 'pin-ref-order', 'pin', 'unpin', 'pin-order'].includes(String(op));
/** Only these mutations need a fresh observed identity. Offline slot edits/removal remain available during outages. */
export function needsPinRows(body: Record<string, unknown>): boolean {
  return body.op === 'pin' || body.op === 'pin-target' || body.op === 'bind-pin';
}
function chosenTarget(body: Record<string, unknown>, registry: PinRegistry, rows: PinRow[] | undefined): { target: PinTarget; name: string } | string {
  const target = readPinTarget(body.target);
  if (!target) return 'A valid pin target is required';
  if (target.kind === 'owner') {
    const matches = registry.workspaces.filter(w => w.id === target.workspaceId);
    if (matches.length !== 1 || !text(matches[0].owner, 120)) return 'Owner configuration is unavailable or ambiguous';
    return { target, name: matches[0].owner };
  }
  if (!text(body.agentId, 300) || !rows) return 'Select a currently available conversation';
  const selected = rows.filter(row => row.id === body.agentId);
  if (selected.length !== 1 || !sameTarget(conversationTarget(selected[0]), target) || !available(selected[0])) return 'Selected conversation changed or is unavailable';
  if (rows.filter(row => sameTarget(conversationTarget(row), target)).length !== 1) return 'Selected conversation is ambiguous';
  return { target, name: selected[0].name };
}

/** Mutates only the passed registry; callers own freshness, serialization and persistence. */
export function editAgentPins(registry: PinRegistry, body: Record<string, unknown>, rows: PinRow[] | undefined, newId: () => string): string | null {
  const staged = { ...registry, pinned: Array.isArray(registry.pinned) ? [...registry.pinned] : registry.pinned, pinRefs: registry.pinRefs?.map(pin => ({ ...pin, target: pin.target && { ...pin.target } })) };
  const error = applyPinEdit(staged, body, rows, newId);
  if (error) return error;
  registry.pinRefs = staged.pinRefs;
  registry.pinned = staged.pinned;
  return null;
}
function applyPinEdit(registry: PinRegistry, body: Record<string, unknown>, rows: PinRow[] | undefined, newId: () => string): string | null {
  // A cold legacy remove/reorder has no routing decision to make. Do not finalize unrelated migration without inventory.
  if (registry.pinRefs === undefined && rows === undefined && (body.op === 'unpin' || body.op === 'pin-order')) {
    if (!Array.isArray(registry.pinned)) return 'Saved legacy pins must be loaded before editing';
    const legacy = registry.pinned;
    if (body.op === 'unpin') {
      if (!text(body.name, 120)) return 'name is required';
      const name = body.name;
      const matching = legacy.filter(value => typeof value === 'string' && sameName(value, name));
      if (matching.length > 1) return 'Pin name is ambiguous; select a saved pin';
      registry.pinned = legacy.filter(value => !matching.includes(value));
    } else {
      const names = body.names;
      if (!Array.isArray(names) || names.length > 1000 || !names.every(name => text(name, 160))) return 'Pin order must be a list of names';
      if (names.some(name => legacy.filter(value => typeof value === 'string' && sameName(value, name)).length > 1)) return 'Pin name is ambiguous; select saved pins';
      const ordered = [...new Set(names)].flatMap(name => legacy.filter(value => typeof value === 'string' && sameName(value, name)));
      registry.pinned = [...new Set(ordered), ...legacy.filter(value => !ordered.includes(value))];
    }
    return null;
  }
  if (registry.pinRefs === undefined && (body.op === 'unpin-ref' || body.op === 'pin-ref-order' || body.op === 'bind-pin')) return 'Saved pins must be loaded before editing by reference';
  // An explicit offline owner-slot action may migrate uniquely configured roles, never a conversation.
  // This binds configuration only; later runtime duplicates still make that slot ambiguous.
  const migrationRows = rows ?? (body.op === 'pin-target' && readPinTarget(body.target)?.kind === 'owner' ? [] : undefined);
  migrateAgentPins(registry, migrationRows, newId);
  const pins = registry.pinRefs!;
  if (body.op === 'pin-target' || body.op === 'bind-pin') {
    const chosen = chosenTarget(body, registry, rows);
    if (typeof chosen === 'string') return chosen;
    const existing = pins.find(pin => sameTarget(pin.target, chosen.target));
    if (body.op === 'bind-pin') {
      const pin = pins.find(pin => pin.id === body.pinId);
      if (!pin) return 'Saved pin is unavailable';
      const expected = body.expectedTarget === null ? null : readPinTarget(body.expectedTarget);
      if (!Object.hasOwn(body, 'expectedTarget') || body.expectedTarget !== null && !expected) return 'The previous pin target is required';
      const unchanged = pin.target === null && expected === null || sameTarget(pin.target, expected);
      if (!unchanged && !sameTarget(pin.target, chosen.target)) return 'This pin changed in another window; review its current target';
      if (existing && existing.id !== pin.id) return 'That owner or conversation is already pinned';
      pin.name = chosen.name; pin.target = chosen.target;
      delete pin.unresolvedSource;
    } else if (!existing) pins.push({ id: newId(), ...chosen });
  } else if (body.op === 'unpin-ref') {
    if (!text(body.pinId, 160)) return 'pinId is required';
    registry.pinRefs = pins.filter(pin => pin.id !== body.pinId);
  } else if (body.op === 'pin-ref-order' || body.op === 'pin-order') {
    const values = body.op === 'pin-ref-order' ? body.ids : body.names;
    if (!Array.isArray(values) || values.length > 1000 || !values.every(value => text(value, 160))) return 'Pin order must be a list of IDs or names';
    if (body.op === 'pin-order' && values.some(name => pins.filter(pin => sameName(pin.name, name)).length > 1)) return 'Pin name is ambiguous; reorder by pin ID';
    const ids = [...new Set(values.flatMap(value => body.op === 'pin-ref-order' ? [value] : pins.filter(pin => sameName(pin.name, value)).map(pin => pin.id)))];
    registry.pinRefs = [...ids.flatMap(id => pins.filter(pin => pin.id === id)), ...pins.filter(pin => !ids.includes(pin.id))];
  } else if (body.op === 'pin' || body.op === 'unpin') {
    if (!text(body.name, 120)) return 'name is required';
    const name = body.name;
    const matches = pins.filter(pin => sameName(pin.name, name));
    if (matches.length > 1 || rows && rows.filter(row => sameName(row.name, name)).length > 1 || registry.workspaces.filter(w => text(w.owner, 120) && sameName(w.owner, name)).length > 1) return 'Pin name is ambiguous; select an exact owner or conversation';
    if (body.op === 'unpin') registry.pinRefs = pins.filter(pin => !matches.includes(pin));
    else if (!matches.length) pins.push({ id: newId(), name, target: legacyOwner(name, registry.workspaces, rows) });
  } else return 'Unknown pin operation';
  registry.pinned = projectAgentPins(registry, rows ?? []).pinned;
  return null;
}

/** Names can change; the owner workspace ID and any sealed conversation target do not. */
export function renameAgentPins(registry: PinRegistry, from: string, to: string): void {
  for (const workspace of registry.workspaces) if (typeof workspace.owner === 'string' && sameName(workspace.owner, from)) workspace.owner = to;
  for (const pin of registry.pinRefs ?? []) if (sameName(pin.name, from)) pin.name = to;
  if (Array.isArray(registry.pinned)) registry.pinned = registry.pinned.map(name => typeof name === 'string' && sameName(name, from) ? to : name);
}
