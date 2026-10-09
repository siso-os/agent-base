import { spawn, spawnSync } from "node:child_process";

const app = "Agent Base";
const port = process.env.AB_WEB_PORT ?? "5410";
const url = `http://127.0.0.1:${port}/`;
const vite = spawn("pnpm", ["--filter", "@agent-base/web", "dev", "--host", "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, AB_NODE: process.env.AB_NODE ?? process.env.AB_PORT ?? "5401", AB_WEB_PORT: port },
});

function openApp(dev) {
  const args = ["-a", app];
  if (dev) args.push("--env", `AB_DEV_URL=${url}`, "--env", "AB_DEV=1");
  const result = spawnSync("open", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`open exited with ${result.status ?? result.error}`);
}

function quitApp() {
  const result = spawnSync("osascript", ["-e", `quit app "${app}"`], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`osascript exited with ${result.status ?? result.error}`);
}

let stopping = false;
async function stopAndRestore() {
  if (stopping) return;
  stopping = true;
  vite.kill("SIGTERM");
  try {
    quitApp();
    openApp(false);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", stopAndRestore);
process.on("SIGTERM", stopAndRestore);
vite.on("exit", (code) => {
  if (!stopping && code !== 0) {
    console.error(`Vite exited with ${code}`);
    process.exitCode = code ?? 1;
  }
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (vite.exitCode !== null) throw new Error(`Vite exited before becoming ready (${vite.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`Vite did not serve ${url} within 20 seconds`);
  quitApp();
  openApp(true);
  console.log(`Agent Base is using ${url}; press Ctrl+C to restore the regular app.`);
} catch (error) {
  console.error(error);
  vite.kill("SIGTERM");
  process.exitCode = 1;
}
