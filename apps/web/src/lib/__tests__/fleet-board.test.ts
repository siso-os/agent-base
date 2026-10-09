// @ts-nocheck
// Vitest globals follow the existing suite convention.
import { groupFleet } from '../../../../../services/node/src/fleet-board';
import { seedWorkspaces, editWorkspace } from '../../../../../services/node/src/workspace-registry';
const row = (id: string, name: string, extra = {}) => ({ id, name, machineKey: 'laptop', ...extra });
const ws = () => seedWorkspaces();
describe('Fleet workspace ownership', () => {
  it("puts a fleet parented to KIKAS in Kika's, separate from Clients", () => {
    const groups = groupFleet([row('k','KIKAS',{ project:'Clients' })], [{ name:'logos',parent:'KIKAS',jobs:[{id:'one',status:'running'}] }], ws());
    expect(groups.find(g => g.id === 'kikas')?.rows.map(r => r.name)).toEqual(['KIKAS','logos/one']);
    expect(groups.find(g => g.id === 'kikas')?.group).toBe('Clients');
  });
  it('leaves an unresolved job in Unassigned even with the nav fallback to Zero', () => {
    const groups = groupFleet([row('z','Agent Zero',{zero:true}),row('u','ab-unknown',{ parentId:'z',ownershipResolved:false })],[],ws());
    expect(groups.find(g => g.id === 'unassigned')?.rows.map(r => r.id)).toEqual(['u']);
  });
  it('uses dispatch workspace before host ownership and exposes dispatcher', () => {
    const groups = groupFleet([row('c','child',{ host:true,lead:'KIKAS' })],[],ws(),[{at:'now',kind:'soul',name:'child',workspace:'agent-base',parent:'Agent Zero',machine:'laptop'}]);
    expect(groups.find(g => g.id === 'agent-base')?.rows[0].dispatcher).toBe('Agent Zero');
  });
  it('walks descendants to the registered owner and tolerates cycles', () => {
    const groups = groupFleet([row('k','KIKAS'),row('a','worker',{parentId:'k'}),row('b','sub',{parentId:'a'}),row('x','x',{parentId:'y'}),row('y','y',{parentId:'x'})],[],ws());
    expect(groups.find(g => g.id === 'kikas')?.rows).toHaveLength(3);
    expect(groups.find(g => g.id === 'unassigned')?.rows).toHaveLength(2);
  });
  it('reads codex-run workspace and parent without a living parent seat', () => {
    const groups = groupFleet([row('r','DASH')],[],ws(),[],[{ worker:'DASH',workspace:'agent-base',parent:'Agent Zero' }]);
    expect(groups.find(g => g.id === 'agent-base')?.rows[0].dispatcher).toBe('Agent Zero');
  });
  it('does not conflate same-named dispatches on different machines', () => {
    const groups = groupFleet([row('r','same'),row('m','same',{machineKey:'mini'})],[],ws(),[
      {at:'now',kind:'host',name:'same',workspace:'kikas',parent:'KIKAS',machine:'laptop'},
      {at:'now',kind:'host',name:'same',workspace:'zero',parent:'Agent Zero',machine:'mini'}]);
    expect(groups.find(g => g.id === 'kikas')?.rows[0].id).toBe('r');
    expect(groups.find(g => g.id === 'zero')?.rows[0].id).toBe('m');
  });
});
describe('shared workspace layout', () => {
  it('seeds once and preserves size, colour, order and custom workspaces', () => {
    const workspaces = ws();
    expect(editWorkspace(workspaces,{ workspaces:[{id:'kikas',color:'#123456',size:'L',order:4},{id:'custom',name:'Custom',owner:'ME',group:'Clients'}] })).toBeNull();
    const again = seedWorkspaces(JSON.parse(JSON.stringify(workspaces)));
    expect(again).toHaveLength(12); expect(again[0]).toMatchObject({color:'#123456',size:'L',order:4});
    expect(groupFleet([row('me','ME')],[],again).find(g => g.id === 'custom')?.rows).toHaveLength(1);
  });
  it('rejects invalid batches atomically', () => {
    const workspaces = ws(), before = JSON.stringify(workspaces);
    expect(editWorkspace(workspaces,{workspaces:[{id:'kikas',size:'L'},{id:'zero',color:'red'}]})).toBeTruthy();
    expect(JSON.stringify(workspaces)).toBe(before);
  });
});
