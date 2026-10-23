/* Fantasy B1G admin -- only works when served by `python tools/admin.py`. */
(function () {
  "use strict";

  var TOKEN = document.querySelector('meta[name="admin-token"]').content;
  var S = null, ROSTERS = [], BY_NAME = {}, DRAFT_KIND = "season", BALLOT_YEAR = null;
  var TAB = (location.hash.replace("#", "") || "draft");  // remembered across reloads
  var el = document.getElementById("admin");

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(name) {
    var s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-/g, " ");
    return s.replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
  }
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast on" + (err ? " err" : "");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = "toast" + (err ? " err" : ""); }, err ? 4000 : 1400);
  }
  function api(path, body) {
    var opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN }, body: JSON.stringify(body) };
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || r.statusText);
        return j;
      });
    });
  }
  function todayET() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function sw(m) { return '<span class="sw" style="background:var(--m-' + m + ')"></span>'; }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? " selected" : "") + ">" + esc(label == null ? v : label) + "</option>"; }
  function card(title, body, right) {
    return '<section class="card"><div class="card-head"><h2>' + title + "</h2>" + (right || "") + "</div>" + body + "</section>";
  }
  function yearsText(ys) { return ys && ys.length ? (ys[0] === ys[ys.length - 1] ? String(ys[0]) : ys[0] + "-" + ys[ys.length - 1]) : ""; }

  // ------------------------------------------------------------ league helpers
  function cfg() { return S.cfg; }
  function team(m) { return cfg().teams[m]; }
  function rosterHit(name) { return BY_NAME[norm(name)]; }
  function schoolOf(name, mm) {
    var c = mm ? S.mm : cfg();
    var info = (c && c.players && c.players[name]) || (cfg().players || {})[name];
    if (info && info.school) return info.school;
    var hit = rosterHit(name);
    return hit ? hit.school : null;
  }
  // remember school/id for a newly typed player (what update.py would look up)
  function registerPlayer(name, mm) {
    if (!name) return;
    var c = mm ? S.mm : cfg();
    c.players = c.players || {};
    if (c.players[name] && c.players[name].school) return;
    var hit = rosterHit(name);
    if (hit) c.players[name] = { school: hit.school, id: hit.id };
  }
  function currentRoster(m) {
    var names = team(m).draft.slice();
    (team(m).pickups || []).slice().sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); }).forEach(function (p) {
      var i = names.indexOf(p.drop);
      if (i >= 0) names[i] = p.add;
    });
    return names.filter(Boolean);
  }
  function everRostered() {
    var out = [];
    S.managers.forEach(function (m) {
      team(m).draft.concat((team(m).pickups || []).map(function (p) { return p.add; })).forEach(function (n) {
        if (n && out.indexOf(n) < 0) out.push(n);
      });
    });
    return out.sort();
  }
  function nextGame(m) { var t = S.progress.teams[m]; return t ? t.nextGame : 1; }

  var saveTimer = null;
  function saveCfg(msg) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      api("/api/save-config", { cfg: S.cfg, mm: S.mm }).then(function () { toast(msg || "Saved"); refreshStatus(); })
        .catch(function (e) { toast("Save failed: " + e.message, true); });
    }, 150);
  }
  var hofTimer = null;
  function saveHof() {
    clearTimeout(hofTimer);
    hofTimer = setTimeout(function () {
      api("/api/save-hof", { hof: S.hof }).then(function () { toast("Hall of Fame saved"); refreshStatus(); })
        .catch(function (e) { toast("Save failed: " + e.message, true); });
    }, 500);
  }

  // ------------------------------------------------------------ status bar
  function refreshStatus() {
    return api("/api/state").then(function (st) {
      S.git = st.git; S.progress = st.progress;
      drawStatus();
    });
  }
  function drawStatus() {
    var lines = (S.git || "").split("\n");
    var head = lines[0] || "", changed = lines.length - 1;
    var ahead = (head.match(/ahead (\d+)/) || [])[1];
    var parts = [S.season - 1 + "-" + String(S.season).slice(2) + " season"];
    if (S.progress.lastUpdate) parts.push("stats " + S.progress.lastUpdate);
    parts.push(changed ? changed + " unpublished change" + (changed > 1 ? "s" : "") : ahead ? ahead + " commit(s) not pushed" : "all published");
    document.getElementById("status").textContent = parts.join(" · ");
  }

  // ------------------------------------------------------------ tabs
  function draw() {
    var tabs = [["draft", "Draft"], ["bench", "Bench"], ["pickups", "Pickups"], ["fixes", "Stat fixes"], ["hof", "Hall of Fame"]];
    var html = '<div class="seg tabs" id="tabs">' + tabs.map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === TAB ? "on" : "") + '">' + t[1] + "</button>";
    }).join("") + '</div><div id="log-wrap"></div><datalist id="dl-roster">' +
      ROSTERS.map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.school) + "</option>"; }).join("") +
      '</datalist><datalist id="dl-players">' + S.players.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join("") +
      '</datalist><datalist id="dl-schools">' + S.schools.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>";
    html += '<div id="tab-body"></div>';
    el.innerHTML = html;
    document.getElementById("tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      TAB = b.getAttribute("data-tab");
      history.replaceState(null, "", "#" + TAB);
      draw();
    });
    ({ draft: drawDraft, bench: drawBench, pickups: drawPickups, fixes: drawFixes, hof: drawHof }[TAB] || drawDraft)();
  }
  function body(html) { document.getElementById("tab-body").innerHTML = html; return document.getElementById("tab-body"); }

  // ---- draft
  function drawDraft() {
    var mm = DRAFT_KIND === "mm";
    if (mm && !S.mm) {
      S.mm = { season: S.season, managers: cfg().managers || S.managers, teams: {}, players: {}, overrides: [] };
      S.managers.forEach(function (m) { S.mm.teams[m] = { draft: ["", "", "", "", "", "", ""] }; });
    }
    var c = mm ? S.mm : cfg();
    var ms = S.managers;
    var rows = "";
    for (var r = 0; r < 7; r++) {
      rows += "<tr><td class='rank'>" + (r + 1) + "</td>" + ms.map(function (m) {
        var name = c.teams[m].draft[r] || "";
        var sch = name ? schoolOf(name, mm) : null;
        var hint = !name ? "" : sch ? '<div class="school">' + esc(sch) + "</div>" :
          '<div class="school warn">School? <input type="text" list="dl-schools" class="school-in" data-m="' + m + '" data-r="' + r + '" placeholder="type school" style="width:120px;font-size:12px;padding:2px 5px"></div>';
        return '<td><input type="text" class="player" list="' + (mm ? "dl-schools-none" : "dl-roster") + '" data-m="' + m + '" data-r="' + r + '" value="' + esc(name) + '" placeholder="' + (mm ? "player" : "search Big Ten rosters") + '">' + hint + "</td>";
      }).join("") + "</tr>";
    }
    var head = "<th>Rd</th>" + ms.map(function (m) { return "<th>" + sw(m) + " " + m + "</th>"; }).join("");
    var root = body(
      '<div class="controls" style="margin-bottom:12px"><div class="seg" id="kind"><button type="button" data-k="season" class="' + (mm ? "" : "on") + '">Regular season</button><button type="button" data-k="mm" class="' + (mm ? "on" : "") + '">March Madness</button></div>' +
      (mm ? "" : '<label class="muted" style="font-size:13px">Draft order <input type="text" id="order" value="' + esc(cfg().draftOrder || "") + '" placeholder="e.g. MWBF" style="width:80px"></label>') + "</div>" +
      card(mm ? "March Madness draft" : "Draft board", '<p class="hint">' + (mm ? "Any NCAA tournament player; type the school (ESPN name, e.g. Duke, UConn)." :
        "Start typing a name; current Big Ten players autocomplete and their school fills in. Saves as you go.") + "</p>" +
        '<div class="tbl-wrap"><table>' + "<thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>"));
    root.querySelector("#kind").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) { DRAFT_KIND = b.getAttribute("data-k"); drawDraft(); }
    });
    var order = root.querySelector("#order");
    if (order) order.addEventListener("change", function () { cfg().draftOrder = order.value.toUpperCase().replace(/[^MWBF]/g, "") || null; saveCfg("Draft order saved"); });
    root.querySelectorAll("input.player").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var m = inp.getAttribute("data-m"), r = Number(inp.getAttribute("data-r")), name = inp.value.trim();
        var hit = rosterHit(name);
        if (hit && !mm) name = hit.name;  // ESPN spelling
        c.teams[m].draft[r] = name;
        if (!mm) registerPlayer(name);
        saveCfg(name ? name + " drafted" : "Pick cleared");
        drawDraft();
      });
    });
    root.querySelectorAll("input.school-in").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var m = inp.getAttribute("data-m"), r = Number(inp.getAttribute("data-r")), name = c.teams[m].draft[r];
        if (!inp.value.trim()) return;
        c.players = c.players || {};
        c.players[name] = { school: inp.value.trim(), id: null };
        saveCfg("School set for " + name);
        drawDraft();
      });
    });
  }

  // ---- bench
  function drawBench() {
    var cards = S.managers.map(function (m) {
      var t = team(m), roster = currentRoster(m), n = nextGame(m);
      var plan = (t.bench || []).slice().sort(function (a, b) { return a.fromGame - b.fromGame; });
      var cur = null;
      plan.forEach(function (b) { if (b.fromGame <= n) cur = b; });
      var rows = plan.map(function (b, i) {
        return "<tr class='" + (b === cur ? "current" : "") + "'><td class='n'>" + b.fromGame + "</td><td>" + esc(b.player) + (b === cur ? ' <span class="badge bn">current</span>' : "") +
          "</td><td style='text-align:right'><button class='btn small danger' data-del='" + i + "' data-m='" + m + "'>Remove</button></td></tr>";
      }).join("");
      return '<div class="card"><h3 style="margin-bottom:8px">' + sw(m) + " " + m + ' <span class="muted" style="font-weight:400;font-size:13px">next game #' + n + "</span></h3>" +
        (plan.length ? '<div class="tbl-wrap"><table><thead><tr><th class="n">From game</th><th>Bench</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" :
          '<p class="school warn">No bench set (update will default to the round-7 player).</p>') +
        '<div class="form-row"><label>Bench player<select class="in" data-pick="' + m + '">' + roster.map(function (p) { return opt(p, p, cur && cur.player === p); }).join("") +
        '</select></label><label>From game #<input type="number" class="num" min="1" max="31" value="' + n + '" data-from="' + m + '"></label>' +
        '<button class="btn primary" data-set="' + m + '" style="align-self:flex-end">Set bench</button></div></div>';
    }).join("");
    var root = body('<p class="hint">The bench player only counts when a starter doesn’t play that game #. Change it any time, effective from a game #.</p><div class="grid two">' + cards + "</div>");
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var m;
      if ((m = b.getAttribute("data-set"))) {
        var player = root.querySelector('[data-pick="' + m + '"]').value, from = Number(root.querySelector('[data-from="' + m + '"]').value) || 1;
        var plan = (team(m).bench || []).filter(function (x) { return Number(x.fromGame) !== from; });
        plan.push({ fromGame: from, player: player });
        team(m).bench = plan.sort(function (a, b) { return a.fromGame - b.fromGame; });
        saveCfg(m + ": " + player + " benched from game " + from);
        drawBench();
      } else if ((m = b.getAttribute("data-m"))) {
        var sorted = team(m).bench.slice().sort(function (a, b) { return a.fromGame - b.fromGame; });
        sorted.splice(Number(b.getAttribute("data-del")), 1);
        team(m).bench = sorted;
        saveCfg("Bench entry removed");
        drawBench();
      }
    });
  }

  // ---- pickups
  function drawPickups() {
    var cards = S.managers.map(function (m) {
      var t = team(m), roster = currentRoster(m), resolved = (S.progress.teams[m] || {}).pickups || [];
      var list = (t.pickups || []).map(function (p, i) {
        var r = resolved.filter(function (x) { return x.add === p.add && x.drop === p.drop; })[0];
        var from = p.fromGame ? p.fromGame + " (set)" : r ? r.fromGame : '<span class="muted">after update</span>';
        return "<tr><td>" + esc(p.date || "") + "</td><td>+ " + esc(p.add) + '<div class="school">' + esc(schoolOf(p.add) || "school?") + "</div></td><td>- " + esc(p.drop) + "</td><td class='n'>" + from +
          "</td><td style='text-align:right'><button class='btn small danger' data-del='" + i + "' data-m='" + m + "'>Undo</button></td></tr>";
      }).join("");
      return '<div class="card"><h3 style="margin-bottom:8px">' + sw(m) + " " + m + "</h3>" +
        (list ? '<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Added</th><th>Dropped</th><th class="n">From game</th><th></th></tr></thead><tbody>' + list + "</tbody></table></div>" : '<p class="muted">No pickups yet.</p>') +
        '<div class="form-row"><label>Date<input type="date" data-date="' + m + '" value="' + todayET() + '"></label>' +
        '<label>Add<input type="text" class="player" list="dl-roster" data-add="' + m + '" placeholder="search Big Ten rosters"></label>' +
        '<label>Drop<select class="in" data-drop="' + m + '">' + roster.map(function (p) { return opt(p); }).join("") + "</select></label>" +
        '<label>From game # (optional)<input type="number" class="num" min="1" max="31" data-fg="' + m + '" placeholder="auto"></label>' +
        '<button class="btn primary" data-pk="' + m + '" style="align-self:flex-end">Add pickup</button></div></div>';
    }).join("");
    var pd = (cfg().pickupDates || []).join(", ");
    var root = body('<p class="hint">Pickup dates: ' + esc(pd || "none set") + ". The new player counts from the next game # after both players’ games through the pickup date; leave “from game” blank to let the update work it out.</p><div class=\"grid two\">" + cards + "</div>");
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var m;
      if ((m = b.getAttribute("data-pk"))) {
        var add = root.querySelector('[data-add="' + m + '"]').value.trim(), drop = root.querySelector('[data-drop="' + m + '"]').value;
        var date = root.querySelector('[data-date="' + m + '"]').value, fg = Number(root.querySelector('[data-fg="' + m + '"]').value);
        if (!add) return toast("Type the player to add", true);
        var hit = rosterHit(add);
        if (hit) add = hit.name;
        if (currentRoster(m).indexOf(add) >= 0) return toast(add + " is already on " + m + "'s roster", true);
        var p = { date: date || todayET(), add: add, drop: drop };
        if (fg) p.fromGame = fg;
        (team(m).pickups = team(m).pickups || []).push(p);
        registerPlayer(add);
        if (!schoolOf(add)) {
          var sch = window.prompt(add + " isn't on a current Big Ten roster. What school is he at?", "");
          if (sch) cfg().players[add] = { school: sch.trim(), id: null };
        }
        saveCfg(m + ": +" + add + " / -" + drop);
        drawPickups();
      } else if ((m = b.getAttribute("data-m"))) {
        var gone = team(m).pickups.splice(Number(b.getAttribute("data-del")), 1)[0];
        saveCfg("Undid pickup of " + gone.add);
        drawPickups();
      }
    });
  }

  // ---- stat fixes
  function drawFixes() {
    var ovs = cfg().overrides || [];
    var rows = ovs.map(function (o, i) {
      return "<tr><td>" + esc(o.player) + "</td><td class='n'>" + o.game + "</td><td>" + (o.dnp ? "DNP" : esc((o.stats || []).join("-"))) + "</td><td class='muted'>" + esc(o.opp || "") +
        "</td><td style='text-align:right'><button class='btn small danger' data-del='" + i + "'>Remove</button></td></tr>";
    }).join("");
    var root = body(card("Stat fixes", '<p class="hint">Overrides what the box score says for one player’s game #. Use it when a stat provider is wrong.</p>' +
      (rows ? '<div class="tbl-wrap"><table><thead><tr><th>Player</th><th class="n">Game</th><th>PTS-REB-AST-STL-BLK</th><th>Opp</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : '<p class="muted">None.</p>') +
      '<div class="form-row"><label>Player<select class="in" id="fx-p">' + everRostered().map(function (p) { return opt(p); }).join("") + "</select></label>" +
      '<label>Game #<input type="number" class="num" id="fx-g" min="1" max="31"></label>' +
      ["PTS", "REB", "AST", "STL", "BLK"].map(function (k) { return "<label>" + k + '<input type="number" class="num fx-s" min="0" style="width:56px"></label>'; }).join("") +
      '<label><span>Didn’t play</span><input type="checkbox" id="fx-dnp"></label>' +
      '<label>Opp (optional)<input type="text" id="fx-o" placeholder="vs Iowa" style="width:110px"></label>' +
      '<button class="btn primary" id="fx-add" style="align-self:flex-end">Add fix</button></div>'));
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.id === "fx-add") {
        var g = Number(root.querySelector("#fx-g").value), p = root.querySelector("#fx-p").value;
        if (!g) return toast("Enter the game #", true);
        var o = { player: p, game: g };
        if (root.querySelector("#fx-dnp").checked) o.dnp = true;
        else o.stats = Array.prototype.map.call(root.querySelectorAll(".fx-s"), function (i) { return Number(i.value) || 0; });
        var opp = root.querySelector("#fx-o").value.trim();
        if (opp) o.opp = opp;
        cfg().overrides = (cfg().overrides || []).filter(function (x) { return !(x.player === p && Number(x.game) === g); }).concat([o]);
        saveCfg("Fix saved for " + p + ", game " + g);
        drawFixes();
      } else if (b.hasAttribute("data-del")) {
        cfg().overrides.splice(Number(b.getAttribute("data-del")), 1);
        saveCfg("Fix removed");
        drawFixes();
      }
    });
  }

  // ---- hall of fame
  function drawHof() {
    var H = S.hof;
    H.members = H.members || [];
    H.ballots = H.ballots || {};
    var years = Object.keys(H.ballots).sort().reverse();
    if (!BALLOT_YEAR) BALLOT_YEAR = years[0];
    var ownerSel = function (cls, i, v) {
      return '<select class="in ' + cls + '" data-i="' + i + '">' + opt("", "--", !v) + S.managers.map(function (m) { return opt(m, m, m === v); }).join("") + "</select>";
    };
    var mRows = H.members.map(function (h, i) {
      return "<tr><td><input type='text' class='player hm' data-f='player' data-i='" + i + "' list='dl-players' value='" + esc(h.player) + "'></td><td>" + ownerSel("hm-owner", i, h.owner) +
        "</td><td><input type='text' class='hm' data-f='years' data-i='" + i + "' value='" + esc(h.years) + "' style='width:100px'></td>" +
        "<td><input type='number' class='num hm' data-f='inducted' data-i='" + i + "' value='" + esc(h.inducted) + "' style='width:76px'></td>" +
        "<td><input type='number' class='num hm' data-f='vote' data-i='" + i + "' value='" + esc(h.vote) + "' min='0' max='100'>%</td>" +
        "<td style='text-align:right'><button class='btn small danger' data-mdel='" + i + "'>Remove</button></td></tr>";
    }).join("");
    var ballot = (H.ballots[BALLOT_YEAR] || []);
    var bRows = ballot.map(function (b, i) {
      return "<tr><td><input type='text' class='player hb' data-f='player' data-i='" + i + "' list='dl-players' value='" + esc(b.player) + "'></td><td>" + ownerSel("hb-owner", i, b.owner) +
        "</td><td><input type='text' class='hb' data-f='years' data-i='" + i + "' value='" + esc(b.years) + "' style='width:100px'></td>" +
        "<td><input type='number' class='num hb' data-f='yearsOnBallot' data-i='" + i + "' value='" + esc(b.yearsOnBallot) + "' min='1' max='4'></td>" +
        "<td style='text-align:right;white-space:nowrap'><button class='btn small' data-induct='" + i + "'>Induct</button> <button class='btn small danger' data-bdel='" + i + "'>Remove</button></td></tr>";
    }).join("");
    var next = String((Number(years[0]) || S.season) + 1);
    var root = body(
      card("Members (" + H.members.length + ")", '<div class="tbl-wrap"><table><thead><tr><th>Player</th><th>Owner</th><th>Years</th><th>Inducted</th><th>Vote</th><th></th></tr></thead><tbody>' + mRows +
        '</tbody></table></div><div class="form-row"><button class="btn" id="m-add">+ Add member</button></div>') +
      card("Ballot", '<p class="hint">3/4 of the vote gets a player in; 3/4 takes him off; 4 years max on the ballot. Eligible: career over, more than 20 games and 500 total points.</p>' +
        (bRows ? '<div class="tbl-wrap"><table><thead><tr><th>Player</th><th>Owner</th><th>Years</th><th>Yrs on ballot</th><th></th></tr></thead><tbody>' + bRows + "</tbody></table></div>" : '<p class="muted">No nominees.</p>') +
        '<div class="form-row"><button class="btn" id="b-add">+ Add nominee</button></div>',
        '<div class="controls"><select class="in" id="b-year">' + years.map(function (y) { return opt(y, y + " ballot", y === BALLOT_YEAR); }).join("") +
        '</select><button class="btn" id="b-new">Start ' + next + " ballot</button></div>"));

    function edit(list, inp) {
      var i = Number(inp.getAttribute("data-i")), f = inp.getAttribute("data-f");
      var v = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value.trim();
      list[i][f] = v;
      if (f === "player") {  // fill owner / years from the player index when picking a known player
        var p = S.players.filter(function (x) { return norm(x.name) === norm(v); })[0];
        if (p) {
          if (!list[i].owner) list[i].owner = p.owner;
          if (!list[i].years) list[i].years = yearsText(p.years);
          saveHof(); drawHof(); return;
        }
      }
      saveHof();
    }
    root.querySelectorAll("input.hm").forEach(function (inp) { inp.addEventListener("change", function () { edit(H.members, inp); }); });
    root.querySelectorAll("input.hb").forEach(function (inp) { inp.addEventListener("change", function () { edit(H.ballots[BALLOT_YEAR], inp); }); });
    root.querySelectorAll("select.hm-owner").forEach(function (s) { s.addEventListener("change", function () { H.members[Number(s.getAttribute("data-i"))].owner = s.value; saveHof(); }); });
    root.querySelectorAll("select.hb-owner").forEach(function (s) { s.addEventListener("change", function () { H.ballots[BALLOT_YEAR][Number(s.getAttribute("data-i"))].owner = s.value; saveHof(); }); });
    root.querySelector("#b-year") && root.querySelector("#b-year").addEventListener("change", function (e) { BALLOT_YEAR = e.target.value; drawHof(); });
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var i;
      if (b.id === "m-add") { H.members.push({ player: "", owner: "", years: "", inducted: Number(BALLOT_YEAR) || S.season, vote: 100 }); drawHof(); }
      else if (b.id === "b-add") { (H.ballots[BALLOT_YEAR] = H.ballots[BALLOT_YEAR] || []).push({ player: "", owner: "", years: "", yearsOnBallot: 1 }); drawHof(); }
      else if (b.id === "b-new") { startBallot(next); }
      else if ((i = b.getAttribute("data-mdel")) != null) { if (confirm("Remove " + (H.members[i].player || "this member") + "?")) { H.members.splice(Number(i), 1); saveHof(); drawHof(); } }
      else if ((i = b.getAttribute("data-bdel")) != null) { H.ballots[BALLOT_YEAR].splice(Number(i), 1); saveHof(); drawHof(); }
      else if ((i = b.getAttribute("data-induct")) != null) {
        var nom = H.ballots[BALLOT_YEAR][Number(i)];
        var vote = window.prompt("Induct " + nom.player + " in " + BALLOT_YEAR + ". Vote %?", "100");
        if (vote == null) return;
        H.members.push({ player: nom.player, owner: nom.owner, years: nom.years, inducted: Number(BALLOT_YEAR), vote: Number(vote) || 0 });
        saveHof(); drawHof();
        toast(nom.player + " inducted");
      }
    });
  }
  // new ballot: holdovers (not inducted, under 4 years) + players whose careers just ended and qualify
  function startBallot(year) {
    var H = S.hof, prevYear = Object.keys(H.ballots).sort().reverse()[0];
    if (H.ballots[year]) { BALLOT_YEAR = year; return drawHof(); }
    var inducted = {};
    H.members.forEach(function (m) { inducted[norm(m.player)] = 1; });
    var list = [];
    (H.ballots[prevYear] || []).forEach(function (b) {
      if (!b.player || inducted[norm(b.player)] || Number(b.yearsOnBallot) >= 4) return;
      list.push({ player: b.player, owner: b.owner, years: b.years, yearsOnBallot: (Number(b.yearsOnBallot) || 1) + 1 });
    });
    var onList = {};
    list.forEach(function (b) { onList[norm(b.player)] = 1; });
    S.players.forEach(function (p) {
      var last = p.years[p.years.length - 1];
      if (last === Number(year) - 1 && p.gp > 20 && p.t > 500 && p.status !== "hof" && p.status !== "active" && !onList[norm(p.name)] && !inducted[norm(p.name)]) {
        list.push({ player: p.name, owner: p.owner, years: yearsText(p.years), yearsOnBallot: 1 });
      }
    });
    H.ballots[year] = list;
    BALLOT_YEAR = year;
    saveHof();
    drawHof();
    toast(year + " ballot started with " + list.length + " nominees");
  }

  // ------------------------------------------------------------ actions
  function showLog(title, res) {
    document.getElementById("log-wrap").innerHTML = card(title + (res.ok ? "" : ' <span class="badge" style="color:var(--bad)">problem</span>'),
      '<pre class="log">' + esc(res.log || res.error || "") + "</pre>", '<button class="btn small" id="log-close">Close</button>');
    document.getElementById("log-close").addEventListener("click", function () { document.getElementById("log-wrap").innerHTML = ""; });
  }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
  document.getElementById("btn-update").addEventListener("click", function () {
    var b = this;
    busy(b, true, "Updating...");
    api("/api/update", {}).then(function (res) {
      return load().then(function () {  // reload first -- redrawing would wipe the log
        showLog("Update stats", res);
        toast(res.ok ? "Stats updated" : "Update had a problem", !res.ok);
      });
    }).catch(function (e) { toast(e.message, true); }).then(function () { busy(b, false, "Update stats"); });
  });
  document.getElementById("btn-publish").addEventListener("click", function () {
    var b = this;
    var msg = window.prompt("Publish to GitHub. Commit message:", "League update " + todayET());
    if (msg == null) return;
    busy(b, true, "Publishing...");
    api("/api/publish", { message: msg }).then(function (res) {
      showLog("Publish", res);
      toast(res.ok ? "Published -- the site updates in about a minute" : "Publish had a problem", !res.ok);
      return refreshStatus();
    }).catch(function (e) { toast(e.message, true); }).then(function () { busy(b, false, "Publish"); });
  });

  function load() {
    return api("/api/state").then(function (st) {
      S = st;
      drawStatus();
      draw();
    });
  }
  api("/api/rosters").then(function (r) {
    ROSTERS = r;
    r.forEach(function (p) { BY_NAME[norm(p.name)] = p; });
  }).catch(function () { toast("Couldn't load Big Ten rosters (offline?) -- type schools by hand", true); })
    .then(load)
    .catch(function (e) {
      el.innerHTML = '<div class="empty">Start the admin with <code>python tools/admin.py</code> -- this page only works locally. (' + esc(e.message) + ")</div>";
    });
})();
