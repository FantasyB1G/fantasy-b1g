/* Fantasy B1G -- static site. Reads data/index.json + per-season files. */
(function () {
  "use strict";

  var STATS = ["pts", "reb", "ast", "stl", "blk"];
  var LABEL = { t: "Total", pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK" };
  var IDX = null;
  var cache = {};
  var app = document.getElementById("app");
  var resizeHandlers = [];

  // ------------------------------------------------------------ utilities
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return n == null ? "" : Number(n).toLocaleString("en-US"); }
  function fmt1(n) { return n == null ? "" : Number(n).toFixed(2); }
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i] || 0; return t; }
  function add(a, b) { return a.map(function (x, i) { return x + (b[i] || 0); }); }
  function ord(n) { return n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"); }
  function mcolor(m) { return "var(--m-" + m + ")"; }
  function sw(m) { return '<span class="sw" style="background:' + mcolor(m) + '"></span>'; }
  function mgr(m) { return m ? '<a class="mgr" href="#/manager/' + esc(m) + '">' + sw(m) + "<span>" + esc(m) + "</span></a>" : ""; }
  function seasonLabel(y) { return (y - 1) + "-" + String(y).slice(2); }

  function normName(name) {
    var s = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-/g, " ");
    s = s.replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "");
    return s.replace(/\s+/g, " ").trim();
  }
  function pkey(name) { var k = normName(name); return (IDX.aliases && IDX.aliases[k]) || k; }
  // assets/logos/<slug>.png (Big Ten schools); a missing logo just hides itself
  function logo(school, size) {
    if (!school) return "";
    var slug = school.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return '<img class="tlogo" src="assets/logos/' + slug + '.png" alt="" width="' + (size || 16) + '" height="' + (size || 16) +
      '" loading="lazy" onerror="this.remove()">';
  }
  function slink(school) {
    return school ? '<a class="school-link" href="#/team/' + encodeURIComponent(school) + '">' + logo(school) + esc(school) + "</a>" : "";
  }
  function plink(name) {
    if (!name) return '<span class="muted">--</span>';
    return '<a href="#/player/' + encodeURIComponent(pkey(name)) + '">' + esc(name) + "</a>";
  }

  function getJSON(path) {
    if (!cache[path]) {
      var bust = IDX ? IDX.built : String(Date.now());
      cache[path] = fetch(path + "?v=" + encodeURIComponent(bust), { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(path + " " + r.status);
        return r.json();
      });
    }
    return cache[path];
  }
  function seasonFile(y) {
    var path = LIVE.demo && IDX && y === IDX.seasons[IDX.seasons.length - 1].year ? "data/demo/season.json" : "data/seasons/" + y + ".json";
    return getJSON(path).then(markSubs);
  }
  // When the bench player's stats count, he's the "sub" and the starter who
  // didn't play shows "bn" (benched for that game) -- for every season.
  function markSubs(season) {
    season.managers.forEach(function (m) {
      var t = season.teams[m];
      if (!t) return;
      t.games.forEach(function (g) {
        var subs = g.filter(function (r) { return r.b && r.s; });
        if (!subs.length) return;
        subs.forEach(function (r) { r.sub = 1; });
        var out = g.filter(function (r) { return r.p && !r.b && !r.s && !r.rep && r.st !== "pending" && !r.out; });
        out.slice(0, subs.length).forEach(function (r) { r.rep = 1; });
      });
    });
    return season;
  }
  function badge(r) {
    if (r.sub) return ' <span class="badge sub" title="Bench player counted for a starter who didn&rsquo;t play">sub</span>';
    if (r.rep) return ' <span class="badge bn" title="Didn&rsquo;t play; bench player subbed in">bn</span>';
    if (r.b) return ' <span class="badge bn" title="Bench">bn</span>';
    return "";
  }
  function mmFile(y) { return getJSON("data/mm/" + y + ".json"); }

  function card(title, body, right) {
    return '<section class="card">' + (title ? '<div class="card-head"><h2>' + title + "</h2>" + (right || "") + "</div>" : "") + body + "</section>";
  }
  function table(head, rows, cls) {
    return '<div class="tbl-wrap"><table class="' + (cls || "") + '"><thead><tr>' + head + "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
  }
  function th(label, n) { return '<th class="' + (n ? "n" : "") + '">' + label + "</th>"; }
  function statHeads() { return STATS.map(function (k) { return th(LABEL[k], 1); }).join(""); }
  function statCells(s) { return (s || [0, 0, 0, 0, 0]).map(function (v) { return '<td class="n">' + fmt(v) + "</td>"; }).join(""); }
  function seg(id, opts, on) {
    return '<div class="seg" data-seg="' + id + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + esc(o[0]) + '" class="' + (String(o[0]) === String(on) ? "on" : "") + '">' + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }
  function onSeg(root, id, fn) {
    var el = root.querySelector('[data-seg="' + id + '"]');
    if (!el) return;
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
      fn(b.getAttribute("data-v"));
    });
  }
  function yearList(years, on, base) {
    return '<div class="year-list">' + years.map(function (y) {
      return '<a href="#/' + base + "/" + y + '" class="' + (y === on ? "on" : "") + '">' + esc(base === "mm" ? y : seasonLabel(y)) + "</a>";
    }).join("") + "</div>";
  }

  // ------------------------------------------------------------ season math
  function rowTotal(r) { return r && r.s ? sum(r.s) : 0; }
  function teamSlotTotals(team) {
    return team.games.map(function (g) {
      var s = [0, 0, 0, 0, 0], any = false;
      g.forEach(function (r) { if (r.s) { s = add(s, r.s); any = true; } });
      return { s: s, t: sum(s), any: any };
    });
  }
  function currentGame(season) {
    var n = 0;
    season.managers.forEach(function (m) {
      var t = season.teams[m];
      if (!t) return;
      t.games.forEach(function (g, i) {
        if (g.some(function (r) { return r.s || r.st === "dnp" || r.x || r.lv === "in" || r.lv === "post"; })) n = Math.max(n, i + 1);
      });
    });
    return n;
  }
  function playerLines(team) {
    var map = {}, order = [];
    team.games.forEach(function (g) {
      g.forEach(function (r) {
        if (!r.p) return;
        if (!map[r.p]) { map[r.p] = { p: r.p, gp: 0, s: [0, 0, 0, 0, 0], rows: 0 }; order.push(r.p); }
        var l = map[r.p];
        l.rows++;
        if (r.s) { l.gp++; l.s = add(l.s, r.s); }
      });
    });
    return order.map(function (p) { var l = map[p]; l.t = sum(l.s); l.avg = l.gp ? l.t / l.gp : 0; return l; });
  }

  // ------------------------------------------------------------ line chart
  // series: [{name, color, values: [number|null per x]}]; xs: labels
  function lineChart(el, opt) {
    function draw() {
      var W = Math.max(280, el.clientWidth || 600), H = opt.height || 280;
      var padL = 44, padR = opt.endLabels === false ? 12 : 74, padT = 12, padB = 30;
      var iw = W - padL - padR, ih = H - padT - padB;
      var all = [];
      opt.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
      if (!all.length) { el.innerHTML = '<div class="empty">No games yet.</div>'; return; }
      var lo = opt.zero ? 0 : Math.min.apply(null, all), hi = Math.max.apply(null, all);
      var step = niceStep((hi - lo) / 4 || 1);
      lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      if (hi === lo) hi = lo + step;
      var n = opt.xs.length;
      var x = function (i) { return padL + (n === 1 ? iw / 2 : (i * iw) / (n - 1)); };
      var y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
      var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opt.title || "chart") + '">';
      for (var v = lo; v <= hi + 1e-9; v += step) {
        svg += '<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
        svg += '<text class="tick" x="' + (padL - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + compact(v) + "</text>";
      }
      svg += '<line class="axis-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + ih) + '" y2="' + (padT + ih) + '"/>';
      var every = Math.max(1, Math.ceil(n / Math.floor(iw / 46)));
      opt.xs.forEach(function (lab, i) {
        if (i % every && i !== n - 1) return;
        svg += '<text class="tick" x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(lab) + "</text>";
      });
      var ends = [];
      opt.series.forEach(function (s) {
        var d = "", last = null;
        s.values.forEach(function (v, i) {
          if (v == null) return;
          d += (d ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
          last = i;
        });
        svg += '<path class="series" d="' + d + '" stroke="' + s.color + '"/>';
        if (last != null) {
          svg += '<circle class="dot" cx="' + x(last) + '" cy="' + y(s.values[last]) + '" r="4" fill="' + s.color + '"/>';
          ends.push({ name: s.name, y: y(s.values[last]), x: x(last) });
        }
      });
      if (opt.endLabels !== false) {
        ends.sort(function (a, b) { return a.y - b.y; });
        var clear = ends.every(function (e, i) { return i === 0 || e.y - ends[i - 1].y >= 14; });
        if (clear) ends.forEach(function (e) {
          svg += '<text class="end-label" x="' + (e.x + 8) + '" y="' + (e.y + 4) + '">' + esc(e.name) + "</text>";
        });
      }
      svg += '<line class="xhair" id="xh" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" style="display:none"/>';
      svg += '<g id="hdots"></g>';
      svg += '<rect x="' + padL + '" y="' + padT + '" width="' + iw + '" height="' + ih + '" fill="transparent" id="hit"/>';
      svg += "</svg>";
      var legend = '<div class="legend">' + opt.series.map(function (s) {
        return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>";
      }).join("") + "</div>";
      el.innerHTML = legend + '<div class="chart">' + svg + '<div class="tip"></div></div>';
      var root = el.querySelector(".chart"), hit = root.querySelector("#hit"), tip = root.querySelector(".tip");
      var xh = root.querySelector("#xh"), hd = root.querySelector("#hdots");
      function move(ev) {
        var r = root.querySelector("svg").getBoundingClientRect();
        var px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
        var i = Math.round(((px - padL) / iw) * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        var vals = opt.series.map(function (s) { return { s: s, v: s.values[i] }; }).filter(function (o) { return o.v != null; });
        if (!vals.length) { leave(); return; }
        xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.style.display = "";
        hd.innerHTML = vals.map(function (o) {
          return '<circle class="dot" cx="' + x(i) + '" cy="' + y(o.v) + '" r="4.5" fill="' + o.s.color + '"/>';
        }).join("");
        vals.sort(function (a, b) { return b.v - a.v; });
        tip.innerHTML = '<div class="tip-h">' + esc(opt.tipTitle ? opt.tipTitle(i) : opt.xs[i]) + "</div>" + vals.map(function (o) {
          return '<div class="row"><span><i class="sw" style="background:' + o.s.color + '"></i>' + esc(o.s.name) + "</span><b>" + (opt.fmt || fmt)(o.v) + "</b></div>";
        }).join("");
        tip.style.display = "block";
        var left = (x(i) / W) * r.width + 14;
        if (left + tip.offsetWidth > r.width) left = (x(i) / W) * r.width - tip.offsetWidth - 14;
        tip.style.left = Math.max(0, left) + "px";
        tip.style.top = "10px";
      }
      function leave() { tip.style.display = "none"; xh.style.display = "none"; hd.innerHTML = ""; }
      hit.addEventListener("mousemove", move);
      hit.addEventListener("touchstart", move, { passive: true });
      hit.addEventListener("touchmove", move, { passive: true });
      hit.addEventListener("mouseleave", leave);
    }
    draw();
    resizeHandlers.push(draw);
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function compact(v) { return Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "K" : String(Math.round(v * 100) / 100); }

  // ------------------------------------------------------------ shared blocks
  function standingsTable(st, opts) {
    opts = opts || {};
    if (!st.length) return '<div class="empty">No standings yet.</div>';
    var lead = st[0].score;
    var rows = st.map(function (r) {
      var back = r.place === 1 ? "--" : "-" + fmt(lead - r.score);
      return "<tr><td class='rank'>" + r.place + "</td><td>" + mgr(r.m) + (opts.champ && r.place === 1 ? ' <span class="trophy" title="Champion">&#9733;</span>' : "") +
        "</td><td class='n strong'>" + fmt(r.score) + "</td><td class='n muted'>" + back + "</td>" + statCells(r.stats) +
        "<td class='n'>" + fmt(r.gp) + "</td><td class='n'>" + fmt1(r.avg) + "</td></tr>";
    });
    return table("<th></th><th>Team</th>" + th("Score", 1) + th("Back", 1) + statHeads() + th("GP", 1) + th("Avg", 1), rows);
  }

  // mode "gap": points behind the leader after each game #; "total": cumulative score
  function raceChart(el, season, mode) {
    var xs = [], n = currentGame(season) || 0;
    for (var i = 1; i <= n; i++) xs.push(String(i));
    var series = season.managers.filter(function (m) { return season.teams[m]; }).map(function (m) {
      var acc = 0, vals = teamSlotTotals(season.teams[m]).slice(0, n).map(function (s) { acc += s.t; return acc; });
      return { name: m, color: mcolor(m), values: vals };
    });
    if (n < 2) { el.innerHTML = '<div class="empty">' + (n ? "The race chart starts after game 2." : "No games played yet.") + "</div>"; return; }
    if (mode === "gap") {
      var best = xs.map(function (_, i) { return Math.max.apply(null, series.map(function (s) { return s.values[i]; })); });
      series.forEach(function (s) { s.values = s.values.map(function (v, i) { return v - best[i]; }); });
    }
    resizeHandlers = [];
    lineChart(el, {
      series: series, xs: xs, zero: mode !== "gap", title: mode === "gap" ? "Points behind the leader" : "Cumulative score by game",
      fmt: mode === "gap" ? function (v) { return v === 0 ? "leader" : fmt(v); } : fmt,
      tipTitle: function (i) { return "After game " + (i + 1); },
    });
  }

  function statusCell(r) {
    if (r.s) return statCells(r.s) + "<td class='n strong'>" + rowTotal(r) + "</td>";
    if (r.x) return r.x.map(function (v) { return "<td class='n'>" + v + "</td>"; }).join("") + "<td class='n'>" + sum(r.x) + "</td>";
    var txt = r.st === "dnp" ? "DNP" : r.out ? "not in yet" : r.st === "pending" ? "" : "-";
    return "<td class='n' colspan='5' style='text-align:center'>" + txt + "</td><td class='n'>" + (r.st === "pending" ? "" : "0") + "</td>";
  }
  function gameCard(season, m, n) {
    var team = season.teams[m], g = team.games[n - 1] || [];
    var rows = g.map(function (r) {
      if (!r.p) return "<tr class='nc'><td class='pl muted'>(empty)</td><td></td><td colspan='6'></td></tr>";
      var tag = badge(r);
      if (r.ov) tag += ' <span class="muted" title="Stats edited by hand">*</span>';
      var nc = !r.s;
      var when = r.lv === "in" ? '<div class="when"><span class="badge live">' + esc(r.lvd) + "</span></div>" : r.lv === "post" ? '<div class="when"><span class="badge">final</span></div>' :
        r.tip && r.st === "pending" ? '<div class="when">' + esc(whenText(r.tip)) + "</div>" : "";
      return "<tr class='" + (nc ? "nc" : "") + "'><td class='pl'>" + plink(r.p) + tag + "</td><td class='opp'>" + esc(r.o || (r.st === "pending" ? "upcoming" : "")) + when + "</td>" + statusCell(r) + "</tr>";
    });
    var t = [0, 0, 0, 0, 0];
    g.forEach(function (r) { if (r.s) t = add(t, r.s); });
    rows.push("<tr class='total'><td>Total</td><td></td>" + statCells(t) + "<td class='n'>" + sum(t) + "</td></tr>");
    return '<div class="card team-card"><h3>' + mgr(m) + '<span class="score">' + sum(t) + "</span></h3>" +
      table("<th>Player</th><th>Opp</th>" + statHeads() + th("Tot", 1), rows, "box") + "</div>";
  }

  function gameView(el, season, start, onChange) {
    var max = season.slots, n = Math.min(Math.max(1, start || 1), max);
    function draw() {
      el.innerHTML = '<div class="card-head"><h2>Game by game</h2><div class="pager"><button type="button" data-d="-1" ' + (n <= 1 ? "disabled" : "") +
        '>&lsaquo;</button><select aria-label="Game number">' + Array.apply(null, Array(max)).map(function (_, i) {
          return '<option value="' + (i + 1) + '"' + (i + 1 === n ? " selected" : "") + ">Game " + (i + 1) + "</option>";
        }).join("") + '</select><button type="button" data-d="1" ' + (n >= max ? "disabled" : "") + ">&rsaquo;</button></div></div>" +
        '<p class="muted" style="margin:-4px 0 12px;font-size:13px">Each player\'s game # is his team\'s game #. ' +
        "Bench (bn) stats only count when a starter doesn't play (sub).</p>" +
        '<div class="grid two">' + season.managers.filter(function (m) { return season.teams[m]; }).map(function (m) { return gameCard(season, m, n); }).join("") + "</div>";
      el.querySelectorAll(".pager button").forEach(function (b) {
        b.addEventListener("click", function () { n = Math.min(max, Math.max(1, n + Number(b.getAttribute("data-d")))); if (onChange) onChange(n); draw(); });
      });
      el.querySelector(".pager select").addEventListener("change", function (e) { n = Number(e.target.value); if (onChange) onChange(n); draw(); });
    }
    draw();
  }

  function heat(t) {
    if (t >= 40) return "background:rgba(42,120,214,0.38)";
    if (t >= 30) return "background:rgba(42,120,214,0.24)";
    if (t >= 20) return "background:rgba(42,120,214,0.11)";
    return "";
  }
  function teamGrid(season, m) {
    var team = season.teams[m], n = season.slots, order = [], seen = {};
    var nslots = Math.max.apply(null, team.games.map(function (g) { return g.length; }).concat([0]));
    for (var slot = 0; slot < nslots; slot++) {
      team.games.forEach(function (g) {
        var r = g[slot];
        if (r && r.p && !seen[r.p]) { seen[r.p] = 1; order.push(r.p); }
      });
    }
    var head = "<th class='pl'>Player</th>";
    for (var i = 1; i <= n; i++) head += "<th>" + i + "</th>";
    head += th("Tot", 1);
    var lines = {};
    playerLines(team).forEach(function (l) { lines[l.p] = l; });
    var rows = order.map(function (p) {
      var cells = "";
      team.games.forEach(function (g, gi) {
        var r = g.filter(function (x) { return x.p === p; })[0];
        if (!r) { cells += "<td class='c off'></td>"; return; }
        var tipTxt = "Game " + (gi + 1) + (r.o ? " " + r.o : "") + ": ";
        var stats = r.s || r.x;
        tipTxt += stats ? stats.join("-") + " (pts-reb-ast-stl-blk)" : r.st === "dnp" ? "did not play" : r.st === "pending" ? "upcoming" : "no stats";
        if (r.b) tipTxt += r.sub ? " [bench, subbed in]" : " [bench]";
        if (r.rep) tipTxt += " [benched: bench player subbed in]";
        if (r.s) cells += "<td class='c' style='" + heat(sum(r.s)) + "' title='" + esc(tipTxt) + "'>" + sum(r.s) + "</td>";
        else if (r.x) cells += "<td class='c nc' title='" + esc(tipTxt) + "'>(" + sum(r.x) + ")</td>";
        else cells += "<td class='c nc' title='" + esc(tipTxt) + "'>" + (r.st === "pending" ? "" : r.b ? "bn" : "-") + "</td>";
      });
      var l = lines[p];
      return "<tr><td class='pl'>" + plink(p) + "</td>" + cells + "<td class='n strong'>" + fmt(l ? l.t : 0) + "</td></tr>";
    });
    var tot = teamSlotTotals(team), tcells = "";
    tot.forEach(function (s) { tcells += "<td class='c'>" + (s.any ? s.t : "") + "</td>"; });
    rows.push("<tr class='total'><td class='pl'>Team</td>" + tcells + "<td class='n'>" + fmt(sum(tot.map(function (s) { return s.t; }))) + "</td></tr>");
    return table(head, rows, "mx") + '<p class="muted" style="font-size:12px;margin:8px 0 0">Fantasy points (PTS+REB+AST+STL+BLK) per game. ' +
      "(n) = bench player, not counted. Hover a cell for the stat line.</p>";
  }

  function seasonPlayersTable(season, m) {
    var lines = playerLines(season.teams[m]).sort(function (a, b) { return b.t - a.t; });
    var rows = lines.map(function (l) {
      return "<tr><td>" + plink(l.p) + "</td><td class='n'>" + l.gp + "</td>" + statCells(l.s) + "<td class='n strong'>" + fmt(l.t) + "</td><td class='n'>" + fmt1(l.avg) + "</td></tr>";
    });
    return table("<th>Player</th>" + th("GP", 1) + statHeads() + th("Total", 1) + th("Avg", 1), rows);
  }

  function draftBoard(season) {
    var ms = season.managers.filter(function (m) { return season.teams[m]; });
    var rounds = Math.max.apply(null, ms.map(function (m) { return season.teams[m].draft.length; }));
    var rows = [];
    for (var r = 0; r < rounds; r++) {
      rows.push("<tr><td class='rank'>" + (r + 1) + "</td>" + ms.map(function (m) {
        var p = season.teams[m].draft[r];
        return "<td>" + (p ? plink(p) : "<span class='muted'>--</span>") + "</td>";
      }).join("") + "</tr>");
    }
    var head = "<th>Rd</th>" + ms.map(function (m) { return "<th>" + mgr(m) + "</th>"; }).join("");
    var picks = [];
    ms.forEach(function (m) {
      (season.teams[m].pickups || []).forEach(function (p) { picks.push({ m: m, p: p }); });
    });
    picks.sort(function (a, b) { return (a.p.date || "").localeCompare(b.p.date || "") || a.p.fromGame - b.p.fromGame; });
    var pk = picks.length ? table("<th>Date</th><th>Team</th><th>Added</th><th>Dropped</th>" + th("From game", 1), picks.map(function (x) {
      return "<tr><td>" + esc(x.p.date || "") + "</td><td>" + mgr(x.m) + "</td><td>" + plink(x.p.add) + "</td><td>" + plink(x.p.drop) + "</td><td class='n'>" + (x.p.fromGame || "") + "</td></tr>";
    })) : '<div class="empty">No pickups yet.</div>';
    var benches = [];
    ms.forEach(function (m) {
      (season.teams[m].bench || []).forEach(function (b) { benches.push("<tr><td>" + mgr(m) + "</td><td>" + plink(b.player) + "</td><td class='n'>" + b.fromGame + "</td></tr>"); });
    });
    return '<div class="grid two"><div><h3 style="margin-bottom:8px">Draft' + (season.draftOrder ? ' <span class="muted" style="font-weight:400">order ' + esc(season.draftOrder.split("").join("-")) + "</span>" : "") + "</h3>" +
      table(head, rows) + "</div><div><h3 style=\"margin-bottom:8px\">Pickups</h3>" + pk +
      (benches.length ? '<h3 style="margin:16px 0 8px">Bench moves</h3>' + table("<th>Team</th><th>Benched</th>" + th("From game", 1), benches) : "") + "</div></div>";
  }

  // ------------------------------------------------------------ pages
  // ------------------------------------------------------------ live layer
  // The official numbers come from data/seasons/<year>.json (written by
  // update.py). On the current season's page the browser also pulls today's
  // Big Ten scoreboard + box scores straight from ESPN and lays provisional
  // live stats over the pending rows, applying the same bench rule.
  var ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
  var LIVE = { demo: /[?&]demo=1/.test(location.search), now: null, timer: null };
  function nowMs() { return LIVE.now || Date.now(); }
  function et(ms, opts) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: "America/New_York" }, opts)).format(new Date(ms)); }
  function etDate(ms) {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
    return p.replace(/-/g, "");
  }
  function fmtTime(iso) { return et(Date.parse(iso), { hour: "numeric", minute: "2-digit" }); }
  function fmtDay(iso) { return et(Date.parse(iso), { weekday: "short", month: "numeric", day: "numeric" }); }
  function isToday(iso) { return etDate(Date.parse(iso)) === etDate(nowMs()); }
  function whenText(iso) { return isToday(iso) ? "Tonight " + fmtTime(iso) : fmtDay(iso) + " " + fmtTime(iso); }

  function scheduleFile(y) {
    return getJSON(LIVE.demo ? "data/demo/schedule.json" : "data/schedule/" + y + ".json").catch(function () { return null; });
  }
  function fetchBoard() {
    if (LIVE.demo) return getJSON("data/demo/scoreboard.json");
    return fetch(ESPN + "/scoreboard?dates=" + etDate(nowMs()) + "&groups=7&limit=100", { cache: "no-store" }).then(function (r) { return r.json(); });
  }
  function fetchBox(id) {
    if (LIVE.demo) return getJSON("data/demo/summary/" + id + ".json");
    return fetch(ESPN + "/summary?event=" + id, { cache: "no-store" }).then(function (r) { return r.json(); });
  }
  function normEvents(board) {
    return (board.events || []).map(function (e) {
      var c = e.competitions[0], st = c.status;
      var side = function (ha) {
        var x = c.competitors.filter(function (k) { return k.homeAway === ha; })[0];
        return { id: String(x.id), loc: x.team.location, abbr: x.team.abbreviation, score: x.score, logo: x.team.logo };
      };
      var tv = [];
      (c.broadcasts || []).forEach(function (b) { tv = tv.concat(b.names || []); });
      return { id: String(e.id), date: e.date, state: st.type.state, detail: st.type.shortDetail, home: side("home"), away: side("away"),
        neutral: !!c.neutralSite, tv: tv.join(", ") };
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function parseBox(summary) {
    var out = { byId: {}, byName: {} };
    ((summary.boxscore || {}).players || []).forEach(function (t) {
      var st = t.statistics && t.statistics[0];
      if (!st) return;
      var ix = {};
      st.names.forEach(function (n, i) { ix[n] = i; });
      st.athletes.forEach(function (a) {
        if (a.didNotPlay || !a.stats || !a.stats.length) return;
        var num = function (k) { var v = parseInt(a.stats[ix[k]], 10); return isNaN(v) ? 0 : v; };
        if (!num("MIN") && !num("PTS") && !num("REB") && !num("AST")) return;
        var line = { name: a.athlete.displayName, s: [num("PTS"), num("REB"), num("AST"), num("STL"), num("BLK")] };
        out.byId[String(a.athlete.id)] = line;
        out.byName[normName(a.athlete.displayName)] = line;
      });
    });
    return out;
  }

  // Returns a copy of `base` with schedule info on pending rows and live stats
  // from today's games, plus per-manager "today" bookkeeping.
  function applyLive(base, sched, events, boxes) {
    var season = JSON.parse(JSON.stringify(base));
    var evById = {};
    events.forEach(function (e) { evById[e.id] = e; });
    var players = season.players || {};
    season.managers.forEach(function (m) {
      var team = season.teams[m];
      if (!team) return;
      team.games.forEach(function (g, gi) {
        var touched = false;
        g.forEach(function (r) {
          if (!r.p || r.st !== "pending") return;
          var info = players[r.p] || {}, sc = sched && sched[info.school];
          var sg = sc && sc.games[gi];
          if (!sg) return;
          r.o = (sg.home || sg.neutral ? "vs " : "@ ") + sg.opp;
          r.tip = sg.date; r.tv = sg.tv; r.gid = sg.id;
          var ev = evById[sg.id];
          if (!ev) return;
          r.lv = ev.state; r.lvd = ev.detail;
          if (ev.state === "pre") return;
          touched = true;
          var box = boxes[ev.id];
          if (!box) return;
          var line = (info.id && box.byId[String(info.id)]) || box.byName[normName(r.p)];
          if (line) { r.raw = line.s; r.st = null; }
          else if (ev.state === "post") r.st = "dnp";
          else r.out = 1;  // game on, not in the box score (yet)
        });
        if (!touched) return;
        // same counting rule as update.py, just provisional
        var startersOut = g.filter(function (r) { return r.p && !r.b && r.st === "dnp"; }).length;
        g.forEach(function (r) {
          if (r.raw) {
            if (!r.b) r.s = r.raw;
            else if (startersOut) { r.s = r.raw; r.sub = 1; }
            else r.x = r.raw;
            delete r.raw;
          } else if (r.b && r.x && startersOut) {
            r.s = r.x; r.sub = 1; delete r.x;
          }
          if (r.st == null) delete r.st;
        });
      });
    });
    return markSubs(season);
  }

  function seasonStandings(season) {
    var rows = season.managers.filter(function (m) { return season.teams[m]; }).map(function (m) {
      var s = [0, 0, 0, 0, 0], gp = 0, today = 0, now = 0, later = 0;
      season.teams[m].games.forEach(function (g) {
        g.forEach(function (r) {
          if (r.s) { s = add(s, r.s); gp++; if (r.lv) today += sum(r.s); }
          if (r.lv === "in" && !r.b) now++;
          if (r.lv === "pre" && !r.b) later++;
        });
      });
      var score = sum(s);
      return { m: m, stats: s, score: score, gp: gp, avg: gp ? Math.round((score / gp) * 100) / 100 : 0, today: today, now: now, later: later };
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    rows.forEach(function (r, i) { r.place = i + 1; });
    return rows;
  }

  // each rostered player's row for today's game, or else his next game
  function playerStatus(season, m) {
    var team = season.teams[m], seen = {}, out = [];
    team.games.forEach(function (g, gi) {
      g.forEach(function (r) {
        if (!r.p || seen[r.p]) return;
        if (r.lv || r.st === "pending") { seen[r.p] = 1; out.push({ r: r, n: gi + 1 }); }
      });
    });
    var rank = function (x) { return x.r.lv === "in" ? 0 : x.r.lv === "post" ? 1 : x.r.lv === "pre" ? 2 : 3; };
    return out.sort(function (a, b) { return rank(a) - rank(b) || (a.r.tip || "").localeCompare(b.r.tip || ""); });
  }

  function playingCard(season, m) {
    var rows = playerStatus(season, m).map(function (x) {
      var r = x.r, stat, line = r.s || r.x;
      var tag = badge(r);
      if (r.lv === "in" || r.lv === "post") {
        stat = (r.lv === "in" ? '<span class="badge live">' + esc(r.lvd) + "</span>" : '<span class="badge">final</span>') + " " +
          (line ? '<span class="muted">' + line.join("-") + "</span>" : r.st === "dnp" ? '<span class="muted">DNP</span>' : '<span class="muted">not in yet</span>');
      } else if (r.tip) {
        stat = '<span class="muted">' + esc((isToday(r.tip) ? "Tonight " + fmtTime(r.tip) : "Next: " + fmtDay(r.tip) + " " + fmtTime(r.tip)) + " " + (r.o || "") + (r.tv && isToday(r.tip) ? " · " + r.tv : "")) + "</span>";
      } else stat = '<span class="muted">game ' + x.n + "</span>";
      var fp = r.s ? "<b>" + sum(r.s) + "</b>" : r.x ? '<span class="muted">(' + sum(r.x) + ")</span>" : "";
      return "<tr class='" + ((r.b && !r.sub) || r.rep ? "nc" : "") + "'><td class='pl'>" + plink(r.p) + tag + "</td><td class='stat'>" + stat + "</td><td class='n'>" + fp + "</td></tr>";
    });
    return rows.length ? table("<th>Player</th><th>Game</th>" + th("FP", 1), rows, "box playing") : '<div class="empty">Season over.</div>';
  }

  function scoreboardCard(events, season) {
    var who = {};
    season.managers.forEach(function (m) {
      playerStatus(season, m).forEach(function (x) {
        if (!x.r.gid) return;
        (who[x.r.gid] = who[x.r.gid] || []).push({ m: m, r: x.r });
      });
    });
    var tiles = events.map(function (e) {
      var side = function (t) {
        return '<div class="sb-team"><img src="' + esc(t.logo || "") + '" alt="" loading="lazy" width="18" height="18"><span>' + esc(t.loc) + "</span><b>" +
          (e.state === "pre" ? "" : esc(t.score)) + "</b></div>";
      };
      var status = e.state === "pre" ? fmtTime(e.date) + (e.tv ? " · " + esc(e.tv) : "") : e.state === "in" ? '<span class="live-dot"></span>' + esc(e.detail) : "Final";
      var chips = (who[e.id] || []).map(function (w) {
        return '<span class="chip' + (w.r.b && !w.r.sub ? " nc" : "") + '" title="' + esc(w.m + (w.r.b ? " (bench)" : "")) + '">' + sw(w.m) + esc(w.r.p.split(" ").slice(-1)[0].replace(/^(Jr\.?|III|II|IV)$/, w.r.p.split(" ").slice(-2)[0])) +
          (w.r.s || w.r.x ? " " + sum(w.r.s || w.r.x) : "") + "</span>";
      }).join("");
      return '<div class="sb-card ' + e.state + '">' + side(e.away) + side(e.home) + '<div class="sb-status">' + status + "</div>" + (chips ? '<div class="chips">' + chips + "</div>" : "") + "</div>";
    });
    return tiles.length ? '<div class="sb-grid">' + tiles.join("") + "</div>" : '<div class="empty">No Big Ten games today.</div>';
  }

  // ------------------------------------------------------------ season page
  function pageSeason(year, home) {
    var meta = IDX.seasons.filter(function (s) { return s.year === year; })[0];
    if (!meta) return notFound();
    var latest = IDX.seasons[IDX.seasons.length - 1].year;
    var current = year === latest && meta.status !== "final";
    return Promise.all([seasonFile(year), current ? scheduleFile(year) : null]).then(function (res) {
      var view = { year: year, meta: meta, base: res[0], sched: res[1], events: [], season: null, gameN: null, team: null, tview: "grid", race: "gap", home: home, current: current };
      view.season = current ? applyLive(view.base, view.sched, [], {}) : view.base;
      view.team = view.base.managers.filter(function (m) { return view.base.teams[m]; })[0];
      seasonShell(view);
      drawSeason(view);
      if (current) startLive(view);
    });
  }

  function seasonShell(view) {
    var meta = view.meta, season = view.base;
    var years = IDX.seasons.map(function (s) { return s.year; }).reverse();
    var ms = season.managers.filter(function (m) { return season.teams[m]; });
    var html = '<div class="page-head"><div>' + (view.home ? "" : '<div class="crumbs"><a href="#/season">Seasons</a></div>') +
      "<h1>" + esc(meta.label) + " season " + (view.current ? '<span class="badge live">live</span>' : "") + '</h1><div class="sub" id="s-sub"></div></div>' +
      (view.home ? "" : yearList(years, view.year, "season")) + "</div>";
    if (view.current) html += '<div id="live-banner" class="banner"></div>';
    html += '<div id="s-tiles"></div>';
    if (view.current) html += '<section class="card"><div class="card-head"><h2 id="sb-title">Today in the Big Ten</h2></div><div id="s-board"><div class="loading">Loading scores...</div></div></section>';
    html += '<section class="card"><div class="card-head"><h2>Standings</h2></div><div id="s-stand"></div></section>';
    if (view.current) html += '<section class="card"><div class="card-head"><h2>Who\'s playing</h2><span class="muted" style="font-size:13px">FP = fantasy points (PTS+REB+AST+STL+BLK)</span></div><div class="grid two" id="s-playing"></div></section>';
    html += '<section class="card"><div class="card-head"><h2>Race</h2>' + seg("race", [["gap", "Gap to leader"], ["total", "Cumulative"]], "gap") + '</div><div id="race"></div>' +
      '<details class="table-view"><summary>Score by game (table)</summary><div id="race-table"></div></details></section>';
    html += '<section class="card" id="games"></section>';
    html += '<section class="card"><div class="card-head"><h2>Team breakdown</h2>' + seg("team", ms.map(function (m) { return [m, m]; }), view.team) +
      '</div><div class="controls" style="margin-bottom:10px">' + seg("tview", [["grid", "Game grid"], ["players", "Player totals"]], "grid") + '</div><div id="tgrid"></div></section>';
    html += card("Draft &amp; pickups", draftBoard(season));
    if (meta.topAvg && meta.topAvg.length) html += '<div class="grid two">' + card("Top averages (min 5 games)", leaderTable(meta.topAvg, "avg")) + card("Top totals", leaderTable(meta.topTotal, "t")) + "</div>";
    var notes = season.notes || [];
    if (notes.length) html += card("Notes", '<ul class="notes">' + notes.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>");
    app.innerHTML = html;
    onSeg(app, "race", function (v) { view.race = v; drawRace(view); });
    onSeg(app, "team", function (v) { view.team = v; drawTeam(view); });
    onSeg(app, "tview", function (v) { view.tview = v; drawTeam(view); });
  }

  function drawSeason(view) {
    var season = view.season, meta = view.meta;
    var st = seasonStandings(season), started = st.some(function (r) { return r.score > 0; });
    var n = currentGame(season);
    var first = null;
    if (view.sched) Object.keys(view.sched).forEach(function (k) { var g = view.sched[k].games[0]; if (g && (!first || g.date < first)) first = g.date; });
    var final = meta.status === "final";
    document.getElementById("s-sub").innerHTML = final ? "Final &middot; " + season.slots + " games" + (meta.champion ? " &middot; Champion " + mgr(meta.champion) : "") :
      (started ? "Through game " + n + " of " + season.slots : "Season tips off " + (first ? esc(fmtDay(first)) : "soon")) + (season.lastUpdate ? " &middot; official stats " + esc(season.lastUpdate) : "");

    var tiles = "";
    if (started) {
      var high = { t: -1 };
      season.managers.forEach(function (m) {
        if (!season.teams[m]) return;
        teamSlotTotals(season.teams[m]).forEach(function (s, i) { if (s.t > high.t) high = { t: s.t, m: m, g: i + 1 }; });
      });
      var lines = [];
      season.managers.forEach(function (m) {
        if (!season.teams[m]) return;
        playerLines(season.teams[m]).forEach(function (l) { if (l.gp) lines.push({ p: l.p, m: m, t: l.t, gp: l.gp, avg: l.avg }); });
      });
      lines.sort(function (a, b) { return b.t - a.t; });
      var tp = lines[0];
      tiles = '<div class="tiles">' + tile(final ? "Champion" : "Leader", mgr(st[0].m), fmt(st[0].score) + " pts" + (st[1] ? " &middot; +" + fmt(st[0].score - st[1].score) : "")) +
        tile("Best single game", fmt(high.t), mgr(high.m) + " &middot; game " + high.g) +
        (tp ? tile("Top player", plink(tp.p), fmt(tp.t) + " &middot; " + mgr(tp.m)) : "") +
        (view.current ? tile("Playing now", String(st.reduce(function (a, r) { return a + r.now; }, 0)), st.reduce(function (a, r) { return a + r.later; }, 0) + " more later today") :
          meta.topAvg && meta.topAvg[0] ? tile("Top player (avg, 5+ GP)", plink(meta.topAvg[0].p), fmt1(meta.topAvg[0].avg) + " &middot; " + mgr(meta.topAvg[0].m)) : "") + "</div>";
    }
    document.getElementById("s-tiles").innerHTML = tiles;
    document.getElementById("s-stand").innerHTML = liveStandingsTable(st, view);
    if (view.current) {
      var pl = document.getElementById("s-playing");
      if (pl) pl.innerHTML = season.managers.filter(function (m) { return season.teams[m]; }).map(function (m) {
        var r = st.filter(function (x) { return x.m === m; })[0];
        return '<div class="card team-card"><h3>' + mgr(m) + '<span class="muted" style="font-size:13px;font-weight:500">' + (r.today ? "+" + r.today + " today" : "") + "</span></h3>" + playingCard(season, m) + "</div>";
      }).join("");
      var bd = document.getElementById("s-board");
      if (bd && view.loaded) bd.innerHTML = scoreboardCard(view.events, season);
      drawBanner(view);
    }
    drawRace(view);
    gameView(document.getElementById("games"), season, view.gameN || n || 1, function (x) { view.gameN = x; });
    drawTeam(view);
  }

  function liveStandingsTable(st, view) {
    if (!view.current) return standingsTable(st, { champ: view.meta.status === "final" });
    var lead = st[0].score, started = st.some(function (r) { return r.score > 0; });
    var rows = st.map(function (r) {
      var back = !started || r.place === 1 ? "--" : "-" + fmt(lead - r.score);
      var today = r.today ? "+" + fmt(r.today) : "";
      var playing = (r.now ? '<span class="live-dot"></span>' + r.now + " now" : "") + (r.later ? (r.now ? ", " : "") + r.later + " later" : "");
      return "<tr><td class='rank'>" + r.place + "</td><td>" + mgr(r.m) + "</td><td class='n strong'>" + fmt(r.score) + "</td><td class='n muted'>" + back + "</td><td class='n strong'>" + today + "</td><td class='muted'>" + playing + "</td>" +
        statCells(r.stats) + "<td class='n'>" + fmt(r.gp) + "</td><td class='n'>" + fmt1(r.avg) + "</td></tr>";
    });
    return table("<th></th><th>Team</th>" + th("Score", 1) + th("Back", 1) + th("Today", 1) + "<th>Playing</th>" + statHeads() + th("GP", 1) + th("Avg", 1), rows);
  }

  function drawRace(view) {
    var season = view.season, n = currentGame(season);
    resizeHandlers = [];
    raceChart(document.getElementById("race"), season, view.race);
    var ms = season.managers.filter(function (m) { return season.teams[m]; });
    var totals = {};
    ms.forEach(function (m) { totals[m] = teamSlotTotals(season.teams[m]); });
    var rt = [];
    for (var i = 0; i < n; i++) rt.push("<tr><td>" + (i + 1) + "</td>" + ms.map(function (m) { return "<td class='n'>" + (totals[m][i].any ? totals[m][i].t : "") + "</td>"; }).join("") + "</tr>");
    document.getElementById("race-table").innerHTML = rt.length ? table("<th>Game</th>" + ms.map(function (m) { return "<th class='n'>" + esc(m) + "</th>"; }).join(""), rt) : '<div class="empty">No games yet.</div>';
  }
  function drawTeam(view) {
    document.getElementById("tgrid").innerHTML = view.tview === "grid" ? teamGrid(view.season, view.team) : seasonPlayersTable(view.season, view.team);
  }
  function drawBanner(view) {
    var el = document.getElementById("live-banner");
    if (!el) return;
    var anyIn = view.events.some(function (e) { return e.state === "in"; });
    if (LIVE.demo) {
      el.innerHTML = '<b>Demo preview</b> &middot; mock data for ' + esc(LIVE.label || "") + ". Scores and box scores are simulated; the schedule is real. <a href=\"./\">Leave demo</a>";
      el.className = "banner demo";
    } else if (view.liveError) {
      el.innerHTML = "Live scores unavailable right now; showing official stats.";
      el.className = "banner";
    } else if (!view.loaded) {
      el.innerHTML = "Checking today's games...";
      el.className = "banner";
    } else {
      el.innerHTML = (anyIn ? '<span class="live-dot"></span><b>Live</b> &middot; ' : "") + "Scores updated " + esc(et(view.updated, { hour: "numeric", minute: "2-digit", second: "2-digit" })) +
        (anyIn ? " &middot; refreshing every 30 seconds" : "") + '. Live points are provisional until the nightly stats update.';
      el.className = "banner" + (anyIn ? " on" : "");
    }
  }

  function startLive(view) {
    clearTimeout(LIVE.timer);
    var teamIds = {};
    Object.keys(view.base.players || {}).forEach(function (k) { var t = view.base.players[k].teamId; if (t) teamIds[t] = 1; });
    function tick() {
      if (location.hash.replace(/^#\/?/, "") !== (view.home ? "" : "season/" + view.year)) return;  // navigated away
      fetchBoard().then(function (board) {
        var evs = normEvents(board);
        var need = evs.filter(function (e) { return e.state !== "pre" && (teamIds[e.home.id] || teamIds[e.away.id]); });
        return Promise.all(need.map(function (e) {
          return fetchBox(e.id).then(function (b) { return [e.id, parseBox(b)]; }).catch(function () { return [e.id, null]; });
        })).then(function (pairs) {
          var boxes = {};
          pairs.forEach(function (p) { if (p[1]) boxes[p[0]] = p[1]; });
          view.events = evs; view.loaded = true; view.liveError = false; view.updated = nowMs();
          view.season = applyLive(view.base, view.sched, evs, boxes);
          drawSeason(view);
          if (LIVE.demo) return;
          var anyIn = evs.some(function (e) { return e.state === "in"; }), anyPre = evs.some(function (e) { return e.state === "pre"; });
          if (anyIn || anyPre) LIVE.timer = setTimeout(tick, anyIn ? 30000 : 300000);
        });
      }).catch(function (e) {
        console.warn("live scores", e);
        view.liveError = true; view.loaded = true;
        drawBanner(view);
        var bd = document.getElementById("s-board");
        if (bd) bd.innerHTML = '<div class="empty">Couldn&rsquo;t load today&rsquo;s scores. Trying again shortly.</div>';
        LIVE.timer = setTimeout(tick, 120000);
      });
    }
    LIVE.tick = tick;
    tick();
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && LIVE.tick && !LIVE.demo) { clearTimeout(LIVE.timer); LIVE.tick(); }
  });

  function tile(label, value, note) {
    return '<div class="tile"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="note">' + (note || "") + "</div></div>";
  }
  function leaderTable(list, key) {
    return table("<th></th><th>Player</th><th>Owner</th>" + th("GP", 1) + th(key === "avg" ? "Avg" : "Total", 1), list.map(function (p, i) {
      return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + plink(p.p) + "</td><td>" + mgr(p.m) + "</td><td class='n'>" + p.gp + "</td><td class='n strong'>" + (key === "avg" ? fmt1(p.avg) : fmt(p.t)) + "</td></tr>";
    }));
  }

  function pageSeasons() {
    var rows = IDX.seasons.slice().reverse().map(function (s) {
      var st = s.standings;
      return "<tr><td><a href='#/season/" + s.year + "'>" + esc(s.label) + "</a>" + (s.status !== "final" ? ' <span class="badge live">live</span>' : "") + "</td>" +
        [0, 1, 2, 3].map(function (i) { return st[i] ? "<td>" + mgr(st[i].m) + " <span class='muted'>" + fmt(st[i].score) + "</span></td>" : "<td></td>"; }).join("") + "</tr>";
    });
    app.innerHTML = '<div class="page-head"><div><h1>Seasons</h1><div class="sub">Every regular season since 2015-16</div></div></div>' +
      card("", table("<th>Season</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th>", rows));
  }

  function pageMM(year) {
    var list = IDX.mm.filter(function (x) { return x.status !== "cancelled" || true; });
    if (!year) year = list.length ? list[list.length - 1].year : null;
    var meta = IDX.mm.filter(function (x) { return x.year === year; })[0];
    if (!meta) return notFound();
    var years = IDX.mm.map(function (x) { return x.year; }).reverse();
    return mmFile(year).then(function (mm) {
      var html = '<div class="page-head"><div><h1>' + year + " March Madness " + (meta.status === "live" ? '<span class="badge live">live</span>' : "") + "</h1>" +
        '<div class="sub">Separate draft of 7 NCAA tournament players; every game counts.' + (meta.champion ? " Champion " + mgr(meta.champion) : "") + "</div></div>" + yearList(years, year, "mm") + "</div>";
      if (meta.status === "cancelled") {
        app.innerHTML = html + card("", '<div class="empty">' + esc(meta.note || "Cancelled") + "</div>");
        return;
      }
      html += card("Standings", standingsTable(meta.standings, { champ: meta.status === "final" }));
      html += '<div class="grid two">' + mm.managers.filter(function (m) { return mm.teams[m]; }).map(function (m) {
        var team = mm.teams[m];
        var head = "<th>Player</th>";
        for (var i = 1; i <= mm.slots; i++) head += "<th class='n'>G" + i + "</th>";
        head += th("Tot", 1);
        var lines = {};
        playerLines(team).forEach(function (l) { lines[l.p] = l; });
        var names = team.draft.length ? team.draft : Object.keys(lines);
        var rows = names.map(function (p) {
          var cells = team.games.map(function (g, gi) {
            var r = g.filter(function (x) { return x.p === p; })[0];
            if (!r || !r.s) return "<td class='n muted'></td>";
            return "<td class='n' title='" + esc("G" + (gi + 1) + " " + (r.o || "") + ": " + r.s.join("-")) + "'>" + sum(r.s) + "</td>";
          }).join("");
          return "<tr><td>" + plink(p) + "</td>" + cells + "<td class='n strong'>" + fmt(lines[p] ? lines[p].t : 0) + "</td></tr>";
        });
        var tot = teamSlotTotals(team);
        rows.push("<tr class='total'><td>Total</td>" + tot.map(function (s) { return "<td class='n'>" + (s.any ? s.t : "") + "</td>"; }).join("") +
          "<td class='n'>" + fmt(sum(tot.map(function (s) { return s.t; }))) + "</td></tr>");
        return '<div class="card"><h3 style="margin-bottom:8px">' + mgr(m) + "</h3>" + table(head, rows, "box") + "</div>";
      }).join("") + "</div>";
      app.innerHTML = html;
    });
  }

  function pageHistory() {
    var finals = IDX.seasons.filter(function (s) { return s.status === "final"; });
    var at = IDX.alltime;
    var html = '<div class="page-head"><div><h1>League history</h1><div class="sub">' + finals.length + " completed seasons since 2015-16</div></div></div>";
    html += '<div class="grid four" style="margin-bottom:16px">' + at.slice().sort(function (a, b) { return b.titles.length - a.titles.length || b.t - a.t; }).map(function (a) {
      return '<div class="card"><h3 style="margin-bottom:8px">' + mgr(a.m) + '</h3><div style="font-size:28px;font-weight:700">' + a.titles.length +
        ' <span style="font-size:14px;font-weight:500" class="muted">title' + (a.titles.length === 1 ? "" : "s") + "</span></div>" +
        '<div class="muted" style="font-size:13px">' + (a.titles.length ? a.titles.map(seasonLabel).join(", ") : "&nbsp;") + "</div>" +
        '<dl class="kv" style="margin-top:10px"><dt>Finishes</dt><dd>' + a.places.map(function (c, i) { return c + "&times;" + ord(i + 1); }).join(" &middot; ") +
        "</dd><dt>March Madness</dt><dd>" + a.mmTitles.length + " title" + (a.mmTitles.length === 1 ? "" : "s") + (a.mmTitles.length ? " (" + a.mmTitles.join(", ") + ")" : "") + "</dd></dl></div>";
    }).join("") + "</div>";

    var rows = finals.slice().reverse().map(function (s) {
      return "<tr><td><a href='#/season/" + s.year + "'>" + esc(s.label) + "</a></td>" + [0, 1, 2, 3].map(function (i) {
        var r = s.standings[i];
        return r ? "<td>" + mgr(r.m) + " <span class='muted'>" + fmt(r.score) + "</span></td>" : "<td></td>";
      }).join("") + "</tr>";
    });
    html += card("Season results", table("<th>Season</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th>", rows));
    html += '<section class="card"><div class="card-head"><h2>Score by season</h2>' + seg("hmetric", [["score", "Season score"], ["avg", "Per-player avg"]], "score") +
      '</div><div id="hist-chart"></div><p class="muted" style="font-size:12px;margin:8px 0 0">2020-21 was a 27-game COVID season; per-player average evens that out.</p></section>';

    var mmRows = IDX.mm.slice().reverse().map(function (s) {
      if (s.status === "cancelled") return "<tr><td><a href='#/mm/" + s.year + "'>" + s.year + "</a></td><td colspan='4' class='muted'>" + esc(s.note || "Cancelled") + "</td></tr>";
      return "<tr><td><a href='#/mm/" + s.year + "'>" + s.year + "</a></td>" + [0, 1, 2, 3].map(function (i) {
        var r = s.standings[i];
        return r ? "<td>" + mgr(r.m) + " <span class='muted'>" + fmt(r.score) + "</span></td>" : "<td></td>";
      }).join("") + "</tr>";
    });
    html += card("March Madness results", table("<th>Year</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th>", mmRows));

    var atRows = at.slice().sort(function (a, b) { return b.t - a.t; }).map(function (a) {
      return "<tr><td>" + mgr(a.m) + "</td><td class='n'>" + a.seasons + "</td><td class='n strong'>" + fmt(a.t) + "</td>" + statCells(a.s) +
        "<td class='n'>" + fmt(a.gp) + "</td><td class='n'>" + fmt1(a.gp ? a.t / a.gp : 0) + "</td></tr>";
    });
    html += card("All-time totals (regular season)", table("<th>Team</th>" + th("Seasons", 1) + th("Score", 1) + statHeads() + th("GP", 1) + th("Avg", 1), atRows));

    app.innerHTML = html;

    var metric = "score";
    var drawH = function () {
      resizeHandlers = [];
      lineChart(document.getElementById("hist-chart"), {
        xs: finals.map(function (s) { return s.label; }),
        series: IDX.managers.map(function (m) {
          return { name: m, color: mcolor(m), values: finals.map(function (s) {
            var r = s.standings.filter(function (x) { return x.m === m; })[0];
            return r ? (metric === "score" ? r.score : r.avg) : null;
          }) };
        }),
        fmt: metric === "score" ? fmt : fmt1,
        title: "Score by season",
      });
    };
    drawH();
    onSeg(app, "hmetric", function (v) { metric = v; drawH(); });
  }

  function pageRecords() {
    var R = IDX.records;
    var groups = [["teamSeason", "Team season"], ["teamGame", "Team single game"], ["playerSeason", "Player season"], ["playerGame", "Player single game"],
      ["playerAvg", "Season average"], ["career", "Career"], ["mm", "March Madness"]];
    var cats = [["t", "Total"]].concat(STATS.map(function (k) { return [k, LABEL[k]]; }));
    var g = "teamSeason", c = "t";
    app.innerHTML = '<div class="page-head"><div><h1>Records</h1><div class="sub">Top 10 all-time (live season included)</div></div></div>' +
      '<section class="card"><div class="controls" style="margin-bottom:10px">' + seg("rg", groups, g) + '</div><div class="controls" id="rc-wrap" style="margin-bottom:12px">' + seg("rc", cats, c) + '</div><div id="rec"></div></section>';
    var el = document.getElementById("rec"), cw = document.getElementById("rc-wrap");
    function val(x, k) { return k === "t" ? x.t : x[k]; }
    function draw() {
      var hasCat = g === "teamSeason" || g === "teamGame" || g === "playerSeason" || g === "career";
      cw.style.display = hasCat ? "" : "none";
      var list, head, rows;
      if (g === "teamSeason" || g === "teamGame") {
        list = R[g][c];
        head = "<th></th><th>Team</th><th>Season</th>" + (g === "teamGame" ? th("Game", 1) : "") + th(LABEL[c], 1) + (c !== "t" ? th("Total", 1) : "");
        rows = list.map(function (x, i) {
          return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + mgr(x.m) + "</td><td><a href='#/season/" + x.year + "'>" + seasonLabel(x.year) + "</a>" + (x.live ? ' <span class="badge live">live</span>' : "") + "</td>" +
            (g === "teamGame" ? "<td class='n'>" + x.game + "</td>" : "") + "<td class='n strong'>" + fmt(val(x, c)) + "</td>" + (c !== "t" ? "<td class='n muted'>" + fmt(x.t) + "</td>" : "") + "</tr>";
        });
      } else if (g === "playerSeason") {
        list = R.playerSeason[c];
        head = "<th></th><th>Player</th><th>Owner</th><th>Season</th>" + th("GP", 1) + th(LABEL[c], 1) + (c !== "t" ? th("Total", 1) : "");
        rows = list.map(function (x, i) {
          return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + plink(x.p) + "</td><td>" + mgr(x.m) + "</td><td><a href='#/season/" + x.year + "'>" + seasonLabel(x.year) + "</a></td><td class='n'>" + x.gp +
            "</td><td class='n strong'>" + fmt(val(x, c)) + "</td>" + (c !== "t" ? "<td class='n muted'>" + fmt(x.t) + "</td>" : "") + "</tr>";
        });
      } else if (g === "playerGame") {
        head = "<th></th><th>Player</th><th>Owner</th><th>Season</th>" + th("Game", 1) + "<th>Opp</th>" + statHeads() + th("Total", 1);
        rows = R.playerGame.map(function (x, i) {
          return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + plink(x.p) + "</td><td>" + mgr(x.m) + "</td><td>" + seasonLabel(x.year) + "</td><td class='n'>" + x.game + "</td><td class='muted'>" + esc(x.o || "") + "</td>" +
            statCells(x.s) + "<td class='n strong'>" + x.t + "</td></tr>";
        });
      } else if (g === "playerAvg") {
        head = "<th></th><th>Player</th><th>Owner</th><th>Season</th>" + th("GP", 1) + th("Total", 1) + th("Avg", 1);
        rows = R.playerAvg.map(function (x, i) {
          return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + plink(x.p) + "</td><td>" + mgr(x.m) + "</td><td>" + seasonLabel(x.year) + "</td><td class='n'>" + x.gp + "</td><td class='n'>" + fmt(x.t) + "</td><td class='n strong'>" + fmt1(x.avg) + "</td></tr>";
        });
      } else if (g === "career") {
        list = c === "t" ? R.careerTotal : R["career_" + c];
        head = "<th></th><th>Player</th><th>Owner</th>" + th("GP", 1) + th(LABEL[c], 1);
        rows = list.map(function (x, i) {
          return "<tr><td class='rank'>" + (i + 1) + "</td><td><a href='#/player/" + encodeURIComponent(x.key) + "'>" + esc(x.name) + "</a></td><td>" + mgr(x.owner) + "</td><td class='n'>" + x.gp + "</td><td class='n strong'>" + fmt(x.t) + "</td></tr>";
        });
      } else {
        el.innerHTML = '<div class="grid two"><div><h3 style="margin-bottom:8px">Best team tournaments</h3>' +
          table("<th></th><th>Team</th><th>Year</th>" + th("Total", 1), R.mmTeam.map(function (x, i) {
            return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + mgr(x.m) + "</td><td><a href='#/mm/" + x.year + "'>" + x.year + "</a></td><td class='n strong'>" + fmt(x.t) + "</td></tr>";
          })) + '</div><div><h3 style="margin-bottom:8px">Best player tournaments</h3>' +
          table("<th></th><th>Player</th><th>Owner</th><th>Year</th>" + th("GP", 1) + th("Total", 1), R.mmPlayer.map(function (x, i) {
            return "<tr><td class='rank'>" + (i + 1) + "</td><td>" + plink(x.p) + "</td><td>" + mgr(x.m) + "</td><td>" + x.year + "</td><td class='n'>" + x.gp + "</td><td class='n strong'>" + fmt(x.t) + "</td></tr>";
          })) + "</div></div>";
        return;
      }
      el.innerHTML = table(head, rows);
    }
    draw();
    onSeg(app, "rg", function (v) { g = v; draw(); });
    onSeg(app, "rc", function (v) { c = v; draw(); });
  }

  var STATUS = { hof: ["Hall of Fame", "hof"], active: ["Active", "live"], ballot: ["On ballot", ""], eligible: ["HOF eligible", ""], ineligible: ["", ""] };
  function statusBadge(s) { var x = STATUS[s]; return x && x[0] ? '<span class="badge ' + x[1] + '">' + x[0] + "</span>" : ""; }

  function pageHof() {
    var H = IDX.hof || {}, byKey = {};
    IDX.players.forEach(function (p) { byKey[p.key] = p; });
    var members = (H.members || []).slice().sort(function (a, b) { return b.inducted - a.inducted || b.vote - a.vote; });
    var mRows = members.map(function (h) {
      var p = byKey[pkey(h.player)] || {};
      return "<tr><td>" + plink(h.player) + "</td><td>" + mgr(h.owner) + "</td><td>" + (p.schools && p.schools.length ? p.schools : [p.school]).filter(Boolean).map(slink).join(" / ") + "</td><td>" + esc(h.years) + "</td><td>" + h.inducted + " <span class='muted'>(" + h.vote + "%)</span></td>" +
        "<td class='n'>" + fmt(p.gp) + "</td><td class='n strong'>" + fmt(p.t) + "</td><td class='n'>" + fmt1(p.avg) + "</td><td class='n'>" + (p.rings || 0) + "</td></tr>";
    });
    var years = Object.keys(H.ballots || {}).sort().reverse();
    var by = years[0];
    app.innerHTML = '<div class="page-head"><div><h1>Hall of Fame</h1><div class="sub">' + members.length + " inductees</div></div></div>" +
      card("Members", table("<th>Player</th><th>Owner</th><th>School</th><th>Years</th><th>Inducted</th>" + th("GP", 1) + th("Total", 1) + th("Avg", 1) + th("Rings", 1), mRows)) +
      '<section class="card"><div class="card-head"><h2>Ballots</h2><select id="ballot-y" aria-label="Ballot year">' + years.map(function (y) { return "<option>" + y + "</option>"; }).join("") + '</select></div><div id="ballot"></div></section>' +
      card("Eligible, not yet nominated", eligibleTable()) +
      card("Rules", '<ul class="notes">' + (H.rules || []).map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>");
    function draw() {
      var list = (H.ballots[by] || []).filter(function (b) { return b.player; });
      document.getElementById("ballot").innerHTML = list.length ? table("<th>Player</th><th>Owner</th><th>Years</th>" + th("Yrs on ballot", 1) + th("GP", 1) + th("Total", 1) + th("Avg", 1), list.map(function (b) {
        var p = byKey[pkey(b.player)] || {};
        return "<tr><td>" + plink(b.player) + " " + (p.status === "hof" ? statusBadge("hof") : "") + "</td><td>" + mgr(b.owner) + "</td><td>" + esc(b.years) + "</td><td class='n'>" + esc(b.yearsOnBallot || "") +
          "</td><td class='n'>" + fmt(p.gp) + "</td><td class='n strong'>" + fmt(p.t) + "</td><td class='n'>" + fmt1(p.avg) + "</td></tr>";
      })) : '<div class="empty">No nominations recorded.</div>';
    }
    draw();
    document.getElementById("ballot-y").addEventListener("change", function (e) { by = e.target.value; draw(); });
  }
  function eligibleTable() {
    var list = IDX.players.filter(function (p) { return p.status === "eligible" || p.status === "ballot"; }).slice(0, 25);
    if (!list.length) return '<div class="empty">Nobody.</div>';
    return table("<th>Player</th><th>Owner</th><th>Years</th>" + th("GP", 1) + th("Total", 1) + th("Avg", 1), list.map(function (p) {
      return "<tr><td><a href='#/player/" + encodeURIComponent(p.key) + "'>" + esc(p.name) + "</a> " + statusBadge(p.status) + "</td><td>" + mgr(p.owner) + "</td><td>" + yearsText(p.years) + "</td><td class='n'>" + p.gp + "</td><td class='n strong'>" + fmt(p.t) + "</td><td class='n'>" + fmt1(p.avg) + "</td></tr>";
    })) + '<p class="muted" style="font-size:12px;margin:8px 0 0">More than 20 games and 500 total points, career over.</p>';
  }
  function yearsText(ys) { return ys.length ? (ys[0] === ys[ys.length - 1] ? String(ys[0]) : ys[0] + "-" + ys[ys.length - 1]) : ""; }

  function pagePlayers() {
    var sortK = "t", dir = -1, q = "", own = "", stat = "";
    app.innerHTML = '<div class="page-head"><div><h1>Players</h1><div class="sub">Everyone who\'s been rostered, regular season careers</div></div></div>' +
      '<section class="card"><div class="controls" style="margin-bottom:12px"><input type="search" id="q" placeholder="Search player or school" aria-label="Search">' +
      '<select id="own" aria-label="Owner"><option value="">All owners</option>' + IDX.managers.map(function (m) { return "<option>" + m + "</option>"; }).join("") + "</select>" +
      '<select id="stat" aria-label="Status"><option value="">All players</option><option value="active">Active</option><option value="hof">Hall of Fame</option><option value="eligible">HOF eligible</option><option value="mmOnly">March Madness only</option></select>' +
      '<span class="muted" id="count" style="font-size:13px"></span></div><div id="ptable"></div></section>';
    var cols = [["name", "Player", 0], ["school", "School", 0], ["years", "Years", 0], ["owner", "Owner", 0], ["gp", "GP", 1],
      ["pts", "PTS", 1], ["reb", "REB", 1], ["ast", "AST", 1], ["stl", "STL", 1], ["blk", "BLK", 1], ["t", "Total", 1], ["avg", "Avg", 1], ["rings", "Rings", 1]];
    function v(p, k) {
      var i = STATS.indexOf(k);
      if (i >= 0) return p.s[i];
      if (k === "years") return p.years[0];
      return p[k] == null ? "" : p[k];
    }
    function draw() {
      var ql = q.toLowerCase();
      var list = IDX.players.filter(function (p) {
        if (own && p.owners.indexOf(own) < 0) return false;
        if (p.status === "mmOnly" && stat !== "mmOnly") return false;
        if (stat === "eligible" ? !(p.status === "eligible" || p.status === "ballot") : stat && p.status !== stat) return false;
        return !ql || p.name.toLowerCase().indexOf(ql) >= 0 || (p.schools || []).concat([p.school]).join(" ").toLowerCase().indexOf(ql) >= 0;
      }).sort(function (a, b) {
        var x = v(a, sortK), y = v(b, sortK);
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
      });
      document.getElementById("count").textContent = list.length + " players";
      var head = cols.map(function (c) {
        return '<th class="sortable ' + (c[2] ? "n " : "") + (c[0] === sortK ? "sorted" : "") + '" data-k="' + c[0] + '">' + c[1] + (c[0] === sortK ? (dir < 0 ? " &darr;" : " &uarr;") : "") + "</th>";
      }).join("");
      var rows = list.map(function (p) {
        return "<tr><td><a href='#/player/" + encodeURIComponent(p.key) + "'>" + esc(p.name) + "</a> " + (p.status === "hof" || p.status === "active" ? statusBadge(p.status) : "") + "</td><td>" + (p.schools && p.schools.length ? p.schools : [p.school]).filter(Boolean).map(slink).join(" / ") +
          "</td><td>" + yearsText(p.years) + "</td><td>" + mgr(p.owner) + "</td><td class='n'>" + p.gp + "</td>" + statCells(p.s) + "<td class='n strong'>" + fmt(p.t) + "</td><td class='n'>" + fmt1(p.avg) + "</td><td class='n'>" + (p.rings || "") + "</td></tr>";
      });
      var el = document.getElementById("ptable");
      el.innerHTML = table(head, rows);
      el.querySelectorAll("th.sortable").forEach(function (h) {
        h.addEventListener("click", function () {
          var k = h.getAttribute("data-k");
          if (k === sortK) dir = -dir; else { sortK = k; dir = ["name", "school", "owner"].indexOf(k) >= 0 ? 1 : -1; }
          draw();
        });
      });
    }
    draw();
    document.getElementById("q").addEventListener("input", function (e) { q = e.target.value; draw(); });
    document.getElementById("own").addEventListener("change", function (e) { own = e.target.value; draw(); });
    document.getElementById("stat").addEventListener("change", function (e) { stat = e.target.value; draw(); });
  }

  function pagePlayer(key) {
    var p = IDX.players.filter(function (x) { return x.key === key; })[0];
    if (!p) return notFound("Player not found.");
    var html = '<div class="page-head"><div><div class="crumbs"><a href="#/players">Players</a></div><h1>' + esc(p.name) + " " + statusBadge(p.status) + "</h1>" +
      '<div class="sub">' + (p.schools && p.schools.length ? p.schools : [p.school]).filter(Boolean).map(slink).join(" &rarr; ") + (p.school ? " &middot; " : "") + (p.years.length ? yearsText(p.years) : "March Madness only") + " &middot; " + p.owners.map(mgr).join(", ") + "</div></div></div>";
    if (p.status === "mmOnly") {
      var mt = p.mm.reduce(function (a, s) { return a + s.t; }, 0);
      html += '<div class="tiles">' + tile("March Madness games", fmt(p.mm.reduce(function (a, s) { return a + s.gp; }, 0)), "") + tile("March Madness total", fmt(mt), "") + "</div>";
      html += card("March Madness", mmTable(p));
      app.innerHTML = html;
      return;
    }
    html += '<div class="tiles">' + tile("Games", fmt(p.gp), p.zero ? p.zero + " zero-point game" + (p.zero > 1 ? "s" : "") : "") + tile("Career total", fmt(p.t), p.s.map(function (v, i) { return fmt(v) + " " + LABEL[STATS[i]].toLowerCase(); }).join(" &middot; ")) +
      tile("Per game", fmt1(p.avg), "") + tile("Rings", String(p.rings || 0), p.rings ? "won the league with this player" : "") + "</div>";
    var sRows = p.seasons.map(function (s) {
      return "<tr><td><a href='#/season/" + s.year + "'>" + seasonLabel(s.year) + "</a></td><td>" + slink(s.school) + "</td><td>" + mgr(s.m) + "</td><td class='n'>" + s.gp + "</td>" + statCells(s.s) + "<td class='n strong'>" + fmt(s.t) + "</td><td class='n'>" + fmt1(s.gp ? s.t / s.gp : 0) + "</td></tr>";
    });
    sRows.push("<tr class='total'><td>Career</td><td></td><td></td><td class='n'>" + p.gp + "</td>" + statCells(p.s) + "<td class='n'>" + fmt(p.t) + "</td><td class='n'>" + fmt1(p.avg) + "</td></tr>");
    html += card("By season", table("<th>Season</th><th>School</th><th>Owner</th>" + th("GP", 1) + statHeads() + th("Total", 1) + th("Avg", 1), sRows));
    if (p.mm && p.mm.length) html += card("March Madness", mmTable(p));
    html += '<section class="card"><div class="card-head"><h2>Game log</h2></div><div id="glog" class="loading">Loading games...</div></section>';
    app.innerHTML = html;
    Promise.all(p.years.map(seasonFile)).then(function (files) {
      var rows = [];
      files.forEach(function (season) {
        season.managers.forEach(function (m) {
          var t = season.teams[m];
          if (!t) return;
          t.games.forEach(function (g, gi) {
            g.forEach(function (r) {
              if (!r.p || pkey(r.p) !== key || r.st === "pending") return;
              var tag = badge(r);
              rows.push("<tr class='" + (r.s ? "" : "nc") + "'><td>" + seasonLabel(season.year) + "</td><td class='n'>" + (gi + 1) + "</td><td>" + mgr(m) + "</td><td class='muted'>" + esc(r.o || "") + "</td>" +
                (r.s ? statCells(r.s) + "<td class='n strong'>" + sum(r.s) + "</td>" : "<td colspan='5' class='muted' style='text-align:center'>" + (r.x ? r.x.join("-") + " (not counted)" : r.st === "dnp" ? "DNP" : "-") + "</td><td></td>") + "<td>" + tag + "</td></tr>");
            });
          });
        });
      });
      var el = document.getElementById("glog");
      el.className = "";
      el.innerHTML = rows.length ? table("<th>Season</th>" + th("Game", 1) + "<th>Owner</th><th>Opp</th>" + statHeads() + th("Tot", 1) + "<th></th>", rows, "box") : '<div class="empty">No games.</div>';
    });
  }

  function mmTable(p) {
    return table("<th>Year</th><th>Owner</th>" + th("GP", 1) + statHeads() + th("Total", 1), p.mm.map(function (s) {
      return "<tr><td><a href='#/mm/" + s.year + "'>" + s.year + "</a></td><td>" + mgr(s.m) + "</td><td class='n'>" + s.gp + "</td>" + statCells(s.s) + "<td class='n strong'>" + fmt(s.t) + "</td></tr>";
    }));
  }

  // ------------------------------------------------------------ Big Ten teams
  // Everything here is per season: a transfer's seasons count for the school
  // he played for that year (index season lines carry their own school).
  function schoolCareers(school) {
    var champ = {};
    IDX.seasons.forEach(function (s) { if (s.champion) champ[s.year] = s.champion; });
    var latest = IDX.seasons[IDX.seasons.length - 1].year;
    return IDX.players.map(function (p) {
      var lines = p.seasons.filter(function (x) { return x.school === school; });
      if (!lines.length) return null;
      var c = { p: p, lines: lines, gp: 0, s: [0, 0, 0, 0, 0], t: 0, owners: [], years: [], rings: 0 };
      lines.forEach(function (x) {
        c.gp += x.gp; c.s = add(c.s, x.s); c.t += x.t;
        if (c.owners.indexOf(x.m) < 0) c.owners.push(x.m);
        if (c.years.indexOf(x.year) < 0) c.years.push(x.year);
        if (x.gp && champ[x.year] === x.m) c.rings++;
      });
      c.avg = c.gp ? c.t / c.gp : 0;
      c.active = p.status === "active" && c.years.indexOf(latest) >= 0;
      c.moved = p.schools && p.schools.length > 1;
      return c;
    }).filter(Boolean).sort(function (a, b) { return b.t - a.t; });
  }
  function pageTeams() {
    var names = {};
    IDX.players.forEach(function (p) { p.seasons.forEach(function (x) { if (x.school) names[x.school] = 1; }); });
    var list = Object.keys(names).map(function (school) {
      var cs = schoolCareers(school), owners = {};
      var b = { school: school, n: cs.length, t: 0, gp: 0, best: cs[0],
        hof: cs.filter(function (c) { return c.p.status === "hof"; }).length, active: cs.filter(function (c) { return c.active; }).length };
      cs.forEach(function (c) { b.t += c.t; b.gp += c.gp; c.lines.forEach(function (x) { owners[x.m] = (owners[x.m] || 0) + x.t; }); });
      b.topOwner = Object.keys(owners).sort(function (x, y) { return owners[y] - owners[x]; })[0];
      return b;
    }).sort(function (a, b) { return b.t - a.t; });
    var rows = list.map(function (b, i) {
      return "<tr><td class='rank'>" + (i + 1) + "</td><td class='strong'>" + slink(b.school) + "</td><td class='n'>" + b.n + "</td><td class='n'>" + b.active + "</td><td class='n'>" + b.hof +
        "</td><td class='n'>" + fmt(b.gp) + "</td><td class='n strong'>" + fmt(b.t) + "</td><td class='n'>" + fmt1(b.gp ? b.t / b.gp : 0) + "</td><td><a href='#/player/" + encodeURIComponent(b.best.p.key) + "'>" + esc(b.best.p.name) +
        "</a></td><td>" + mgr(b.topOwner) + "</td></tr>";
    });
    app.innerHTML = '<div class="page-head"><div><h1>Big Ten teams</h1><div class="sub">Fantasy production from each school&rsquo;s drafted players since 2015-16. Transfers count for the school they played for that season.</div></div></div>' +
      card("", table("<th></th><th>School</th>" + th("Players", 1) + th("Active", 1) + th("HOF", 1) + th("GP", 1) + th("Fantasy pts", 1) + th("Avg", 1) + "<th>Best player</th><th>Top owner</th>", rows));
  }

  function pageTeam(school) {
    var cs = schoolCareers(school);
    if (!cs.length) return notFound("No drafted players from " + school + ".");
    var t = 0, gp = 0, s = [0, 0, 0, 0, 0], owners = {};
    cs.forEach(function (c) {
      t += c.t; gp += c.gp; s = add(s, c.s);
      c.lines.forEach(function (x) { owners[x.m] = (owners[x.m] || 0) + x.t; });
    });
    var html = '<div class="page-head"><div><div class="crumbs"><a href="#/teams">Teams</a></div><h1 style="display:flex;align-items:center;gap:12px">' + logo(school, 40) + esc(school) + '</h1><div class="sub">' + cs.length + " drafted players</div></div></div>";
    html += '<div class="tiles">' + tile("Fantasy points", fmt(t), fmt(gp) + " games &middot; " + fmt1(gp ? t / gp : 0) + " per game") +
      tile("Best player", '<a href="#/player/' + encodeURIComponent(cs[0].p.key) + '">' + esc(cs[0].p.name) + "</a>", fmt(cs[0].t) + " pts at " + esc(school)) +
      tile("Hall of Famers", String(cs.filter(function (c) { return c.p.status === "hof"; }).length), "") +
      tile("Active", String(cs.filter(function (c) { return c.active; }).length), "on a current roster") + "</div>";
    var rows = cs.map(function (c) {
      var p = c.p;
      var other = c.moved ? ' <span class="muted" style="font-size:12px" title="Transferred">also ' + p.schools.filter(function (x) { return x !== school; }).map(slink).join(", ") + "</span>" : "";
      return "<tr><td><a href='#/player/" + encodeURIComponent(p.key) + "'>" + esc(p.name) + "</a> " + (c.active ? statusBadge("active") : p.status === "hof" ? statusBadge("hof") : "") + other + "</td><td>" + yearsText(c.years) +
        "</td><td>" + c.owners.map(mgr).join(" ") + "</td><td class='n'>" + c.gp + "</td>" + statCells(c.s) + "<td class='n strong'>" + fmt(c.t) + "</td><td class='n'>" + fmt1(c.avg) + "</td><td class='n'>" + (c.rings || "") + "</td></tr>";
    });
    rows.push("<tr class='total'><td>Total</td><td></td><td></td><td class='n'>" + fmt(gp) + "</td>" + statCells(s) + "<td class='n'>" + fmt(t) + "</td><td class='n'>" + fmt1(gp ? t / gp : 0) + "</td><td></td></tr>");
    html += card("Players", table("<th>Player</th><th>Years</th><th>Owner</th>" + th("GP", 1) + statHeads() + th("Total", 1) + th("Avg", 1) + th("Rings", 1), rows));
    var seasons = {};
    cs.forEach(function (c) { c.lines.forEach(function (x) { (seasons[x.year] = seasons[x.year] || []).push({ p: c.p, x: x }); }); });
    var sRows = Object.keys(seasons).sort().reverse().map(function (y) {
      var list = seasons[y].sort(function (a, b) { return b.x.t - a.x.t; });
      return "<tr><td><a href='#/season/" + y + "'>" + seasonLabel(Number(y)) + "</a></td><td class='n strong'>" + fmt(list.reduce(function (a, o) { return a + o.x.t; }, 0)) + "</td><td style='white-space:normal'>" +
        list.map(function (o) { return sw(o.x.m) + " <a href='#/player/" + encodeURIComponent(o.p.key) + "'>" + esc(o.p.name) + "</a> <span class='muted'>" + fmt(o.x.t) + "</span>"; }).join(" &nbsp; ") + "</td></tr>";
    });
    var oRows = Object.keys(owners).sort(function (a, b) { return owners[b] - owners[a]; }).map(function (m) {
      return "<tr><td>" + mgr(m) + "</td><td class='n strong'>" + fmt(owners[m]) + "</td></tr>";
    });
    html += '<div class="grid two">' + card("By season", table("<th>Season</th>" + th("Pts", 1) + "<th>Players</th>", sRows)) + card("Points by owner", table("<th>Owner</th>" + th("Fantasy pts", 1), oRows)) + "</div>";
    app.innerHTML = html;
  }

  function pageManager(m) {
    if (IDX.managers.indexOf(m) < 0) return notFound();
    var a = IDX.alltime.filter(function (x) { return x.m === m; })[0];
    var seasons = IDX.seasons.map(function (s) {
      var r = s.standings.filter(function (x) { return x.m === m; })[0];
      return r ? { s: s, r: r } : null;
    }).filter(Boolean);
    var best = seasons.filter(function (x) { return x.s.status === "final"; }).sort(function (x, y) { return y.r.score - x.r.score; })[0];
    var html = '<div class="page-head"><div><h1 style="display:flex;align-items:center;gap:10px"><span class="sw" style="width:18px;height:18px;border-radius:5px;background:' + mcolor(m) + '"></span>' + esc(m) + "</h1>" +
      '<div class="sub">' + a.seasons + " seasons</div></div></div>";
    html += '<div class="tiles">' + tile("Titles", String(a.titles.length), a.titles.map(seasonLabel).join(", ")) + tile("March Madness titles", String(a.mmTitles.length), a.mmTitles.join(", ")) +
      tile("All-time score", fmt(a.t), fmt1(a.gp ? a.t / a.gp : 0) + " per player-game") + (best ? tile("Best season", fmt(best.r.score), best.s.label) : "") + "</div>";
    html += card("Season by season", table("<th>Season</th><th>Finish</th>" + th("Score", 1) + statHeads() + th("Avg", 1), seasons.slice().reverse().map(function (x) {
      return "<tr><td><a href='#/season/" + x.s.year + "'>" + esc(x.s.label) + "</a></td><td>" + (x.s.status === "final" ? (x.r.place === 1 ? '<span class="trophy">&#9733;</span> ' : "") + ord(x.r.place) : '<span class="badge live">live</span> ' + (x.s.standings.some(function (r) { return r.score; }) ? ord(x.r.place) : "")) +
        "</td><td class='n strong'>" + fmt(x.r.score) + "</td>" + statCells(x.r.stats) + "<td class='n'>" + fmt1(x.r.avg) + "</td></tr>";
    })));
    var tops = IDX.players.map(function (p) {
      var gp = 0, t = 0, ys = [];
      p.seasons.forEach(function (s) { if (s.m === m) { gp += s.gp; t += s.t; ys.push(s.year); } });
      return { p: p, gp: gp, t: t, ys: ys };
    }).filter(function (x) { return x.gp; }).sort(function (x, y) { return y.t - x.t; }).slice(0, 15);
    html += '<div class="grid two">' + card("Best players for " + esc(m), table("<th></th><th>Player</th><th>Years</th>" + th("GP", 1) + th("Total", 1), tops.map(function (x, i) {
      return "<tr><td class='rank'>" + (i + 1) + "</td><td><a href='#/player/" + encodeURIComponent(x.p.key) + "'>" + esc(x.p.name) + "</a></td><td>" + yearsText(x.ys) + "</td><td class='n'>" + x.gp + "</td><td class='n strong'>" + fmt(x.t) + "</td></tr>";
    }))) + card("March Madness", table("<th>Year</th><th>Finish</th>" + th("Score", 1), IDX.mm.slice().reverse().filter(function (s) { return s.status !== "cancelled"; }).map(function (s) {
      var r = s.standings.filter(function (x) { return x.m === m; })[0];
      return r ? "<tr><td><a href='#/mm/" + s.year + "'>" + s.year + "</a></td><td>" + (r.place === 1 && s.status === "final" ? '<span class="trophy">&#9733;</span> ' : "") + ord(r.place) + "</td><td class='n'>" + fmt(r.score) + "</td></tr>" : "";
    }))) + "</div>";
    app.innerHTML = html;
  }

  function notFound(msg) {
    app.innerHTML = '<div class="empty" style="padding:60px 0">' + esc(msg || "Page not found.") + ' <a href="#/">Back to standings</a></div>';
  }

  // ------------------------------------------------------------ router
  function route() {
    resizeHandlers = [];
    clearTimeout(LIVE.timer);
    LIVE.tick = null;
    var parts = (location.hash.replace(/^#\/?/, "") || "").split("/").map(decodeURIComponent);
    var page = parts[0] || "home";
    document.querySelectorAll("#nav a").forEach(function (a) {
      var nav = a.getAttribute("data-nav");
      a.classList.toggle("on", nav === page || (page === "manager" && nav === "history") || (page === "player" && nav === "players") || (page === "team" && nav === "teams"));
    });
    var latest = IDX.seasons[IDX.seasons.length - 1].year;
    var p;
    try {
      if (page === "home") p = pageSeason(latest, true);
      else if (page === "season") p = parts[1] ? pageSeason(Number(parts[1])) : pageSeasons();
      else if (page === "mm") p = pageMM(parts[1] ? Number(parts[1]) : null);
      else if (page === "history") p = pageHistory();
      else if (page === "records") p = pageRecords();
      else if (page === "players") p = pagePlayers();
      else if (page === "player") p = pagePlayer(parts[1]);
      else if (page === "hof") p = pageHof();
      else if (page === "teams") p = pageTeams();
      else if (page === "team") p = pageTeam(parts[1]);
      else if (page === "manager") p = pageManager(parts[1]);
      else notFound();
    } catch (e) { showError(e); }
    if (p && p.catch) p.catch(showError);
    window.scrollTo(0, 0);
  }
  function showError(e) {
    console.error(e);
    app.innerHTML = '<div class="empty">Something went wrong loading this page. ' + esc(e.message || e) + "</div>";
  }

  // theme toggle
  var themeBtn = document.getElementById("theme");
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function syncTheme() { themeBtn.textContent = isDark() ? "Light" : "Dark"; }
  themeBtn.addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
    syncTheme();
  });
  syncTheme();

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resizeHandlers.forEach(function (f) { f(); }); }, 150);
  });
  window.addEventListener("hashchange", route);

  fetch("data/index.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (idx) {
    IDX = idx;
    if (!LIVE.demo) return;
    return getJSON("data/demo/meta.json").then(function (m) { LIVE.now = Date.parse(m.now); LIVE.label = m.label; },
      function () { LIVE.demo = false; });  // no demo files (python tools/make_demo.py builds them): show the real site
  }).then(function () {
    var idx = IDX;
    document.getElementById("foot").innerHTML = "Fantasy B1G &middot; est. 2015 &middot; data built " + esc(idx.built.replace("T", " ").replace("Z", " UTC"));
    route();
  }).catch(showError);
})();
