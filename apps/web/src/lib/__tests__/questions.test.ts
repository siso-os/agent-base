// @ts-nocheck
// Vitest globals are provided by the repository's dlx runner, like the neighboring chat tests.
import { buildAnswers, resolveAnswer, type QuestionDraft } from '../questions';
import type { QuestionRequest, QuestionSpec } from '../../../../../services/host/src/questions';
const q: QuestionSpec = { id:'a',header:'Pick',question:'Pick?',options:[{value:' A ',label:'Same label',description:''},{value:'B',label:'Same label',description:''}],multiple:false,allowCustom:false,required:true };
const request: QuestionRequest = { id:'r',hostInstance:'h',session:'s',provider:'codex',mode:'live',toolId:'i',questions:[q,{ ...q,id:'b' }],createdAt:1,expiresAt:100 };
describe('Question answer boundary',()=>{
  it('preserves native option values including whitespace and equal display labels',()=>expect(resolveAnswer(q,{selected:[' A '],custom:''})).toEqual([' A ']));
  it('rejects undeclared values when custom answers are disabled',()=>expect(resolveAnswer(q,{selected:['unknown'],custom:'invented'})).toBeNull());
  it('requires all questions before producing a reply',()=>{
    const d: QuestionDraft={index:0,answers:{a:{selected:['B'],custom:''}},status:'editing'};
    expect(buildAnswers(request,d)).toBeNull();
    expect(buildAnswers(request,{...d,answers:{...d.answers,b:{selected:[' A '],custom:''}}})).toEqual({a:['B'],b:[' A ']});
  });
  it('keeps multiple values unique and allows explicit custom precedence',()=>{
    const multi={...q,multiple:true,allowCustom:true};
    expect(resolveAnswer(multi,{selected:['B','B',' A '],custom:''})).toEqual(['B',' A ']);
    expect(resolveAnswer(multi,{selected:['B'],custom:'  custom  '})).toEqual(['custom']);
  });
});
