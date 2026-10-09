// @ts-nocheck
import {attentionId,presentAttention} from '../attention';
describe('attention notification route',()=>{
  it('accepts only a relative opaque attention identity',()=>{
    expect(attentionId('#attention/activity%3Ahost%3Arun%3Aterminal')).toBe('activity:host:run:terminal');
    for(const h of ['#attention/https://evil.test','#attention/%','#attention/activity%3Ahost%2Fnext','#project/foo'])expect(attentionId(h)).toBeNull();
  });
  it('uses the name and one line; a click opens the exact chat identity and closes the notification',()=>{
    const opened=[],closed=[];
    global.window={focus:()=>opened.push('focus')};
    global.Notification=class {static permission='granted';constructor(title,opts){this.title=title;this.opts=opts;global.window.notice=this;}close(){closed.push(true);}};
    window.Notification=global.Notification;
    presentAttention({id:'activity:h:r:terminal',agentName:'Worker',headline:'Finished its turn — ready for review'},id=>opened.push(id));
    expect(window.notice.title).toBe('Worker');expect(window.notice.opts.tag).toBe('activity:h:r:terminal');window.notice.onclick();
    expect(opened).toEqual(['focus','activity:h:r:terminal']);expect(closed).toEqual([true]);delete global.window;delete global.Notification;
  });
});
