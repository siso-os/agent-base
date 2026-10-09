import path from "node:path";

// Keep inherited workstation configuration out of synthetic UI nodes. Each suite
// applies its own fake-herdr and fixture paths after these defaults.
export function qaFixtureEnv(scratch) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AB_") || /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) delete env[key];
  }
  return {
    ...env,
    AB_HOME: scratch,
    AB_CODEX_HOME: path.join(scratch, "codex"),
    AB_ORG_HOME: scratch,
    AB_HUB_HOME: scratch,
    AB_ROLODEX_HOME: scratch,
    AB_BROWSER_HOME: scratch,
    AB_LIBRARY_SITE: "http://127.0.0.1:9",
    AB_SHELL_SITE: "http://127.0.0.1:9",
    AB_CONSOLE_URL: "",
    AB_SPEND_CMD: "qa-no-spend-command",
    AB_WHATSAPP_URL: "http://127.0.0.1:9",
    AB_WHATSAPP_TOKEN: "",
    AB_VOICE_DB: path.join(scratch, "none.sqlite"),
    AB_VOICE_PREFS: "com.siso.qa-fixture-no-preferences",
    AB_VOICE_WATCH: "0",
    AB_OPEN_DRY: "1",
    AB_AGENTS_MS: "1000",
  };
}
