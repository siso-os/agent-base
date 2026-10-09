import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPage, listPages, registerPage } from "../src/pages/registry.ts";

const fake = registerPage({
  id: "registry-test",
  title: "Registry test",
  icon: createElement("span", null, "icon"),
  nav: { group: "Test", order: 1 },
  render: ({ onBack, backLabel }) => createElement("main", null,
    createElement("button", { onClick: onBack }, backLabel),
    createElement("p", null, "Fake page rendered")),
});
assert.equal(listPages().find((page) => page.id === fake.id)?.title, "Registry test");
assert.match(renderToStaticMarkup(fake.render({ onBack() {}, backLabel: "Back to chat" })), /Back to chat.*Fake page rendered/);
assert.equal(getPage("registry-test"), fake);
assert.throws(() => registerPage({ ...fake }), /duplicate page id: registry-test/);
console.log("page registry: fake page registered, rendered with back context, and duplicate id rejected");
