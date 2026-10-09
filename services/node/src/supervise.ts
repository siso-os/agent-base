import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "server.ts");
const childEnv = { ...process.env };
for (const key of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete childEnv[key];
childEnv.TERM = "xterm-256color";
// The child may exit 75 on a code change only when someone is here to start it again (server.ts).
childEnv.AB_SUPERVISED = "1";

let stopping = false;
let child: ReturnType<typeof spawn> | undefined;
const stop = () => {
  stopping = true;
  child?.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

while (!stopping) {
  child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", server], {
    cwd: process.cwd(), env: childEnv, stdio: "inherit",
  });
  const code = await new Promise<number | null>((resolve) => {
    child!.once("error", (error) => { console.error("Could not start Agent Base node:", error); resolve(1); });
    child!.once("exit", (status) => resolve(status));
  });
  if (stopping) break;
  if (code !== 75) {
    process.exitCode = code ?? 1;
    break;
  }
  console.log("Agent Base node source changed; restarting");
}
