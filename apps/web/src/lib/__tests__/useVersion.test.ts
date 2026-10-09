// @ts-nocheck
const h=vi.hoisted(()=>({values:[],refs:[],effects:[],stateSlot:0,refSlot:0,mounted:false,tick:null}));
vi.mock('react',()=>({
 useState:(initial)=>{const i=h.stateSlot++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return[h.values[i],v=>{h.values[i]=typeof v==='function'?v(h.values[i]):v;}];},
 useRef:(value)=>{const i=h.refSlot++;return h.refs[i]??(h.refs[i]={current:value});},
 useEffect:fn=>{if(!h.mounted)h.effects.push(fn);},useCallback:fn=>fn,
}));
vi.mock('../poll',()=>({every:fn=>{h.tick=fn;fn();return()=>{};},isVisible:()=>true}));
import {useVersion} from '../useVersion';
const version={web:'old',node:'n',desktop:'d',sha:'old'};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const render=()=>{h.stateSlot=0;h.refSlot=0;const value=useVersion();h.mounted=true;return value;};
const tick=async(at)=>{vi.setSystemTime(at);h.tick();await flush();return render();};
beforeEach(()=>{
 Object.assign(h,{values:[],refs:[],effects:[],stateSlot:0,refSlot:0,mounted:false,tick:null});
 vi.useFakeTimers();vi.setSystemTime(0);
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('sessionStorage',{getItem:()=>null,removeItem:()=>{}});
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 render();for(const effect of h.effects)effect();
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('waits two minutes of failures; dismissal persists until recovery and a new failed period',async()=>{
 await flush();expect(render().error).toBe(false);
 expect((await tick(119999)).error).toBe(false);
 let state=await tick(120000);expect(state.error).toBe(true);
 state.dismiss();expect(render().error).toBe(false);
 expect((await tick(180000)).error).toBe(false);
 fetch.mockResolvedValueOnce({ok:true,json:async()=>version});expect((await tick(210000)).error).toBe(false);
 expect((await tick(240000)).error).toBe(false);expect((await tick(360000)).error).toBe(true);
});
it('one failed check followed by recovery never shows the notice; a real build change is visible',async()=>{
 await flush();expect(render().error).toBe(false);
 fetch.mockResolvedValueOnce({ok:true,json:async()=>version});expect((await tick(30000)).error).toBe(false);
 await tick(60000);let state=await tick(180000);expect(state.error).toBe(true);state.dismiss();
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({...version,web:'new',sha:'new'})});
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({subjects:['A real change'],changes:[],sha:'new'})});
 state=await tick(210000);expect(state.error).toBe(false);expect(state.update?.sha).toBe('new');
});
