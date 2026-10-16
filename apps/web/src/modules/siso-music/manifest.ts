/**
 * SISO Music (MUSIC seat, SISO_Agency/apps/siso-music): YouTube songs in a private local library, a player, and the `music`
 * CLI agents use. Shaan, 15 Oct: "How can I have this as a module, as its own icon". Served by launchd com.siso.music on 5493.
 */
// SISO Music as a SISO OS module (URL module, local only).
import type { Module } from "@siso/os";

export default {
  id: "siso-music",
  name: "Music",
  space: "agent-base",
  icon: "siso-music",
  order: 6,
  line: "Your own ad-free music: YouTube songs in a private library that agents can play",
  entry: { kind: "url", url: "http://127.0.0.1:5493/" },
  sidenav: "none",
  frameReload: false,
  // Shaan, 16 Oct: "when you click off of it, it stops playing".
  keepAlive: true,
  host: "local",
} satisfies Module;
