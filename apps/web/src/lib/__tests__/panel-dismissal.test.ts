// @ts-nocheck
// Focused lifecycle contract for the real wrapper. Timed React DOM/navigation
// reproduction lives in the release receipt; descendants are not rendered here.
const h = vi.hoisted(() => { vi.stubGlobal('window', { addEventListener() {}, setInterval() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }); return { slots: [], cursor: 0 }; });
vi.mock('react', async importOriginal => ({
  ...await importOriginal(),
  useState: initial => {
    const i = h.cursor++;
    h.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [h.slots[i].value, value => { h.slots[i].value = typeof value === 'function' ? value(h.slots[i].value) : value; }];
  },
  useRef: value => { const i = h.cursor++; return (h.slots[i] ??= { current: value }); },
  useEffect: (effect, deps) => {
    const i = h.cursor++, previous = h.slots[i];
    if (previous && deps.every((v, j) => Object.is(v, previous.deps[j]))) return;
    previous?.cleanup?.();
    h.slots[i] = { deps, cleanup: effect() };
  },
}));
vi.mock('../face', () => ({ AgentFace: () => null, faceFor: () => ({}), accentRgb: () => '0,0,0' }));
vi.mock('../../../../../packages/halo-face', () => ({ AgentFace: () => null, projectHue: () => 0 }));
import { AgentPanel } from '../../components/AgentPanel';

const render = props => { h.cursor = 0; return AgentPanel(props); };
const unmount = () => { for (const slot of h.slots) slot?.cleanup?.(); h.slots = []; };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) });
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reports dismissal immediately, before navigation can cancel the exit timer', () => {
  let savedOpen = true;
  const onClose = vi.fn(() => { savedOpen = false; });
  const tree = render({ open: true, onClose });
  tree.props.onClose();
  expect(savedOpen).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
  render({ open: false, onClose });
  unmount();
  vi.advanceTimersByTime(200);
  expect(savedOpen).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps a closing panel present and inert for its exit, without emitting another dismissal', () => {
  const onClose = vi.fn();
  render({ open: true, onClose });
  expect(render({ open: false, onClose }).props.closing).toBe(true);
  vi.advanceTimersByTime(199);
  expect(render({ open: false, onClose })).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(render({ open: false, onClose })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it('lets a newer explicit open win over the pending visual exit', () => {
  const onClose = vi.fn();
  render({ open: true, onClose });
  render({ open: false, onClose });
  vi.advanceTimersByTime(50);
  expect(render({ open: true, onClose }).props.closing).toBe(false);
  vi.advanceTimersByTime(200);
  expect(render({ open: true, onClose })).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it('never applies a delayed close to a different route callback', () => {
  const oldRoute = vi.fn(), newRoute = vi.fn();
  render({ open: true, onClose: oldRoute }).props.onClose();
  render({ open: false, onClose: oldRoute });
  vi.advanceTimersByTime(50);
  render({ open: true, onClose: newRoute });
  vi.advanceTimersByTime(200);
  expect(oldRoute).toHaveBeenCalledTimes(1);
  expect(newRoute).not.toHaveBeenCalled();
});

it('honors reduced motion and starts closed when asked', () => {
  window.matchMedia = () => ({ matches: true });
  const onClose = vi.fn();
  expect(render({ open: false, onClose })).toBeNull();
  render({ open: true, onClose });
  render({ open: false, onClose });
  vi.advanceTimersByTime(0);
  expect(render({ open: false, onClose })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});
