# SISO Voice as a standalone app (VOICE step 5)

Shaan, 9 Oct ~06:00: "that might end up becoming a standalone app plugin to our agent base that people can download a
world class voice app type shit." Standing decision: SISO Voice is its own MIT app and a SISO OS module; users bring their
own Groq key.

**In one line:** the voice code is already a clean island (the node's voice files import nothing from Agent Base), so
standalone means lifting four parts into their own repo, cutting six named couplings, and adding one thing: a Groq key
the user types in.

## What moves out (about 4,100 lines today)

| Part | Today | Lines | Notes |
|---|---|---|---|
| The engine | `apps/desktop/native_dictation.swift`, bundled by `apps/desktop/build.rs` as `Agent Base Voice.app` | 938 | hotkey tap, recorder, the bar, paste, self-check, retry copy |
| The server | `services/node/src/dictation*.ts`, `voice.ts`, `voice-transcribe.ts`, `voice-health.ts` | ~1,650 | imports only `node:*` and each other; mounted by `routes/services.area.ts` (`handleDictation`, `handleVoice`) |
| The pages' parts | `packages/siso-voice` (`@siso/voice`: History, Stats, Dictionary, Settings, Calendar, charts, api) | ~1,200 | depends only on `@siso/shell` (`cn`) |
| The pages | `apps/web/src/components/VoiceSpace.tsx` + `.css` (Home, the side nav, Settings' first two cards) | ~600 | the only part written against Agent Base's shell |

Stays in Agent Base: `voice-speak.ts` (reads agent replies aloud), the chat mic (it calls the shared
`/api/voice/transcribe`), and the ownership switch between the old SISO Voice app and Agent Base.

## The boundary: six couplings to cut

1. **Where the engine finds its server.** `native_dictation.swift:13` uses `AB_PORT`, default 5401 (Agent Base's node).
   Standalone: its own server on 127.0.0.1:5402, read from `SISO_VOICE_PORT`; Agent Base sets it to 5401.
2. **Where state lives.** `~/.local/state/agent-base/dictation` (history.sqlite, pending/, takes.jsonl, owner.json).
   Standalone: `~/Library/Application Support/SISO Voice/` with a one-time move; Agent Base points `AB_DICTATION_DIR` at
   the same folder, so the two builds share one history.
3. **Paste again from the page.** The web page calls the Tauri command `dictation_paste` in `apps/desktop/src/lib.rs`,
   which runs the engine. The standalone shell carries the same command.
4. **Ownership.** `dictation-owner.ts` hands the hotkey between the old SISO Voice app and Agent Base (launchd bootout and
   restore). Standalone owns the hotkey outright, so this module stays Agent Base only, and the plugin build checks for
   the standalone app instead.
5. **Shaan-only outputs.** The JARVIS outbox (`~/.siso/voice-outbox.ndjson`, drained by `com.siso.voice-sync`) and the read of the old
   app's `PipelineHistory.sqlite`. Standalone: outbox off by default (a "Send each dictation to…" setting, a file or a
   URL); the old history becomes "Import from SISO Voice" in Settings.
6. **Shell parts in the pages.** `VoiceSpace.tsx` uses `../lib/poll` (`useSharedState`), `halo-face` (`LivingIcon`) and
   the `halo-rim` CSS. Give `@siso/voice` a small polling hook of its own (poll.ts is 212 lines and shared app-wide, so it stays), and take the icon and rim as props, so
   the page set renders in any shell.

The engine keeps the bundle id `com.siso.voice` on purpose: macOS ties the Microphone and Accessibility grants to it,
so moving apps never asks again.

## Bring your own Groq key

Today the key is read at each request from `~/Library/Application Support/SISO Voice/.settings` (`groq_api_key`, mode
0600) or `GROQ_API_KEY`. It never reaches the page, a log or a reply (`voice-transcribe.ts`). Standalone:

1. **First run** shows one card, "Your Groq key": a link to console.groq.com/keys, a masked field and **Test**.
2. `POST /api/voice/key {key}` checks it against Groq (`GET /openai/v1/models`). Only if Groq says yes is it saved, to
   the macOS Keychain (service `SISO Voice`, account `groq`). The reply is `{ok, model}`, never the key.
3. **Read order:** `GROQ_API_KEY` → Keychain → the legacy `.settings` file, so Shaan's machine keeps working unchanged.
4. **Settings** shows "Key saved · Groq answered 2 min ago", Replace and Remove. A rejected key turns Home's honest line
   red ("Groq refused your key"), and takes queue on disk until it is fixed (the retry queue exists already).
5. **Cost:** Groq's Whisper is billed per audio hour, so Settings shows this month's spoken minutes (from `seconds`,
   stored since 9 Oct) and the rough cost.

## Shape of the download

- **Repo:** `sisodias/siso-voice`, MIT, with `engine/` (Swift), `server/` (the TS files), `ui/` (`@siso/voice` plus the
  pages) and `app/` (a small Tauri shell: one window, a menu-bar item, the engine as a bundled helper).
- **Server:** compiled to one binary (`bun build --compile`) and run as the app's sidecar. There is no Node install for
  users; `node:sqlite` becomes `bun:sqlite` behind a 20-line adapter.
- **Agent Base as the plugin host:** consumes `ui/` and `server/` as workspace packages and mounts the routes in its
  node, exactly as today. One code path, two shells.
- **Signing:** a Developer ID and notarisation are needed for anyone but Shaan (today the engine is signed ad hoc in
  `build.rs`). This is the one paid prerequisite: the $99/yr Apple account.

## Order of work

1. In this repo, no behaviour change: cut couplings 1, 2 and 6 behind env and props. Agent Base still runs it all.
2. Key card + Keychain (BYO), with tests on a fake Groq. It is useful to Agent Base too: one place to change his key.
3. New repo from those folders (history kept with `git filter-repo`), plus the Tauri shell, sidecar and first-run.
4. Outbox setting, Import from SISO Voice, signing, a landing page on the SISO site.

Decided (not left open): Groq only for 1.0, because local Whisper is the most-asked feature but doubles the engine and
he chose Groq. Mac only. MIT. No accounts and no server of ours: the key and the history never leave the user's Mac.
