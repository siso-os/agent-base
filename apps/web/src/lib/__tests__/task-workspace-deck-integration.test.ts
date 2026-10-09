import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-ignore Vitest is supplied by the pinned test runner, outside app dependencies.
import { describe, expect, it, vi } from 'vitest';
import { TaskWorkspaceGroups } from '../../components/TaskWorkspaceGroups';
import { TaskWorkspaceDeck } from '../../components/TaskWorkspaceDeck';
import type { TaskSummary } from '../../components/widgets/TasksWidget';
import { workspaceTaskGroups, type TaskWorkspaceRegistry } from '../task-workspaces';

const registry: TaskWorkspaceRegistry = { workspaces: [
  { id: 'second', name: 'Second', color: '#345678', nav: true, order: 2 },
  { id: 'first', name: 'First', color: '#123456', nav: true, order: 1 },
] };
const task = (id: string, patch: Partial<TaskSummary> = {}): TaskSummary => ({
  id, title: id, project: 'First', stage: 'building', priority: 'P2', owner: 'Owner', model: null,
  updated: '2026-10-06T00:00:00Z', ...patch,
});
const render = (tasks: TaskSummary[], props: Partial<Parameters<typeof TaskWorkspaceGroups>[0]> = {}) => renderToStaticMarkup(createElement(TaskWorkspaceGroups, {
  tasks, all: tasks, registry, loaded: true, renderTask: row => createElement('div', { 'data-original-row': row.id }, row.title), ...props,
}));

describe('approved task deck on existing task sources', () => {
  it('mounts the approved deck in registry order and passes original root records to the existing renderer once', () => {
    const root = task('root'), child = task('child', { parent: root.id }), other = task('other', { project: 'Second' });
    const renderTask = vi.fn((row: TaskSummary) => createElement('div', { 'data-original-row': row.id }, row.title));
    const html = render([root, child, other], { renderTask, reveal: true });
    expect(html).toContain('twd-deck');
    expect(html).toContain('data-root-count="2"');
    expect([...html.matchAll(/data-workspace="([^"]+)"/g)].map(match => match[1])).toEqual(['first', 'second', 'unsorted']);
    expect(renderTask.mock.calls.map(([row]: [TaskSummary]) => row)).toEqual([root, other]);
    expect(renderTask.mock.calls[0][0]).toBe(root);
    expect(html).toContain('<li class="twd-task-root"><div data-original-row="root"');
    expect(html).not.toContain('data-original-row="child"');
  });

  it('retains caller-rendered child trees without making children additional roots', () => {
    const root = task('root'), child = task('child', { parent: root.id });
    const html = render([root, child], { reveal: true, renderTask: row => createElement('div', { 'data-original-row': row.id },
      createElement('button', { type: 'button' }, 'Existing edit'),
      createElement('ol', null, createElement('li', { 'data-child': child.id }, 'Existing child tree')),
    ) });
    expect(html).toContain('data-root-count="1"');
    expect((html.match(/data-child="child"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('Existing edit');
    expect(html).toContain('Existing child tree');
  });

  it('counts only displayed roots with canonical open and needs-you semantics', () => {
    const rows = [task('building', { needs: true }), task('built', { stage: 'built' }), task('live', { stage: 'live', needs: true }), task('dropped', { stage: 'dropped', needs: true })];
    const html = render(rows, { reveal: true });
    expect(html).toContain('data-root-count="4"');
    expect(html).toContain('<b>2</b> open');
    expect(html).toContain('<b>1</b> active');
    expect(html).toContain('<b>1</b> review');
    expect(rows.filter(row => row.stage === 'live')[0].needs).toBe(true);
  });

  it('keeps empty registered workspaces and explicit Unsorted available for a loaded empty filter', () => {
    const html = render([], { reveal: true });
    expect(html).toContain('data-root-count="0"');
    expect((html.match(/data-workspace=/g) ?? [])).toHaveLength(3);
    expect((html.match(/No tasks in this view\./g) ?? [])).toHaveLength(3);
    expect(html).not.toContain('Reading workspaces');
  });

  it('keeps the reusable deck empty state when registry preservation is not requested', () => {
    const html = renderToStaticMarkup(createElement(TaskWorkspaceDeck, { groups: [], expandedIds: [], onExpandedChange: () => {}, renderTask: () => null }));
    expect(html).toContain('twd-empty');
    expect(html).not.toContain('data-workspace=');
  });

  it('distinguishes pending registry from failure without losing unmatched roots', () => {
    const rows = [task('unmatched', { project: 'Unknown' })];
    const loading = render(rows, { loaded: false, registry: { workspaces: [] } });
    expect(loading).toContain('Reading workspaces');
    expect(loading).not.toContain('Unsorted');
    const failed = render(rows, { loaded: false, failed: true, registry: { workspaces: [] } });
    expect(failed).toContain('Workspace registry unavailable');
    expect(failed).toContain('data-workspace="unsorted" data-expanded="true"');
    expect(failed).toContain('data-original-row="unmatched"');
  });

  it('preserves original filtered-orphan and cycle reachability from the existing grouping helper', () => {
    const parent = task('closed-parent', { stage: 'live' });
    const child = task('open-child', { parent: parent.id });
    const cycleA = task('a', { parent: 'b' }), cycleB = task('b', { parent: 'a' });
    const rows = [child, cycleA, cycleB], all = [parent, ...rows];
    const expected = workspaceTaskGroups(rows, registry, all).flatMap(group => group.owners.flatMap(owner => owner.tasks));
    const received: TaskSummary[] = [];
    render(rows, { all, renderTask: row => { received.push(row); return null; } });
    expect(received).toEqual(expected);
    expect(received).toContain(child);
    expect(received).toHaveLength(2);
  });
});
