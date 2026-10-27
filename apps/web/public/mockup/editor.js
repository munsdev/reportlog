/* On-page block editor preview. One data model, one renderer, 20-step undo.
   Mirrors packages/contracts/src/pages.ts: block = { id, type, variant, fields, shown }. */
(function () {
  var TYPES = {
    hero:  { name: "Headline", variants: { poster: "Poster: huge headline, slogan bar", action: "Action: headline and big buttons", info: "Info: headline, longer introduction" } },
    text:  { name: "Text", variants: { plain: "Plain", callout: "Callout box" } },
    steps: { name: "Steps", variants: { steps: "Numbered" } },
    cards: { name: "Cards", variants: { cards: "Row of cards" } },
    cta:   { name: "Call to action", variants: { cta: "Box with a button" } },
    live:  { name: "Live part", variants: { live: "Live" } }
  };
  var LIVE = { buttons: "The big buttons", figures: "The figures", map: "The map", check: "Check a report", links: "More you can do", social: "Follow us elsewhere" };

  /* Destinations: what a button may point to. The server lists these; the
     editor never asks for a raw address unless the kind is "web". */
  var DEST = [
    { group: "Logbooks", items: [["logbook:election-day", "Election day reports"], ["logbook:checkin", "It went fine (check-in)", "closed until Nov 3"]] },
    { group: "Lists", items: [["list:tips", "Tip line"], ["list:volunteer", "Volunteer form"]] },
    { group: "Maps", items: [["map:states", "Reports by state"]] },
    { group: "Pages", items: [["page:about", "About"], ["page:get-involved", "Get involved"], ["page:journalists", "For journalists"], ["page:how", "How it works"], ["page:verify", "Check a report"]] },
    { group: "Other", items: [["web", "A web address"]] }
  ];
  function destLabel(v) { for (var g of DEST) for (var i of g.items) if (i[0] === v) return i[1]; return v; }
  function destWhy(v) { for (var g of DEST) for (var i of g.items) if (i[0] === v) return i[2] || null; return null; }

  var state = [
    { id: "b1", type: "hero", variant: "poster", shown: true, fields: { eyebrow: "2026 US midterms · Tuesday, November 3", headline: "See it?", headline2: "Log it!", slogan: "The world is watching.", lede: "Most of what goes wrong on election day never gets written down. Tap a few answers and it's on the record. A volunteer reads every report before anything goes public.", buttons: [{ label: "File a report", to: "logbook:election-day" }, { label: "What is this?", to: "page:about" }], who: "Nonpartisan · Run by Americans living in Europe" } },
    { id: "b2", type: "cta", variant: "cta", shown: true, fields: { mark: "Before you start", heading: "If someone needs help right now", text: "This is a record, not an emergency line. If you or someone else is in danger, call your local emergency number.", button: { label: "", to: "" } } },
    { id: "b3", type: "steps", variant: "steps", shown: true, fields: { heading: "How it works", items: [{ title: "You tap, you don't type", line: "Pick from a short list of answers. About two minutes on a phone." }, { title: "A person reads every report", line: "A volunteer moderator reads it before anything is public." }, { title: "It stays on the record", line: "Once filed, nobody can quietly change it or delete it. Not even us." }] } },
    { id: "b4", type: "live", variant: "live", shown: true, fields: { module: "figures" } },
    { id: "b5", type: "text", variant: "plain", shown: true, fields: { heading: "Who's behind it", body: "ElectionLog is run by a group of Americans living abroad, most of them in Europe, as a private, nonpartisan project. Nobody is paid, nothing is sold, and the servers are in Germany. [More about the project](/about)" } },
    { id: "b6", type: "cards", variant: "cards", shown: true, fields: { heading: "Get involved", items: [{ title: "Moderate reports", line: "Read incoming reports and approve the ones that meet the standard.", to: "list:volunteer", label: "Volunteer" }, { title: "Bring your group", line: "Observers in your organization file through their own link.", to: "list:volunteer", label: "Get a link" }, { title: "Spread the word", line: "Post the link, print the card, tell people who vote in person.", to: "page:get-involved", label: "Copy a post" }] } },
    { id: "b7", type: "live", variant: "live", shown: false, fields: { module: "map" } }
  ];
  var undo = [];
  function snapshot() { undo.push(JSON.stringify(state)); if (undo.length > 20) undo.shift(); document.getElementById("undo").disabled = false; }
  document.getElementById("undo").addEventListener("click", function () { if (!undo.length) return; state = JSON.parse(undo.pop()); this.disabled = !undo.length; render(); say("Undone"); });
  document.getElementById("done").addEventListener("click", function () { say("Saved. The page is live."); });

  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function md(s) { /* the tiny subset: paragraphs, ## headings, **bold**, [links](path) */
    return String(s || "").split(/\n\s*\n/).map(function (p) {
      p = esc(p.trim());
      if (p.indexOf("## ") === 0) return "<h3>" + p.slice(3) + "</h3>";
      p = p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, function (_, t, u) { return '<a href="' + u + '"' + (u[0] === "/" ? "" : ' target="_blank" rel="noopener"') + ">" + t + "</a>"; });
      return "<p>" + p + "</p>";
    }).join("");
  }
  function href(to) { return to && to !== "web" ? "#" + to : "#"; }
  function problem(b) {
    if (b.type === "hero" && !b.fields.headline) return true;
    if (b.type === "cta" && !b.fields.heading) return true;
    if (b.type === "text" && !b.fields.body) return true;
    return false;
  }

  function renderBlock(b) {
    var f = b.fields;
    if (b.type === "hero") {
      var btns = (f.buttons || []).filter(function (x) { return x.label && x.to; }).map(function (x, i) { return '<a class="btn ' + (i ? "ghost" : "go") + ' lg" href="' + href(x.to) + '">' + esc(x.label) + "</a>"; }).join("");
      if (b.variant === "poster") return '<section class="hero motif-host"><div class="ov" data-slot="hero"></div><div class="wrap"><span class="eyebrow">' + esc(f.eyebrow) + '</span><h1 class="display">' + esc(f.headline) + '<br><span class="two">' + esc(f.headline2) + "</span></h1>" + (f.slogan ? '<p class="tagline">' + esc(f.slogan) + "</p>" : "") + '<p class="lede">' + esc(f.lede) + '</p><div class="btn-row">' + btns + '</div><p class="who">' + esc(f.who) + "</p></div></section>";
      if (b.variant === "action") return '<section class="hero"><div class="wrap"><span class="eyebrow">' + esc(f.eyebrow) + '</span><h1 class="h-band">' + esc(f.headline) + " " + esc(f.headline2) + '</h1><p class="lede">' + esc(f.lede) + '</p><div class="btn-row">' + btns + "</div></div></section>";
      return '<section class="hero"><div class="wrap"><span class="eyebrow">' + esc(f.eyebrow) + '</span><h1 class="h-page">' + esc(f.headline) + " " + esc(f.headline2) + '</h1><div class="prose">' + md(f.lede) + '</div><div class="btn-row">' + btns.replace(/btn (go|ghost) lg/g, "btn sm flat") + "</div></div></section>";
    }
    if (b.type === "cta") {
      var btn = f.button && f.button.label && f.button.to ? '<a class="btn sm flat" href="' + href(f.button.to) + '">' + esc(f.button.label) + "</a>" : "";
      return '<div class="wrap"><section class="section"><div class="cta urgent"><span class="mark">' + esc(f.mark) + "</span><h3>" + esc(f.heading) + "</h3><p>" + esc(f.text) + "</p>" + btn + "</div></section></div>";
    }
    if (b.type === "steps") return '<div class="wrap"><section class="section"><div class="sec-head"><span class="num">' + num(b) + "</span><h2>" + esc(f.heading) + '</h2></div><ol class="steps">' + f.items.map(function (i) { return "<li><span><b>" + esc(i.title) + "</b>" + esc(i.line) + "</span></li>"; }).join("") + "</ol></section></div>";
    if (b.type === "cards") return '<div class="wrap"><section class="section"><div class="sec-head"><span class="num">' + num(b) + "</span><h2>" + esc(f.heading) + '</h2></div><div class="cards">' + f.items.map(function (i) { return '<div class="card"><h3>' + esc(i.title) + "</h3><p>" + esc(i.line) + "</p>" + (i.label && i.to ? '<a class="btn sm flat" href="' + href(i.to) + '">' + esc(i.label) + "</a>" : "") + "</div>"; }).join("") + "</div></section></div>";
    if (b.type === "text") {
      var inner = '<div class="sec-head"><span class="num">' + num(b) + "</span><h2>" + esc(f.heading) + '</h2></div><div class="prose">' + md(f.body) + "</div>";
      return '<div class="wrap"><section class="section">' + (b.variant === "callout" ? '<div class="cta">' + inner + "</div>" : inner) + "</section></div>";
    }
    if (b.type === "live") {
      var m = f.module, body;
      if (m === "figures") body = '<div class="figures"><span class="figure">1,284<small>published</small></span><span class="figure">41<small>states</small></span><span class="figure">96<small>today</small></span></div>';
      else if (m === "map") body = '<p class="muted">Shown only once there are published reports. Today: hidden on the public page, visible here so you can place it.</p>';
      else if (m === "buttons") body = '<div class="btn-row"><a class="btn" href="#list:tips">Send a tip</a><a class="btn" href="#page:journalists">Get alerts</a></div><p class="muted" style="font-size:.85rem;margin-top:8px">The rows come from Settings › Front-page buttons.</p>';
      else if (m === "check") body = '<div class="search" style="max-width:420px"><input type="text" placeholder="RL-XXXX-XX" aria-label="Reference"><span class="btn sm flat">Check</span></div>';
      else if (m === "social") body = '<p class="muted">The icons from Settings › Social media.</p>';
      else body = '<p class="muted">Links to the check-in, the tip line and alerts.</p>';
      return '<div class="wrap"><section class="section"><div class="sec-head"><span class="num">' + num(b) + "</span><h2>" + LIVE[m] + "</h2></div>" + body + "</section></div>";
    }
    return "";
  }
  function num(b) { var n = 0; for (var x of state) { if (x.type !== "hero" && x.type !== "cta" && x.shown) n++; if (x === b) break; } return (n < 10 ? "0" : "") + n; }

  function render() {
    var host = document.getElementById("page"); host.innerHTML = "";
    state.forEach(function (b, i) {
      host.appendChild(addBtn(i));
      var w = document.createElement("div");
      w.className = "blk" + (b.shown ? "" : " hidden-blk") + (problem(b) ? " problem" : "");
      var vs = Object.keys(TYPES[b.type].variants);
      var vsel = vs.length > 1 ? '<label class="tb sel"><span class="vh">Layout</span><select data-act="variant">' + vs.map(function (v) { return '<option value="' + v + '"' + (v === b.variant ? " selected" : "") + ">" + TYPES[b.type].variants[v] + "</option>"; }).join("") + "</select></label>" : "";
      var badge = !b.shown ? '<span class="blk-badge">Hidden from the public</span>' : problem(b) ? '<span class="blk-badge bad">Not shown: needs a headline</span>' : "";
      w.innerHTML = '<div class="wrap"><div class="blk-bar"><div class="blk-title"><span class="name">' + TYPES[b.type].name + (b.type === "live" ? ": " + LIVE[b.fields.module] : "") + "</span>" + badge + '</div><div class="blk-tools">' +
        '<button class="tb" data-act="edit">Edit</button><button class="tb" data-act="up" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>&uarr;</button><button class="tb" data-act="down" aria-label="Move down"' + (i === state.length - 1 ? " disabled" : "") + '>&darr;</button><button class="tb" data-act="hide">' + (b.shown ? "Hide" : "Show") + '</button><button class="tb" data-act="del">Delete</button>' + vsel + '</div></div></div>' +
        '<div class="blk-body">' + renderBlock(b) + "</div>";
      w.querySelectorAll("[data-act]").forEach(function (c) {
        var act = c.dataset.act;
        if (act === "variant") c.addEventListener("change", function () { snapshot(); b.variant = c.value; render(); });
        else c.addEventListener("click", function () {
          if (act === "edit") return openSheet(b);
          snapshot();
          if (act === "up") { state.splice(i, 1); state.splice(i - 1, 0, b); }
          if (act === "down") { state.splice(i, 1); state.splice(i + 1, 0, b); }
          if (act === "hide") b.shown = !b.shown;
          if (act === "del") { state.splice(i, 1); say("Block deleted. Undo is in the bar at the top."); }
          render();
        });
      });
      host.appendChild(w);
    });
    host.appendChild(addBtn(state.length));
    if (window.elDrawOverlays) window.elDrawOverlays();
  }
  function addBtn(at) {
    var d = document.createElement("div"); d.className = "addblk";
    d.innerHTML = '<button type="button">+ Add block</button>';
    d.firstChild.addEventListener("click", function () { openAdd(at); });
    return d;
  }

  /* ---------- sheet ---------- */
  var sheet = document.getElementById("sheet"), scrim = document.getElementById("scrim"), sin = document.getElementById("sheet-in"), lastFocus;
  function closeSheet() { sheet.removeAttribute("open"); scrim.removeAttribute("open"); if (lastFocus) lastFocus.focus(); }
  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheet.hasAttribute("open")) closeSheet(); });
  function show(html, onSave) {
    lastFocus = document.activeElement;
    sin.innerHTML = html;
    sheet.setAttribute("open", ""); scrim.setAttribute("open", "");
    var first = sin.querySelector("input,select,textarea,button"); if (first) first.focus();
    var cancel = sin.querySelector("[data-cancel]"), save = sin.querySelector("[data-save]");
    if (cancel) cancel.addEventListener("click", closeSheet);
    if (save) save.addEventListener("click", function () { onSave(); closeSheet(); render(); say("Saved"); });
    var ob = sin.querySelector("[data-open-bg]"); if (ob) ob.addEventListener("click", function () { closeSheet(); if (window.elOpenLook) window.elOpenLook(true); });
    sin.querySelectorAll("[data-del-item]").forEach(function (x) { x.addEventListener("click", function () { x.closest(".item").remove(); }); });
    sin.querySelectorAll("[data-add-item]").forEach(function (x) { x.addEventListener("click", function () { var tpl = x.previousElementSibling.lastElementChild; var n = tpl.cloneNode(true); n.querySelectorAll("input").forEach(function (i) { i.value = ""; }); x.previousElementSibling.appendChild(n); n.querySelector("[data-del-item]").addEventListener("click", function () { n.remove(); }); n.querySelector("input").focus(); }); });
  }
  function fld(label, name, val, help, kind) {
    var id = "f-" + name;
    var ctl = kind === "area" ? '<textarea class="textarea" id="' + id + '" name="' + name + '">' + esc(val) + "</textarea>" : '<input class="input" id="' + id + '" name="' + name + '" value="' + esc(val) + '">';
    return '<div class="field"><label for="' + id + '">' + label + "</label>" + ctl + (help ? '<span class="help">' + help + "</span>" : "") + "</div>";
  }
  function destField(label, name, val) {
    var why = destWhy(val);
    return '<div class="field dest"><label for="f-' + name + '">' + label + '</label><select class="sel" id="f-' + name + '" name="' + name + '"><option value="">Nowhere (hides the button)</option>' +
      DEST.map(function (g) { return '<optgroup label="' + g.group + '">' + g.items.map(function (i) { return '<option value="' + i[0] + '"' + (i[0] === val ? " selected" : "") + ">" + i[1] + (i[2] ? " (" + i[2] + ")" : "") + "</option>"; }).join("") + "</optgroup>"; }).join("") +
      "</select>" + (why ? '<span class="why">This target is ' + why + '. The button stays hidden until it opens.</span>' : '<span class="help">Pick what the button leads to. Addresses and names come from the target itself.</span>') + "</div>";
  }
  function btnFields(prefix, b, allowWeb) {
    return destField("Leads to", prefix + "-to", b.to) + fld("Button text", prefix + "-label", b.label, "Leave empty to use the target's own name.") + (allowWeb ? '<div class="field" data-web><label for="f-' + prefix + '-url">Web address (only when "A web address" is chosen)</label><input class="input" id="f-' + prefix + '-url" name="' + prefix + '-url" value="' + esc(b.url || "") + '" placeholder="https://"></div>' : "");
  }
  function v(name) { var e = sin.querySelector('[name="' + name + '"]'); return e ? e.value.trim() : ""; }

  function openSheet(b) {
    var f = b.fields, html = '<div class="sheet-head"><h2 id="sheet-title">' + TYPES[b.type].name + "</h2><button class=\"tb\" type=\"button\" data-cancel>Close</button></div>";
    if (b.type === "hero") html += fld("Small line above", "eyebrow", f.eyebrow) + fld("Headline, first line", "headline", f.headline) + fld("Headline, second line", "headline2", f.headline2, "Drawn in outline in the Poster layout.") + fld("Slogan", "slogan", f.slogan, "Shown as a bar under the headline. Empty hides it.") + fld("Introduction", "lede", f.lede, "Markdown: paragraphs, **bold**, [links](/page).", "area") + "<h3 class=\"lbl\">Main button</h3>" + btnFields("b0", f.buttons[0] || {}, true) + "<h3 class=\"lbl\">Second button</h3>" + btnFields("b1", f.buttons[1] || {}, true) + fld("Line under the buttons", "who", f.who) + '<div class="field"><span class="lbl">Background</span><button class="btn sm flat" type="button" data-open-bg>Edit header background</button><span class="help">Elements, image, fade. Applies to every page header.</span></div>';
    else if (b.type === "cta") html += fld("Small line above", "mark", f.mark) + fld("Heading", "heading", f.heading) + fld("Text", "text", f.text, "Saved empty, the box switches off everywhere.", "area") + "<h3 class=\"lbl\">Optional button</h3>" + btnFields("cb", f.button || {}, true);
    else if (b.type === "text") html += fld("Heading", "heading", f.heading) + fld("Body", "body", f.body, "Markdown: paragraphs, ## headings, **bold**, [links](/page). No HTML.", "area");
    else if (b.type === "steps" || b.type === "cards") {
      html += fld("Heading", "heading", f.heading) + '<div class="field"><span class="lbl">' + (b.type === "steps" ? "Steps (2 to 5)" : "Cards") + '</span><div class="items">' + f.items.map(function (i) { return '<div class="item"><input class="input" placeholder="Title" value="' + esc(i.title) + '" data-k="title"><input class="input" placeholder="One line" value="' + esc(i.line) + '" data-k="line">' + (b.type === "cards" ? destSmall(i.to) + '<input class="input" placeholder="Button text" value="' + esc(i.label || "") + '" data-k="label">' : "") + '<div class="row"><button class="tb" type="button" data-del-item>Remove</button></div></div>'; }).join("") + '</div><button class="tb" type="button" data-add-item>+ Add</button></div>';
    } else if (b.type === "live") html += '<div class="field"><label for="f-module">Which part</label><select class="sel" id="f-module" name="module">' + Object.keys(LIVE).map(function (k) { return '<option value="' + k + '"' + (k === f.module ? " selected" : "") + ">" + LIVE[k] + "</option>"; }).join("") + '</select><span class="help">Live parts fetch their own data. The map and the figures hide themselves while there is nothing to show.</span></div>';
    html += '<div class="btn-row"><button class="btn sm flat" type="button" data-cancel>Cancel</button><button class="btn sm flat go" type="button" data-save>Save</button></div>';
    show(html, function () {
      snapshot();
      if (b.type === "hero") { f.eyebrow = v("eyebrow"); f.headline = v("headline"); f.headline2 = v("headline2"); f.slogan = v("slogan"); f.lede = v("lede"); f.who = v("who"); f.buttons = [{ label: v("b0-label"), to: v("b0-to"), url: v("b0-url") }, { label: v("b1-label"), to: v("b1-to"), url: v("b1-url") }]; }
      else if (b.type === "cta") { f.mark = v("mark"); f.heading = v("heading"); f.text = v("text"); f.button = { label: v("cb-label"), to: v("cb-to"), url: v("cb-url") }; }
      else if (b.type === "text") { f.heading = v("heading"); f.body = v("body"); }
      else if (b.type === "live") { f.module = v("module"); }
      else { f.heading = v("heading"); f.items = Array.from(sin.querySelectorAll(".item")).map(function (it) { var o = {}; it.querySelectorAll("[data-k]").forEach(function (c) { o[c.dataset.k] = c.value.trim(); }); return o; }).filter(function (o) { return o.title; }).slice(0, b.type === "steps" ? 5 : 12); }
    });
  }
  function destSmall(val) { return '<select class="sel" data-k="to" aria-label="Leads to"><option value="">Nowhere</option>' + DEST.map(function (g) { return '<optgroup label="' + g.group + '">' + g.items.map(function (i) { return '<option value="' + i[0] + '"' + (i[0] === val ? " selected" : "") + ">" + i[1] + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select>"; }

  function openAdd(at) {
    var html = '<div class="sheet-head"><h2 id="sheet-title">Add a block</h2><button class="tb" type="button" data-cancel>Close</button></div><div class="choices">' + Object.keys(TYPES).map(function (t) { return '<label class="choice"><input type="radio" name="nt" value="' + t + '"' + (t === "text" ? " checked" : "") + '><span class="dot" aria-hidden="true"></span>' + TYPES[t].name + "</label>"; }).join("") + '</div><div class="btn-row"><button class="btn sm flat" type="button" data-cancel>Cancel</button><button class="btn sm flat go" type="button" data-save>Add</button></div>';
    show(html, function () {
      snapshot();
      var t = sin.querySelector('[name="nt"]:checked').value, b = { id: "b" + Date.now(), type: t, variant: Object.keys(TYPES[t].variants)[0], shown: true, fields: {} };
      if (t === "hero") b.fields = { eyebrow: "", headline: "", headline2: "", slogan: "", lede: "", buttons: [], who: "" };
      if (t === "text") b.fields = { heading: "New section", body: "" };
      if (t === "steps") b.fields = { heading: "Steps", items: [{ title: "First", line: "" }, { title: "Second", line: "" }] };
      if (t === "cards") b.fields = { heading: "Cards", items: [{ title: "A card", line: "", to: "", label: "" }] };
      if (t === "cta") b.fields = { mark: "", heading: "", text: "", button: {} };
      if (t === "live") b.fields = { module: "check" };
      state.splice(at, 0, b);
      setTimeout(function () { openSheet(b); }, 50);
    });
  }

  function say(m) { if (window.elSay) window.elSay(m); }
  document.addEventListener("DOMContentLoaded", render);
})();
