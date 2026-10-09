// tools/ab-live never moves live backwards by accident: a sha that does not descend from apps/web/dist/DEPLOYED_SHA is
// refused (exit 4) unless --rollback is passed. A throwaway checkout, web-only changes and a fake build (AB_LIVE_BUILD), so
// no app, mini, port or network is touched.
//   node --test tools/test/ab-live-rollback.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LIVE = path.join(import.meta.dirname, "..", "ab-live");
const env0 = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: env0, encoding: "utf8" }).trim();

function checkout() {
  const root = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-ab-live-rollback."));
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "apps/web/src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(path.join(repo, ".gitignore"), "apps/web/dist/\n");
  const commit = (n) => {
    writeFileSync(path.join(repo, "apps/web/src/page.ts"), `export const n = ${n};\n`);
    git(repo, "add", ".gitignore", "apps/web/src/page.ts");
    git(repo, "commit", "-q", "-m", `web ${n}`);
    return git(repo, "rev-parse", "HEAD");
  };
  const a = commit(1), b = commit(2), d = commit(3);
  git(repo, "checkout", "-q", "-b", "side", a);
  const c = commit(4);
  git(repo, "checkout", "-q", "main");
  mkdirSync(path.join(repo, "apps/web/dist"), { recursive: true });
  return { root, repo, a, b, c, d };
}

function live(t, args, deployed) {
  writeFileSync(path.join(t.repo, "apps/web/dist/DEPLOYED_SHA"), `${deployed}\n`);
  const r = spawnSync(LIVE, args, {
    encoding: "utf8",
    env: {
      ...env0,
      AB_LIVE_CHECKOUT: t.repo,
      AB_LIVE_STATE: path.join(t.root, "state"), AB_LIVE_WORKTREES: path.join(t.root, "worktrees"),
      AB_LIVE_BUILD: "mkdir -p apps/web/dist && echo ok > apps/web/dist/index.html",
      AB_LIVE_SKIP_RAM: "1",
      AB_MINI: path.join(t.root, "no-mini"),
      AB_LIVE_INSTALLED_APP: path.join(t.root, "no.app"),
      AB_LIVE_QUIT: "true",
      AB_LIVE_OPEN: "true",
      AB_LIVE_PORT: "1",
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, now: readFileSync(path.join(t.repo, "apps/web/dist/DEPLOYED_SHA"), "utf8").trim() };
}

test("a descendant of the live sha goes live", () => {
  const t = checkout();
  try {
    const r = live(t, [t.d], t.b);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.now, t.d);
    assert.equal(git(t.repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1, "clean build worktree retired without forced removal");
    const archive=path.join(t.root,'state/_archive');
    const first=readdirSync(archive)[0];
    const previous=readFileSync(path.join(archive,first,'dist/DEPLOYED_SHA'),'utf8');
    assert.equal(previous.trim(),t.b);
    assert.equal(live(t,[t.d],t.b).code,0);
    assert.equal(readdirSync(archive).length,2,'each deployment keeps its rollback artifacts');
    assert.equal(readFileSync(path.join(archive,first,'dist/DEPLOYED_SHA'),'utf8'),previous,'earlier recovery stays intact');
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("a sha that does not descend from live is refused and nothing changes", () => {
  const t = checkout();
  try {
    for (const sha of [t.a, t.c]) {
      const r = live(t, [sha], t.d);
      assert.equal(r.code, 4, r.out);
      assert.match(r.out, /refused: .* does not descend from the live .*--rollback/);
      assert.equal(r.now, t.d, "DEPLOYED_SHA untouched");
    }
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("--rollback moves live back on purpose", () => {
  const t = checkout();
  try {
    const r = live(t, ["--rollback", t.a], t.d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /--rollback: moving live/);
    assert.equal(r.now, t.a);
    assert.equal(git(t.repo, "rev-parse", "refs/live"), t.a, "mark() records the rollback too");
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

// 3 Oct: with the mini offline, ab-mini builds here, so the dist is already in the build worktree; copying it back from
// the mini failed every deploy from 15:3x. A fake ab-mini that builds locally (and an ssh that cannot reach the mini)
// must still go live.
test("an ab-mini build that ran on this machine goes live without copying from the mini", () => {
  const t = checkout();
  try {
    const mini = path.join(t.root, "ab-mini-local");
    writeFileSync(mini, "#!/bin/bash\nmkdir -p apps/web/dist && echo ok > apps/web/dist/index.html\n", { mode: 0o755 });
    writeFileSync(path.join(t.repo, "apps/web/dist/DEPLOYED_SHA"), `${t.b}\n`);
    const r = spawnSync(LIVE, [t.d], {
      encoding: "utf8",
      env: {
        ...env0,
        AB_LIVE_CHECKOUT: t.repo, AB_LIVE_STATE: path.join(t.root, "state"), AB_LIVE_WORKTREES: path.join(t.root, "worktrees"), AB_LIVE_SKIP_RAM: "1", AB_MINI: mini,
        AB_LIVE_INSTALLED_APP: path.join(t.root, "no.app"), AB_LIVE_QUIT: "true", AB_LIVE_OPEN: "true", AB_LIVE_PORT: "1",
      },
    });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(readFileSync(path.join(t.repo, "apps/web/dist/DEPLOYED_SHA"), "utf8").trim(), t.d);
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});
