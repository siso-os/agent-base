// The ad blocker's converter (browser v3): only host rules WebKit can say exactly, blocks before exceptions.
import test from "node:test";
import assert from "node:assert/strict";
import { convert, convertLine } from "../src/adblock.ts";

test("a host rule blocks that host and its subdomains", () => {
  const r = convertLine("||doubleclick.net^");
  assert.equal(r.action.type, "block");
  const re = new RegExp(r.trigger["url-filter"], "i");
  for (const u of ["https://doubleclick.net/x", "https://ad.g.doubleclick.net/pagead", "http://doubleclick.net:8080/"]) assert.ok(re.test(u), u);
  for (const u of ["https://notdoubleclick.net/", "https://example.com/doubleclick.net/", "https://doubleclick.network/"]) assert.ok(!re.test(u), u);
});
test("options WebKit can say are kept; the rest drop the rule", () => {
  const r = convertLine("||ads.example.com^$script,third-party,domain=a.com|b.org");
  assert.deepEqual(r.trigger["resource-type"], ["script"]);
  assert.deepEqual(r.trigger["load-type"], ["third-party"]);
  assert.deepEqual(r.trigger["if-domain"], ["*a.com", "*b.org"]);
  for (const line of ["||x.com^$popup", "||x.com^$redirect=noop.js", "||x.com^$~script", "||x.com^$domain=a.com|~b.com", "||x.com^|", "/banner/*", "##.ad", "example.com##.ad", "! comment", "[Adblock Plus 2.0]", "||x.com^$csp=script-src 'none'"])
    assert.equal(convertLine(line), null, line);
});
test("exceptions come after every block", () => {
  const rules = convert(["@@||ok.example.com^\n||ads.com^\n||ads.com^\n||track.io^$image", "||more.net^"]);
  assert.deepEqual(rules.map((r) => r.action.type), ["block", "block", "block", "ignore-previous-rules"]);
  assert.equal(rules.length, 4, "duplicates kept once");
});
