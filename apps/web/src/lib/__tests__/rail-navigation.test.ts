// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { directZeroReports } from '../rail-navigation';

const agent = (id, extra = {}) => ({ id, name: id, row: 'live', status: 'idle', ...extra });
const owner = (name, extra = {}) => ({ name, kind: 'owner', ...extra });
const org = (owners) => ({ zero: { name: 'A0' }, top: [], groups: [{ id: 'labs', name: 'Labs', projects: [{ name: 'OS', domains: owners.map(owner => ({ name: owner.name, owner })) }] }] });

describe('Agent Zero rail dropdown', () => {
  it('uses registry seats, preserves offline reports and excludes owners reporting to another owner', () => {
    const chart = org([owner('BUILD'), owner('QA', { owner: 'BUILD' }), owner('OFFLINE')]);
    const rows = [agent('BUILD', { kind: 'owner' }), agent('QA', { kind: 'owner', owner: 'BUILD' })];
    const reports = directZeroReports(chart, rows);
    expect(reports.map(r => r.name)).toEqual(['BUILD', 'OFFLINE']);
    expect(reports[0].agent.id).toBe('BUILD');
    expect(reports[1].agent).toBeUndefined();
  });
  it('includes direct workers, deduplicates seat aliases and excludes grandchildren and unrelated agents', () => {
    const chart = org([owner('STACK-OPT'), owner('EFFICIENCY')]);
    const rows = [agent('zero', { name: 'Agent Zero', zero: true }), agent('eff', { name: 'EFFICIENCY', kind: 'owner' }),
      agent('direct', { owner: 'Agent Zero' }), agent('child', { owner: 'direct' }), agent('unknown')];
    expect(directZeroReports(chart, rows).map(r => r.name)).toEqual(['STACK-OPT', 'direct']);
  });
  it('honors the side-nav resolved owner relationship', () => {
    const chart = org([owner('BUILD'), owner('QA')]);
    const rows = [agent('BUILD', { kind: 'owner' }), agent('QA', { kind: 'owner', navParentId: 'BUILD' })];
    expect(directZeroReports(chart, rows).map(r => r.name)).toEqual(['BUILD']);
  });
  it('preserves planned roster seats even when the hub has no running session', () => {
    const roster = { bottom: [], groups: [{ id: 'labs', name: 'Labs', projects: [{ name: 'OS', owners: [{ name: 'PLANNED', state: 'planned' }] }] }] };
    expect(directZeroReports(org([]), [], roster).map(r => r.name)).toEqual(['PLANNED']);
  });
});
