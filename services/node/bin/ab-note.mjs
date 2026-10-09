#!/usr/bin/env -S node --experimental-strip-types
import { readBoardNotes, writeBoardNote, NoteStoreError } from '../src/a0-board-notes.ts';

// Text goes through stdin, not process arguments. Nothing is written by list.
try {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !['apply','list'].includes(command)) throw new Error('Usage: ab-note.mjs apply < request.json | ab-note.mjs list');
  if (command === 'list') {
    process.stdout.write(JSON.stringify(await readBoardNotes())+'\n');
  } else {
    const chunks=[]; let length=0;
    for await (const chunk of process.stdin) { length+=chunk.length; if(length>100_000) throw new NoteStoreError('too-large'); chunks.push(chunk); }
    let request; try { request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); } catch { throw new NoteStoreError('invalid-command'); }
    // A receipt deliberately contains no note text; retries reuse the exact request ID.
    process.stdout.write(JSON.stringify(await writeBoardNote(request))+'\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ok:false,error:error instanceof NoteStoreError ? error.code : 'invalid-command',message:error instanceof NoteStoreError ? error.message : 'Usage: ab-note.mjs apply < request.json | ab-note.mjs list'})+'\n');
  process.exitCode=1;
}
