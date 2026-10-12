import type { Module } from "@siso/os";

/** The App Factory, from APP-FACTORY: a URL module until it moves in as a package (siso-os.md §2, §10 step 7). */
export default {
  id: "app-factory", name: "App Factory", space: "app-factory", icon: "app-factory", order: 0, rail: false,
  line: "App Factory: build an app from the factory's parts",
  entry: { kind: "url", url: "http://127.0.0.1:8850/app?embed=1" },
  sidenav: "none",
} satisfies Module;
