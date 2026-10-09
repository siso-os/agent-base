/**
 * siso-fork SESSION [UP_TO_UUID] [TITLE]: copy a Claude session into a new one, up to (and including) one message, and
 * print the new session id. The app's "fork from a turn" (ui-hub ideas r2 #7): the old chat stays as it was; the new one
 * opens beside it under siso-host --resume. CLAUDE_CONFIG_DIR must be the login the session lives under; cwd its project.
 */
import { forkSession } from "@anthropic-ai/claude-agent-sdk";
const [session, upTo, title] = process.argv.slice(2);
if (!session || !/^[A-Za-z0-9-]+$/.test(session)) { console.error("usage: siso-fork SESSION [UP_TO_UUID] [TITLE]"); process.exit(2); }
const r = await forkSession(session, { dir: process.cwd(), ...(upTo ? { upToMessageId: upTo } : {}), ...(title ? { title } : {}) });
console.log(r.sessionId);
