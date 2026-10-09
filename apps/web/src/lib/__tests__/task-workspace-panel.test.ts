// @ts-nocheck
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { seedWorkspaces } from '../../../../../services/node/src/workspace-registry';
import { TasksCard } from '../../components/panel/PanelTabs';
import { TaskWorkspaceGroups } from '../../components/TaskWorkspaceGroups';
vi.mock('../face', () => ({ AgentFace: () => null, faceFor: () => ({}) }));
vi.mock('../a0-tasks', async importOriginal => ({ ...await importOriginal(), useA0Tasks: () => ({ index: { updated: 'pending-registry', tasks: [
  { id:'halo-task',title:'Streaming',project:'HALO',owner:'STREAM-QUALITY',stage:'building',priority:'P1' },
  { id:'base-task',title:'Faces',project:'Agent Base',owner:'FACES',stage:'allocated',priority:'P2' },
  { id:'agency-task',title:'Logos',project:'SISO Agency',owner:'KIKAS',stage:'building',priority:'P2' },
] } }) }));

describe('right-panel workspace data before its registry request completes', () => {
  it('renders the nav registry immediately, rather than assigning every task to Unsorted', () => {
    // SSR does not run the request effect: this reproduces a pending registry fetch.
    const html = renderToStaticMarkup(createElement(TasksCard, { a:{name:'Agent Zero',zero:true},agents:[],everyone:true,workspaces:seedWorkspaces(),onOpen:()=>{} }));
    for (const id of ['halo','agent-base','siso-agency']) expect(html).toContain(`data-workspace="${id}"`);
    expect(html).toContain('data-root-count="3"');
    expect((html.match(/1 root task · 1 owner</g) ?? [])).toHaveLength(3);
    expect(html).toContain('0 root tasks · 0 owners');
    expect(html).not.toContain('3 root tasks · 1 owner');
  });
  it('shows loading while no registry has arrived, without declaring an Unsorted lane', () => {
    const html = renderToStaticMarkup(createElement(TaskWorkspaceGroups,{tasks:[{id:'base-task',project:'Agent Base'}],all:[],registry:{workspaces:[]},renderTask:()=>null}));
    expect(html).toContain('role="status"');
    expect(html).toContain('Reading workspaces');
    expect(html).not.toContain('Unsorted');
  });
});
