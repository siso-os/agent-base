// @ts-nocheck — repo Vitest runner supplies globals without a web runtime dependency.
import { filterCommands, parseRecents, rememberCommand, type SearchableCommand } from '../command-palette';
const actions: SearchableCommand[] = [
  { id:'a',label:'Atlas',description:'Project',kind:'projects',scope:'Agency' },
  { id:'b',label:'Atlas',description:'Project',kind:'projects',scope:'Labs' },
  { id:'c',label:'Open settings',description:'Preferences',kind:'commands',keywords:['configure'] },
  { id:'d',label:'Offline chat',description:'No source',kind:'chats',available:false },
];
describe('Spotlight identity and filtering', () => {
  it('filters category and scope without conflating duplicate names', () => {
    expect(filterCommands(actions,'atlas','projects').map(a=>a.id)).toEqual(['a','b']);
    expect(filterCommands(actions,'LABS','all').map(a=>a.id)).toEqual(['b']);
    expect(filterCommands(actions,'atlas','chats')).toEqual([]);
  });
  it('command prefix overrides a selected type and searches keywords', () => {
    expect(filterCommands(actions,'  > configure','pages').map(a=>a.id)).toEqual(['c']);
    expect(filterCommands(actions,'>','projects').map(a=>a.id)).toEqual(['c']);
  });
  it('recents reorder only blank results and ignore unavailable IDs', () => {
    expect(filterCommands(actions,'','all',['gone','b']).map(a=>a.id)).toEqual(['b','a','c','d']);
    expect(filterCommands(actions,'atlas','all',['b']).map(a=>a.id)).toEqual(['a','b']);
    expect(rememberCommand(['a','b'],'b')).toEqual(['b','a']);
    expect(rememberCommand(Array.from({length:25},(_,i)=>String(i)),'new')).toHaveLength(20);
  });
  it('malformed storage never breaks navigation; only bounded unique IDs survive', () => {
    expect(parseRecents('not json')).toEqual([]);
    expect(parseRecents('{"a":true}')).toEqual([]);
    expect(parseRecents('["b",null,4,"b","a"]')).toEqual(['b','a']);
    expect(parseRecents(JSON.stringify(['x'.repeat(2048)]))).toEqual([]);
  });
  it('keeps unavailable results explicit and accepts an already-normalized URL action', () => {
    expect(filterCommands(actions,'offline','all')[0].available).toBe(false);
    expect(filterCommands([{id:'go',label:'Open example.test',description:'https://example.test',kind:'pages',matchQuery:true}],'example.test/route','pages')).toHaveLength(1);
  });
});
