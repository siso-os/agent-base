// @ts-nocheck
import { canvasNodes, CANVAS_STORAGE_KEY, fitCanvas, readCanvasLayout, saveCanvasLayout, zoomCanvas } from '../agent-canvas';
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value) }; };
const agent = (key, extra={}) => ({ key, id: key, name: key, pages: [], ...extra });

describe('agent canvas layout', () => {
  it('keeps stable agent positions across session/id changes and missing roster members', () => {
    const store=storage(); saveCanvasLayout(store,{id:'agent:laptop/zero',point:{x:-120,y:480}}); saveCanvasLayout(store,{id:'agent:absent',point:{x:40,y:10}});
    const layout=readCanvasLayout(store).layout;
    const nodes=canvasNodes([agent('laptop/zero',{id:'new-terminal',zero:true})],[],layout.positions);
    expect(nodes[0]).toMatchObject({id:'agent:laptop/zero',x:-120,y:480});
    saveCanvasLayout(store,{camera:{x:20,y:50,z:.5}});
    expect(readCanvasLayout(store).layout.positions['agent:absent']).toEqual({x:40,y:10});
    expect(readCanvasLayout(store).layout.camera).toEqual({x:20,y:50,z:.5});
  });
  it('retains corrupt data and previous layout when storage refuses writes', () => {
    const store=storage(); store.setItem(CANVAS_STORAGE_KEY,'corrupt');
    expect(readCanvasLayout(store).error).toBeTruthy(); expect(saveCanvasLayout(store,{id:'a',point:{x:0,y:0}})).toBeTruthy(); expect(store.getItem(CANVAS_STORAGE_KEY)).toBe('corrupt');
    const good=storage();saveCanvasLayout(good,{id:'a',point:{x:0,y:0}});const before=good.getItem(CANVAS_STORAGE_KEY);
    expect(saveCanvasLayout({getItem:good.getItem,setItem:()=>{throw Error()}},{id:'a',point:{x:5,y:0}})).toBeTruthy();expect(good.getItem(CANVAS_STORAGE_KEY)).toBe(before);
    expect(saveCanvasLayout(good,{id:'a',point:{x:Infinity,y:0}})).toBeTruthy();expect(good.getItem(CANVAS_STORAGE_KEY)).toBe(before);
  });
  it('uses the passed roster, retains explicit owners, nests workers and groups actual batches', () => {
    const roster=[agent('zero',{zero:true}),agent('builder',{kind:'owner',owner:'zero'}),agent('estate',{kind:'owner'}),agent('worker',{owner:'builder'}),agent('nested',{parentId:'worker'})];
    const fleet={name:'source-review',machine:'mini',jobs:[{id:'01-storage-review',status:'done'}]};
    const nodes=canvasNodes(roster,[fleet],{});
    expect(nodes.filter(n=>n.agent).map(n=>n.agent.key)).toEqual(['zero','builder','estate']);
    expect(nodes.find(n=>n.agent?.key==='builder').crew.map(a=>a.key)).toEqual(['worker','nested']);
    expect(nodes.find(n=>n.fleet).fleet).toBe(fleet);
    expect(nodes.some(n=>n.label==='HEALTH')).toBe(false);
  });
  it('keeps malformed ownership cycles reachable and avoids duplicate agent keys', () => {
    const nodes=canvasNodes([agent('a',{owner:'b'}),agent('b',{owner:'a'}),agent('a',{owner:'b'})],[],{});
    expect(nodes.map(n=>n.id).sort()).toEqual(['agent:a','agent:b']);
  });
  it('fits negative coordinates and zooms around the same world point', () => {
    const nodes=[{x:-300,y:-100,w:320,h:240},{x:400,y:300,w:540,h:340}];
    const fit=fitCanvas(nodes,1024,700);
    for(const n of nodes){expect(n.x*fit.z+fit.x).toBeGreaterThanOrEqual(0);expect((n.x+n.w)*fit.z+fit.x).toBeLessThanOrEqual(1024);expect((n.y+n.h)*fit.z+fit.y).toBeLessThanOrEqual(700);}
    const camera={x:50,y:-20,z:.5},anchor={x:390,y:200};const next=zoomCanvas(camera,1.2,anchor);
    expect((anchor.x-next.x)/next.z).toBeCloseTo((anchor.x-camera.x)/camera.z);
    expect((anchor.y-next.y)/next.z).toBeCloseTo((anchor.y-camera.y)/camera.z);
  });
});
