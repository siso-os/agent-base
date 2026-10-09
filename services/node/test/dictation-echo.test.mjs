// t-0553: Whisper echoing the Dictionary's spellings onto the end of a take (8 Oct: "... Convex, Fable, SISO, herdr, Groq").
import assert from 'node:assert/strict';
import test from 'node:test';
import { dropEchoedVocabulary as drop } from '../src/dictation-audio.ts';

const vocab = 'Convex, Fable, SISO, herdr, Groq';
test('the two takes from 8 Oct lose their echoed tail', () => {
  assert.equal(drop('Can you check the board numbers. Convex, Fable, SISO, herdr, Groq', vocab), 'Can you check the board numbers.');
  assert.equal(drop('ship it tonight Convex, Fable, Groq.', vocab), 'ship it tonight', 'run on from the last word');
  assert.equal(drop('ship it tonight, Convex, Fable, Groq.', vocab), 'ship it tonight');
  assert.equal(drop('Convex, Fable, SISO, herdr, Groq', vocab), '', 'a take that is only the echo is empty');
});
test('real words stay', () => {
  assert.equal(drop('We moved the queue to Groq.', vocab), 'We moved the queue to Groq.', 'one term at the end');
  assert.equal(drop('Compare it with Convex, Fable', vocab), 'Compare it with Convex, Fable', 'two terms mid-sentence');
  assert.equal(drop('Done. Groq, Convex, Fable', vocab), 'Done. Groq, Convex, Fable', 'out of the prompt\'s order is speech, not an echo');
  assert.equal(drop('Done. Fable, Groq', vocab), 'Done.', 'two in order after a sentence end is an echo');
  assert.equal(drop('anything at all', ''), 'anything at all');
  assert.equal(drop('', vocab), '');
});
