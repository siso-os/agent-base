import type { Module } from "@siso/os";

/**
 * SISO Code: T3 Code (pingdotgg/t3code) as the base, our parts on top (Shaan, 13 Oct: "make a separate tab in the side
 * nav ... we'll call it SISO code ... a fork from that module ... we still have both of our agent bases then, and then we
 * can start figuring out how to transfer stuff over bit by bit"). Its server runs on the Mac mini from the sisodias/siso-code
 * fork, which pulls T3's updates; the node pairs this app with it and shows it here, beside Agent Base, which is untouched.
 */
export default {
  // The Agent Base head opens this, so the rail has one icon for both (Shaan, 15 Oct: "the old agent base in the side nav
  // should be compressed ... into the SISO code and you get rid of the agent base one").
  id: "siso-code", name: "SISO Code", space: "agent-base", icon: "siso-code", order: -1, rail: false,
  line: "T3 Code with our parts on top, running on this laptop",
  entry: { kind: "url", url: "http://127.0.0.1:5401/api/code/open" },
  sidenav: "none",
  // T3 has its own sidebar toggle in that corner (Shaan, 13 Oct: "the refresh button is covering over the side nav button").
  frameReload: false,
  host: "any",
} satisfies Module;
