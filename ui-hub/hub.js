// The UI hub app: one shell for every component. components.json lists them; each page is a Markdown log (rendered here)
// or a picture page (shown in a frame). Routes are #/<component>/<page> and #/doc/<id>; links between hub files become routes.
const $ = (s, el = document) => el.querySelector(s);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let REG = null;

// A small Markdown reader: headings, lists, tables, quotes, code, bold, italics, links. Enough for the hub's own logs.
function inline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img class="shot" src="${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => /\.(webp|png|jpe?g)$/i.test(href) ? `<a href="${href}"><img class="shot" src="${href}" alt="${txt}" loading="lazy"><small>${txt}</small></a>` : `<a href="${href}">${txt}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}
function md(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  let out = "", i = 0;
  const slug = (t) => t.toLowerCase().replace(/[^\w§ -]/g, "").trim().replace(/\s+/g, "-");
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { let code = ""; i++; while (i < lines.length && !/^```/.test(lines[i])) code += lines[i++] + "\n"; i++; out += `<pre><code>${esc(code)}</code></pre>`; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out += `<h${h[1].length} id="${slug(h[2])}">${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^---+$/.test(l.trim())) { out += "<hr>"; i++; continue; }
    if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^[|\s:-]+$/.test(r)));
      out += "<table>" + body.map((r, k) => `<tr>${cells(r).map((c) => k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + "</table>";
      continue;
    }
    if (/^>\s?/.test(l)) { let q = ""; while (i < lines.length && /^>\s?/.test(lines[i])) q += lines[i++].replace(/^>\s?/, "") + " "; out += `<blockquote>${inline(q)}</blockquote>`; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); let items = "";
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items += `<li>${inline(item)}</li>`;
      }
      out += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`; continue;
    }
    if (!l.trim()) { i++; continue; }
    let p = l; i++;
    while (i < lines.length && lines[i].trim() && !/^(#|```|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i])) p += " " + lines[i++];
    out += `<p>${inline(p)}</p>`;
  }
  return out;
}

// A hub file path → its route, so links between the logs stay inside the hub.
function routeOf(base, href) {
  if (/^(https?:|mailto:|#)/.test(href)) return null;
  const [p, frag] = href.split("#");
  const parts = (base + "/" + p).split("/").filter(Boolean), stack = [];
  for (const s of parts) s === ".." ? stack.pop() : s !== "." && stack.push(s);
  const path = stack.join("/");
  for (const d of REG.docs) if (d.file === path) return `#/doc/${d.id}${frag ? "~" + frag : ""}`;
  for (const c of REG.components) {
    if (path === c.id || path === c.id + "/") return `#/${c.id}`;
    for (const pg of c.pages) if (`${c.id}/${pg.file}` === path) return `#/${c.id}/${pg.id}${frag ? "~" + frag : ""}`;
  }
  return null;
}

function nav(active) {
  const comp = (c) => `<div class="nav__comp${active.c === c.id ? " is-open" : ""}" style="--a:${c.accent}">
    <a class="nav__name${active.c === c.id && !active.p ? " is-on" : ""}" href="#/${c.id}"><i></i>${esc(c.name)}<small>${esc(c.status)}</small></a>
    ${active.c === c.id ? c.pages.map((p) => `<a class="nav__page${active.p === p.id ? " is-on" : ""}" href="#/${c.id}/${p.id}">${esc(p.title)}</a>`).join("") : ""}
  </div>`;
  $("#nav").innerHTML = `<a class="nav__home${!active.c && !active.d ? " is-on" : ""}" href="#/">${esc(REG.hub)}</a>
    <div class="nav__label">Components</div>${REG.components.map(comp).join("")}
    <div class="nav__label">Docs</div>${REG.docs.map((d) => `<a class="nav__page nav__doc${active.d === d.id ? " is-on" : ""}" href="#/doc/${d.id}">${esc(d.title)}</a>`).join("")}`;
}

async function text(file) { const r = await fetch(file, { cache: "no-store" }); if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.text(); }

function crumbs(parts) { return `<div class="crumbs">${parts.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join("<i>/</i>")}</div>`; }

function pager(c, pi) {
  const prev = c.pages[pi - 1], next = c.pages[pi + 1];
  return `<div class="pager">${prev ? `<a href="#/${c.id}/${prev.id}">← ${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="#/${c.id}/${next.id}">${esc(next.title)} →</a>` : ""}</div>`;
}

async function showDoc(base, file, head, foot, frag) {
  const main = $("#main");
  try {
    const html = md(await text(file));
    main.innerHTML = head + `<article class="doc">${html}</article>` + foot;
    const dir = file.replace(/[^/]*$/, "");
    main.querySelectorAll("img.shot").forEach((im) => { const src = im.getAttribute("src"); if (!/^(https?:|\/)/.test(src)) im.src = dir + src; });
    main.querySelectorAll("a[href]").forEach((a) => { if (/\.(webp|png|jpe?g)$/i.test(a.getAttribute("href")) && !/^(https?:|\/)/.test(a.getAttribute("href"))) { a.href = dir + a.getAttribute("href"); a.target = "_blank"; return; } const r = routeOf(base, a.getAttribute("href")); if (r) a.setAttribute("href", r); else if (/^https?:/.test(a.href)) a.target = "_blank"; });
    if (frag) document.getElementById(frag)?.scrollIntoView();
    else main.scrollTop = 0;
  } catch (e) { main.innerHTML = head + `<p class="err">${esc(String(e.message))}</p>`; }
}

async function home() {
  nav({});
  const cards = REG.components.map((c) => `<a class="card" href="#/${c.id}" style="--a:${c.accent}"><b>${esc(c.name)}</b><span class="card__status">${esc(c.status)}</span><small>${esc(c.summary)}</small><em>${c.pages.length} pages</em></a>`).join("");
  $("#main").innerHTML = `<header class="hero"><h1>${esc(REG.hub)}</h1><p>One place per component: what it's for in Shaan's words, its pictures, and its feedback, reasoning, ideas and improvements logs. Pick a component up here and you don't have to work any of it out again.</p></header>
    <h2 class="sec">Components</h2><div class="cards">${cards}</div>
    <h2 class="sec">Start here</h2><div class="cards">${REG.docs.map((d) => `<a class="card" href="#/doc/${d.id}"><b>${esc(d.title)}</b><small>${d.id === "vision" ? "Where the bar fits, real use cases, what we're missing, what to build next." : "The folder layout, the loop, and how to add a component."}</small></a>`).join("")}</div>`;
}

async function component(c) {
  nav({ c: c.id });
  const tiles = c.pages.map((p) => `<a class="tile" href="#/${c.id}/${p.id}"><b>${esc(p.title)}</b><small>${p.kind === "frame" ? "pictures" : esc(p.file)}</small></a>`).join("");
  $("#main").innerHTML = crumbs([["Hub", "#/"], [c.name]]) + `<header class="hero" style="--a:${c.accent}"><h1>${esc(c.name)}</h1><p>${esc(c.summary)}</p>${c.for ? `<p class="for">What it's for: ${esc(c.for)}</p>` : ""}<span class="pill">${esc(c.status)}</span></header><div class="tiles">${tiles}</div><div id="peek"></div>`;
  const readme = c.pages.find((p) => p.id === "readme");
  if (readme) { try { $("#peek").innerHTML = `<article class="doc">${md(await text(`${c.id}/${readme.file}`))}</article>`; $("#peek").querySelectorAll("a[href]").forEach((a) => { const r = routeOf(c.id, a.getAttribute("href")); if (r) a.setAttribute("href", r); }); } catch {} }
}

async function page(c, pid, frag) {
  const pi = c.pages.findIndex((p) => p.id === pid), p = c.pages[pi];
  if (!p) return component(c);
  nav({ c: c.id, p: pid });
  const head = crumbs([["Hub", "#/"], [c.name, `#/${c.id}`], [p.title]]);
  if (p.kind === "gallery") {
    // Every picture in a folder (the server's own listing), named NN-what-viewport.webp, as a grid; click opens it full size.
    const dir = `${c.id}/${p.file}`;
    try {
      const names = [...(await text(dir)).matchAll(/href="([^"]+\.(?:webp|png|jpe?g))"/gi)].map((m) => decodeURIComponent(m[1])).sort();
      const cap = (n) => n.replace(/\.\w+$/, "").replace(/^\d+[-_]/, "").replace(/[-_]/g, " ");
      const src = (n) => `${dir}${encodeURIComponent(n)}`;
      // Shaan 4 Oct: "be nice if i could actually see the images a bit easier". A before and its after (same name with
      // before/after swapped) sit side by side, big; anything unpaired follows in the grid. Click opens it full screen.
      const key = (n) => n.replace(/^\d+[-_]/, "").replace(/(^|[-_])(before|after)(-pass\d+)?(?=[-_.])/i, "$1~").replace(/\.\w+$/, "");
      const befores = names.filter((n) => /(^|[-_])before([-_.])/i.test(n));
      const afters = names.filter((n) => /(^|[-_])after([-_.])/i.test(n) && !/after-pass\d/i.test(n));
      const used = new Set(), pairs = [];
      for (const b of befores) { const a = afters.find((x) => key(x) === key(b) && !used.has(x)); if (a) { used.add(a); used.add(b); pairs.push([b, a]); } }
      const rest = names.filter((n) => !used.has(n));
      const fig = (n, tag) => `<figure><button type="button" class="lb-open" data-src="${src(n)}"><img src="${src(n)}" loading="lazy" alt=""></button><figcaption>${tag ? `<b>${tag}</b> ` : ""}${esc(cap(n))}</figcaption></figure>`;
      $("#main").innerHTML = head + (pairs.length ? `<div class="pairs">${pairs.map(([b, a]) => `<section class="pair">${fig(b, "Before")}${fig(a, "After")}</section>`).join("")}</div>` : "")
        + (rest.length ? `<h3 class="sec">${pairs.length ? "More" : ""}</h3><div class="gallery">${rest.map((n) => fig(n)).join("")}</div>` : "") + pager(c, pi);
      const all = [...$("#main").querySelectorAll(".lb-open")];
      all.forEach((b, i) => b.addEventListener("click", () => lightbox(all.map((x) => x.dataset.src), i)));
    } catch (e) { $("#main").innerHTML = head + `<p class="err">${esc(String(e.message))}</p>`; }
    return;
  }
  if (p.kind === "frame") {
    $("#main").innerHTML = head + `<iframe class="frame" src="${c.id}/${p.file}" title="${esc(p.title)}"></iframe>` + pager(c, pi);
    return;
  }
  return showDoc(c.id, `${c.id}/${p.file}`, head, pager(c, pi), frag);
}

function lightbox(list, i) {
  const box = document.createElement("div");
  box.className = "lb";
  const show = () => { box.innerHTML = `<img src="${list[i]}" alt=""><span class="lb__n">${i + 1} / ${list.length} · ← → · Esc</span>`; };
  const key = (e) => { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") { i = (i + 1) % list.length; show(); } else if (e.key === "ArrowLeft") { i = (i - 1 + list.length) % list.length; show(); } };
  const close = () => { box.remove(); window.removeEventListener("keydown", key); };
  box.addEventListener("click", close);
  window.addEventListener("keydown", key);
  show(); document.body.append(box);
}

async function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [path, frag] = h.split("~");
  const [a, b] = path.split("/").filter(Boolean);
  if (!a) return home();
  if (a === "doc") { const d = REG.docs.find((x) => x.id === b); nav({ d: b }); return d ? showDoc("", d.file, crumbs([["Hub", "#/"], [d.title]]), "", frag) : home(); }
  const c = REG.components.find((x) => x.id === a);
  if (!c) return home();
  return b ? page(c, b, frag) : component(c);
}

(async () => {
  REG = JSON.parse(await text("components.json"));
  window.addEventListener("hashchange", route);
  route();
})();
