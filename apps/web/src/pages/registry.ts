import type { ReactNode } from "react";

export type RegisteredPageContext = { onBack: () => void; backLabel: string };
export type RegisteredPage = {
  id: string;
  title: string;
  icon: ReactNode;
  nav?: { group: string; order: number };
  render: (ctx: RegisteredPageContext) => ReactNode;
};

const pages = new Map<string, RegisteredPage>();

export function registerPage(page: RegisteredPage) {
  if (!page.id.trim()) throw new Error("page id is required");
  if (pages.has(page.id)) throw new Error(`duplicate page id: ${page.id}`);
  pages.set(page.id, page);
  return page;
}

export function getPage(id: string) { return pages.get(id); }
export function listPages() {
  return [...pages.values()].filter((page) => page.nav).sort((a, b) =>
    a.nav!.group.localeCompare(b.nav!.group) || a.nav!.order - b.nav!.order || a.title.localeCompare(b.title));
}
