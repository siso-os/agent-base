import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPageHistory } from "../nav.ts";

function fakeWindow() {
  const stack = [{ agentBasePage: "a0" }];
  let index = 0;
  const listeners = new Map();
  const target = {
    history: {
      get state() { return stack[index]; },
      pushState(state) { stack.splice(++index); stack.push(state); },
      replaceState(state) { stack[index] = state; },
      back() { if (index > 0) { index--; target.dispatch("popstate", { state: stack[index] }); } },
      forward() { if (index < stack.length - 1) { index++; target.dispatch("popstate", { state: stack[index] }); } },
    },
    location: { pathname: "/", search: "", href: "http://localhost/", hash: "" },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name, event) { listeners.get(name)?.(event); },
  };
  return target;
}

describe("page history", () => {
  it("pushes, goes back and forward, handles popstate and ignores duplicate pages", () => {
    const target = fakeWindow();
    let page = "a0";
    const nav = createPageHistory({ current: () => page, change: (next) => { page = next; }, target });
    nav.start();
    nav.back();
    assert.equal(page, "a0");
    assert.equal(nav.canBack, false);
    assert.equal(nav.push("a0"), false);
    nav.push("agency");
    assert.equal(nav.canBack, true);
    nav.push("a0");
    nav.back();
    assert.equal(page, "agency");
    nav.back();
    assert.equal(page, "a0");
    nav.forward();
    assert.equal(page, "agency");
    nav.forward();
    assert.equal(page, "a0");
    nav.stop();
  });
  it("opens a Tasks deep link over a stale stored page and survives effect replay", () => {
    const target = fakeWindow();
    target.location.hash = "#tasks";
    let page = "a0";
    const nav = createPageHistory({ current: () => page, change: next => { page = next; }, target });
    nav.start();
    assert.equal(page, "tasks");
    assert.equal(nav.canBack, false);
    nav.stop();
    nav.start();
    assert.equal(page, "tasks");
    nav.push("agency");
    nav.back();
    assert.equal(page, "tasks");
    nav.stop();
  });

  it("adopts native Library links once and retains Back and Forward", () => {
    const target = fakeWindow();
    target.location.hash = "#library/works";
    let page = "a0";
    const nav = createPageHistory({ current: () => page, change: next => { page = next; }, target });
    nav.start();
    assert.equal(page, "library/works");
    target.history.pushState(null);
    target.location.hash = "#library/work/synthetic-work";
    target.dispatch("popstate", { state: null });
    assert.equal(page, "library/work/synthetic-work");
    assert.equal(target.history.state.agentBaseIndex, 1);
    assert.equal(nav.canBack, true);
    assert.equal(nav.push(page), false);
    target.location.hash = "#library/works";
    nav.back();
    assert.equal(page, "library/works");
    assert.equal(nav.canBack, false);
    assert.equal(nav.canForward, true);
    target.location.hash = "#library/work/synthetic-work";
    nav.forward();
    assert.equal(page, "library/work/synthetic-work");
    nav.stop();
  });

  it("rejects an invalid deep link and keeps the current page", () => {
    const target = fakeWindow();
    target.location.hash = "#invalid";
    let page = "a0";
    const nav = createPageHistory({ current: () => page, change: next => { page = next; }, decode: value => value === "tasks" ? value : null, target });
    nav.start();
    assert.equal(page, "a0");
    nav.stop();
  });

});
