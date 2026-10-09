// @ts-nocheck
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it } from 'vitest';

// Executable source-extracted ownership contracts, without browser or transport access.
// The separate ReactDOM lifecycle fixture covers these handlers in actual ChatView mounts.
const source = readFileSync(process.env.AB_CHAT_SOURCE ?? 'apps/web/src/components/ChatView.tsx', 'utf8');
const resizeStart = source.includes('  const stopResize =') ? '  const stopResize =' : '  const grab =';
const resize = source.slice(source.indexOf(resizeStart), source.indexOf('  useLayoutEffect(() => {', source.indexOf(resizeStart)));
const hold = source.slice(source.indexOf('  const spaceHold ='), source.indexOf('  // While its mic listens', source.indexOf('  const spaceHold =')));

function fixture() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const timers = new Map<number, () => void>();
  const sizes: number[] = [];
  const refs: { current: any }[] = [];
  const effects: { deps: any[]; stop?: () => void }[] = [];
  let refIndex = 0, effectIndex = 0, timerId = 0;
  const win = {
    addEventListener(type: string, fn: (...args: any[]) => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
    removeEventListener(type: string, fn: (...args: any[]) => void) { listeners.get(type)?.delete(fn); },
    clearTimeout(id: number) { timers.delete(id); },
  };
  const useRef = (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial });
  const useEffect = (run: () => (() => void), deps: any[]) => {
    const index = effectIndex++, previous = effects[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    previous?.stop?.(); effects[index] = { deps, stop: run() };
  };
  const compile = new Function('window', 'useRef', 'useEffect', 'box', 'sizeTo', 'agentId', 'agentKey', 'active', 'onScreen',
    stripTypeScriptTypes(resize + hold) + '\nreturn {grab, spaceHold};');
  const props = { agentId: 'one', agentKey: 'key-one', active: true, onScreen: true };
  const render = (next: Partial<typeof props> = {}) => {
    Object.assign(props, next); refIndex = effectIndex = 0;
    return compile(win, useRef, useEffect, { current: { clientHeight: 52 } }, (height: number) => sizes.push(height), props.agentId, props.agentKey, props.active, props.onScreen);
  };
  const dispatch = (type: string, event = {}) => [...(listeners.get(type) ?? [])].forEach(fn => fn(event));
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  const unmount = () => { effects.forEach(effect => effect.stop?.()); effects.length = 0; };
  const startTimer = (ref: { current: number }, fn: () => void) => { ref.current = ++timerId; timers.set(timerId, fn); };
  const runTimers = () => { const all = [...timers.values()]; timers.clear(); all.forEach(fn => fn()); };
  return { render, dispatch, count, unmount, sizes, startTimer, runTimers, timers };
}
const down = { button: 0, clientY: 300, preventDefault() {} };

describe('composer resize ownership', () => {
  it('keeps normal resizing and releases on pointer up', () => {
    const f = fixture(); f.render().grab(down); f.dispatch('pointermove', { clientY: 200 });
    expect(f.sizes).toEqual([152]); f.dispatch('pointerup');
    f.dispatch('pointermove', { clientY: 100 }); expect(f.sizes).toEqual([152]);
    expect(f.count('pointermove')).toBe(0); expect(f.count('pointerup')).toBe(0); f.unmount();
  });
  for (const end of ['pointercancel', 'blur']) it(`cancels while still mounted on ${end}`, () => {
    const f = fixture(); f.render().grab(down); f.dispatch(end); f.dispatch('pointermove', { clientY: 100 });
    expect(f.sizes).toEqual([]); expect(f.count('pointermove')).toBe(0); expect(f.count('pointerup')).toBe(0); f.unmount();
  });
  it('replaces a previous drag rather than accumulating handlers', () => {
    const f = fixture(), view = f.render(); view.grab(down); view.grab(down);
    expect(f.count('pointermove')).toBe(1); f.dispatch('pointermove', { clientY: 200 }); expect(f.sizes).toEqual([152]); f.unmount();
  });
  for (const next of [{ active: false }, { onScreen: false }, { agentId: 'two' }, { agentKey: 'key-two' }]) it(`releases on ${JSON.stringify(next)}`, () => {
    const f = fixture(); f.render().grab(down); f.render(next); f.dispatch('pointermove', { clientY: 100 });
    expect(f.sizes).toEqual([]); expect(f.count('pointermove')).toBe(0); f.unmount();
  });
  it('cannot retain an unmounted chat through a window listener', () => {
    const f = fixture(); f.render().grab(down); f.unmount(); f.dispatch('pointermove', { clientY: 100 });
    expect(f.sizes).toEqual([]); expect(f.count('pointermove')).toBe(0); expect(f.count('pointerup')).toBe(0);
  });
  it('ignores non-primary and inactive resize requests', () => {
    const f = fixture(); f.render().grab({ ...down, button: 1 }); f.render({ active: false }).grab(down);
    expect(f.count('pointermove')).toBe(0); f.unmount();
  });
});

describe('pending composer Space hold', () => {
  for (const next of [{ active: false }, { onScreen: false }, { agentId: 'two' }, { agentKey: 'key-two' }]) it(`cancels before microphone start on ${JSON.stringify(next)}`, () => {
    const f = fixture(), view = f.render(); let fired = false;
    f.startTimer(view.spaceHold, () => { fired = true; }); f.render(next); f.runTimers();
    expect(fired).toBe(false); expect(view.spaceHold.current).toBe(0); f.unmount();
  });
  for (const end of ['blur', 'unmount']) it(`cancels before microphone start on ${end}`, () => {
    const f = fixture(), view = f.render(); let fired = false;
    f.startTimer(view.spaceHold, () => { fired = true; }); if (end === 'blur') f.dispatch('blur'); else f.unmount();
    f.runTimers(); expect(fired).toBe(false); f.unmount();
  });
  it('leaves an already-started take to the existing voice lifecycle', () => {
    const f = fixture(), view = f.render(); view.spaceHold.current = -1; f.dispatch('blur');
    expect(view.spaceHold.current).toBe(-1); f.unmount();
  });
  it('preserves an uninterrupted pending hold across ordinary renders', () => {
    const f = fixture(), view = f.render(); let fired = false;
    f.startTimer(view.spaceHold, () => { fired = true; }); f.render(); f.runTimers();
    expect(fired).toBe(true); f.unmount();
  });
});
