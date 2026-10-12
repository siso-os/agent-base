import type { Module } from "@siso/os";

/** Communications (Shaan, 10 Oct: "Merge Rolodex and WhatsApp"): his chats and the people in them. Private: never mirrored. */
export default {
  id: "whatsapp", name: "Communications", space: "agency", icon: "whatsapp", order: 0,
  line: "Your chats and the people in them",
  entry: { kind: "builtin", component: "whatsapp" },
  host: "local",
} satisfies Module;
