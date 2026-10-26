/* 니혼고 · JLPT N2 학습 앱
 *
 * 정처기 앱에서 효과가 확인된 구조를 재사용한다:
 *   간격 반복(Leitner) + 바로학습(자투리 시간) + 약점 모아보기 + 자기평가
 *
 * 어학에 맞춰 달라진 점:
 *   - 항목이 세 종류(단어/한자/문법)라 한 저장소에 kind를 섞어 관리한다
 *   - 어학은 매일 꾸준함이 핵심이라 '오늘 목표'를 기본 화면으로 둔다
 *   - 한자는 음독·훈독을 나눠 보여주고, 문법은 비슷한 문형 비교를 함께 띄운다
 */
(function () {
  "use strict";

  var VOCAB = window.VOCAB || [];
  var KANJI = window.KANJI || [];
  var GRAMMAR = window.GRAMMAR || [];
  var STORE = "nihongo.v1";
  var DAILY_GOAL = 20; // 하루 목표 항목 수 (어휘 중심이라 정처기보다 높게)
  var NEW_PER_DAY = 8; // 그중 '처음 보는 항목'으로 보장할 최소 개수.
                       // 복습만 쌓이면 새 단어를 전혀 못 배우게 되므로 따로 할당한다.
  var NEW_EVERY = 3;   // 복습이 쌓여 있어도 N개마다 한 번은 새 항목을 끼워넣는다

  /* ── 저장 ─────────────────────────────────────────── */
  var save = {
    // "v:v-001" / "k:k-001" / "g:g-001" -> {g:"known"|"unsure"|"unknown", box, due, seen}
    items: {},
    days: {},      // "YYYY-MM-DD" -> 학습 개수(복습 포함)
    newDays: {},   // "YYYY-MM-DD" -> 그중 '처음 본' 항목 개수
    lastDay: null
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      save.items = p.items || {};
      save.days = p.days || {};
      save.newDays = p.newDays || {};   // 이전 버전 기록에는 없으므로 기본값
      save.lastDay = p.lastDay || null;
    } catch (e) { /* 저장소를 못 쓰면 세션 내에서만 동작 */ }
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) {}
  }

  /* ── 날짜 ─────────────────────────────────────────── */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDays(dstr, n) {
    var p = dstr.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ── 간격 반복 (Leitner) ───────────────────────────
     상자 1~6. 외우면 올라가고 틀리면 1로 떨어진다.
     어학은 정처기보다 간격을 촘촘히 잡았다 — 단어는 더 자주 봐야 한다. */
  function boxGap(box) {
    var gaps = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 15, 6: 30 };
    return gaps[box] || 1;
  }
  function bumpBox(rec, good) {
    rec.box = good ? Math.min(6, (rec.box || 1) + 1) : 1;
    rec.seen = (rec.seen || 0) + 1;
    rec.due = addDays(todayStr(), boxGap(rec.box));
    return rec;
  }
  function isDue(rec) {
    return !!(rec && rec.due && rec.due <= todayStr());
  }

  function key(kind, id) { return kind + ":" + id; }
  function rec(kind, id) { return save.items[key(kind, id)] || null; }
  function grade(kind, id) { var r = rec(kind, id); return r ? r.g : null; }

  function mark(kind, id, g) {
    var k = key(kind, id);
    var wasNew = !save.items[k];          // 기록이 없었다 = 오늘 처음 본 것
    var r = save.items[k] || {};
    r.g = g;
    bumpBox(r, g === "known");
    save.items[k] = r;
    var d = todayStr();
    save.days[d] = (save.days[d] || 0) + 1;
    if (wasNew) save.newDays[d] = (save.newDays[d] || 0) + 1;
    save.lastDay = d;
    persist();
  }

  function todayCount() { return save.days[todayStr()] || 0; }
  function todayNewCount() { return save.newDays[todayStr()] || 0; }

  // 연속 학습일 — 오늘 아직 안 했으면 어제까지의 연속을 보여준다
  function streak() {
    function did(d) { return (save.days[d] || 0) > 0; }
    var d = todayStr();
    if (!did(d)) {
      d = addDays(d, -1);
      if (!did(d)) return 0;
    }
    var n = 0;
    while (did(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ── 유틸 ─────────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
  function allItems() {
    return VOCAB.map(function (x) { return { kind: "v", item: x }; })
      .concat(KANJI.map(function (x) { return { kind: "k", item: x }; }))
      .concat(GRAMMAR.map(function (x) { return { kind: "g", item: x }; }));
  }

  /* ── 상태 ─────────────────────────────────────────── */
  var ui = {
    tab: "quick",
    vPos: [], vState: "all", vPick: null,
    kLevel: [], kState: "all", kPick: null,
    gGroup: [], gState: "all", gPick: null
  };
  var quick = { cur: null, skipped: {}, shown: false };

  var POS = uniq(VOCAB.map(function (v) { return v.pos; }));
  var LEVELS = uniq(KANJI.map(function (k) { return k.level; })).sort();
  var GROUPS = uniq(GRAMMAR.map(function (g) { return g.group; }));

  /* ── 필터 ─────────────────────────────────────────── */
  function stateOK(kind, id, st) {
    var g = grade(kind, id);
    if (st === "all") return true;
    if (st === "todo") return !g;
    if (st === "due") return isDue(rec(kind, id));
    return g === st;
  }
  function vocabList() {
    return VOCAB.filter(function (v) {
      if (ui.vPos.length && ui.vPos.indexOf(v.pos) === -1) return false;
      return stateOK("v", v.id, ui.vState);
    });
  }
  function kanjiList() {
    return KANJI.filter(function (k) {
      if (ui.kLevel.length && ui.kLevel.indexOf(k.level) === -1) return false;
      return stateOK("k", k.id, ui.kState);
    });
  }
  function grammarList() {
    return GRAMMAR.filter(function (g) {
      if (ui.gGroup.length && ui.gGroup.indexOf(g.group) === -1) return false;
      return stateOK("g", g.id, ui.gState);
    });
  }

  /* ── 칩 ───────────────────────────────────────────── */
  function chips(host, vals, active, counter, onClick) {
    host.innerHTML = vals.map(function (v) {
      var on = active.indexOf(v) !== -1;
      var n = counter(v);
      return '<button class="chip" aria-pressed="' + (on ? "true" : "false") +
        '" data-v="' + esc(v) + '">' + esc(v) +
        ' <span class="n">' + n + '</span></button>';
    }).join("");
    Array.prototype.forEach.call(host.querySelectorAll(".chip"), function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        var i = active.indexOf(v);
        if (i === -1) active.push(v); else active.splice(i, 1);
        onClick();
      });
    });
  }

  /* ── 자기평가 버튼 ───────────────────────────────── */
  function gradeBtns(idPrefix) {
    return '<div class="selfgrade on" id="' + idPrefix + 'Grade">' +
      '<button class="sg known" data-g="known">외웠음</button>' +
      '<button class="sg unsure" data-g="unsure">애매함</button>' +
      '<button class="sg unknown" data-g="unknown">모르겠음</button>' +
      '</div>';
  }
  function bindGrade(hostId, kind, id, after) {
    var host = $(hostId);
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll(".sg"), function (b) {
      b.addEventListener("click", function () {
        mark(kind, id, b.getAttribute("data-g"));
        drawScores(); drawBadges();
        if (after) after();
      });
    });
  }

  function boxChip(kind, id) {
    var r = rec(kind, id);
    if (!r || !r.box) return "";
    return '<span class="boxchip b' + Math.min(5, r.box) + '">' + r.box + '단계 · ' + (r.seen || 1) + '회</span>';
  }

  /* ── 카드 본문 ───────────────────────────────────── */
  function vocabCardHTML(v, opts) {
    opts = opts || {};
    var h = '<div class="flash-meta">' +
      '<span class="word-pos">' + esc(v.pos) + '</span>' +
      '<span class="lv ' + v.level + '">' + v.level + '</span>' +
      boxChip("v", v.id) + '</div>';

    h += '<h2 class="word-main jp-serif">' + esc(v.w) + '</h2>';

    if (opts.hideAnswer) {
      h += '<div class="recall"><label class="recall-l" for="' + opts.inputId + '">' +
        '읽기와 뜻을 떠올려 적어보세요 <span class="recall-opt">선택 — 건너뛰어도 됩니다</span></label>' +
        '<input type="text" id="' + opts.inputId + '" placeholder="예: がっこう 학교" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" /></div>' +
        '<div class="toolbar"><button class="btn btn-main btn-sm" id="' + opts.flipId + '">정답 확인</button></div>' +
        '<div class="flash-a" id="' + opts.ansId + '">';
    }

    h += '<div class="word-read jp">' + esc(v.r) + '</div>' +
      '<div class="word-mean">' + esc(v.m) + '</div>';

    h += '<div class="ex-box">' +
      '<div class="ex-jp">' + esc(v.ex) + '</div>' +
      '<div class="ex-r jp">' + esc(v.exr) + '</div>' +
      '<div class="ex-m">' + esc(v.exm) + '</div></div>';

    if (v.collo && v.collo.length) {
      h += '<div class="collo">' + v.collo.map(function (c) {
        return '<div class="collo-i">' + esc(c) + '</div>';
      }).join("") + '</div>';
    }
    if (v.tip) h += '<div class="keypoint"><b>포인트</b> — ' + esc(v.tip) + '</div>';

    if (opts.hideAnswer) h += '</div>';
    return h;
  }

  function kanjiCardHTML(k, opts) {
    opts = opts || {};
    var h = '<div class="flash-meta"><span class="lv ' + k.level + '">' + k.level + '</span>' +
      boxChip("k", k.id) + '</div>';

    h += '<div class="kanji-big">' + esc(k.kanji) + '</div>';

    if (opts.hideAnswer) {
      h += '<div class="recall"><label class="recall-l" for="' + opts.inputId + '">' +
        '음독과 훈독을 떠올려 적어보세요 <span class="recall-opt">선택</span></label>' +
        '<input type="text" id="' + opts.inputId + '" placeholder="예: ニチ / ひ" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" /></div>' +
        '<div class="toolbar"><button class="btn btn-main btn-sm" id="' + opts.flipId + '">정답 확인</button></div>' +
        '<div class="flash-a" id="' + opts.ansId + '">';
    }

    h += '<div class="kanji-meaning">' + esc(k.meaning) + '</div>';

    h += '<div class="read-split">' +
      '<div class="read-col on"><div class="read-col-l">음독 (音読み)</div>' +
      '<div class="read-col-v jp">' + (k.on && k.on.length ? k.on.map(esc).join("、") :
        '<span class="none">없음</span>') + '</div></div>' +
      '<div class="read-col kun"><div class="read-col-l">훈독 (訓読み)</div>' +
      '<div class="read-col-v jp">' + (k.kun && k.kun.length ? k.kun.map(esc).join("、") :
        '<span class="none">없음</span>') + '</div></div></div>';

    h += '<div class="steps-h">예시 단어</div><div class="kwords">' +
      k.words.map(function (w) {
        return '<div class="kword"><span class="kword-w">' + esc(w.w) + '</span>' +
          '<span class="kword-r jp">' + esc(w.r) + '</span>' +
          '<span class="kword-m">' + esc(w.m) + '</span></div>';
      }).join("") + '</div>';

    if (k.tip) h += '<div class="keypoint"><b>포인트</b> — ' + esc(k.tip) + '</div>';

    if (opts.hideAnswer) h += '</div>';
    return h;
  }

  function grammarCardHTML(g, opts) {
    opts = opts || {};
    var h = '<div class="flash-meta"><span class="word-pos">' + esc(g.group) + '</span>' +
      '<span class="lv ' + g.level + '">' + g.level + '</span>' +
      boxChip("g", g.id) + '</div>';

    h += '<h2 class="gpattern">' + esc(g.pattern) + '</h2>';

    if (opts.hideAnswer) {
      h += '<div class="recall"><label class="recall-l" for="' + opts.inputId + '">' +
        '이 문형의 뜻을 떠올려 적어보세요 <span class="recall-opt">선택</span></label>' +
        '<input type="text" id="' + opts.inputId + '" placeholder="예: ~할 뻔했다" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" /></div>' +
        '<div class="toolbar"><button class="btn btn-main btn-sm" id="' + opts.flipId + '">정답 확인</button></div>' +
        '<div class="flash-a" id="' + opts.ansId + '">';
    }

    h += '<div class="gmean">' + esc(g.mean) + '</div>';
    h += '<div class="gform jp"><span class="gform-l">접속 형태</span>' + esc(g.form) + '</div>';

    h += '<div class="ex-box">' +
      '<div class="ex-jp">' + esc(g.ex) + '</div>' +
      '<div class="ex-r jp">' + esc(g.exr) + '</div>' +
      '<div class="ex-m">' + esc(g.exm) + '</div></div>';

    if (g.note) h += '<div class="keypoint"><b>포인트</b> — ' + esc(g.note) + '</div>';

    if (g.confuse && g.confuse.length) {
      h += '<div class="confuse"><div class="confuse-h">비슷한 문형과 구분</div>' +
        g.confuse.map(function (c) {
          return '<div class="confuse-i"><span class="confuse-p jp">' + esc(c.p) + '</span>' +
            '<span class="confuse-d">' + esc(c.d) + '</span></div>';
        }).join("") + '</div>';
    }

    if (opts.hideAnswer) h += '</div>';
    return h;
  }

  /* ── 오늘 학습 (바로학습) ─────────────────────────
     우선순위: 복습기한 → 안 본 단어 → 안 본 한자 → 안 본 문법 */
  // 아직 한 번도 안 본 항목 하나 — 단어를 가장 먼저 (어학의 기초)
  function pickFresh() {
    var sk = quick.skipped;
    var order = [
      { kind: "v", arr: VOCAB, reason: "new-v" },
      { kind: "k", arr: KANJI, reason: "new-k" },
      { kind: "g", arr: GRAMMAR, reason: "new-g" }
    ];
    for (var i = 0; i < order.length; i++) {
      var o = order[i];
      var fresh = o.arr.filter(function (it) {
        return !rec(o.kind, it.id) && !sk[key(o.kind, it.id)];
      });
      if (fresh.length) return { kind: o.kind, item: fresh[0], rec: null, reason: o.reason };
    }
    return null;
  }

  function pickNext() {
    var sk = quick.skipped;

    // 복습 기한이 된 것 — 약한 것(box 1) 먼저
    var due = [];
    allItems().forEach(function (x) {
      var r = rec(x.kind, x.item.id);
      if (isDue(r) && !sk[key(x.kind, x.item.id)]) {
        due.push({ kind: x.kind, item: x.item, rec: r, reason: "due" });
      }
    });
    due.sort(function (a, b) {
      var ba = a.rec.box || 1, bb = b.rec.box || 1;
      if (ba !== bb) return ba - bb;
      return (a.rec.due || "") < (b.rec.due || "") ? -1 : 1;
    });

    // 새 항목 할당량이 남았으면 복습 사이에 끼워넣는다.
    // 복습을 항상 우선하면 2주쯤 지나 복습만 쌓이고 새 단어를 전혀 못 배운다.
    var needNew = todayNewCount() < NEW_PER_DAY;
    if (needNew && (due.length === 0 || todayCount() % NEW_EVERY === 0)) {
      var fresh = pickFresh();
      if (fresh) return fresh;
    }
    if (due.length) return due[0];
    return pickFresh();
  }

  var REASON = {
    due: "<b>복습 시점</b>이 된 항목입니다. 한 번 외웠어도 시간이 지나면 잊기 때문에 다시 확인합니다.",
    "new-v": "새 <b>단어</b>입니다. 어휘가 독해·청해의 기초이므로 단어를 가장 먼저 봅니다.",
    "new-k": "새 <b>한자</b>입니다. 음독·훈독을 함께 외워야 실제 문장에서 읽을 수 있습니다.",
    "new-g": "새 <b>문법</b>입니다. 비슷한 문형과 어떻게 다른지가 N2의 핵심입니다."
  };

  function dueCount() {
    var n = 0;
    allItems().forEach(function (x) { if (isDue(rec(x.kind, x.item.id))) n++; });
    return n;
  }

  function drawQuick() {
    var done = todayCount();
    var pct = Math.min(100, Math.round((done / DAILY_GOAL) * 100));
    var fill = $("qGoalFill");
    fill.style.width = pct + "%";
    fill.className = "qgoal-f" + (done >= DAILY_GOAL ? " done" : "");
    $("qGoalNum").textContent = done + " / " + DAILY_GOAL + "개" +
      (done >= DAILY_GOAL ? " — 목표 달성" : " (" + (DAILY_GOAL - done) + "개 남음)");
    $("qStreak").textContent = streak();

    var next = quick.cur || pickNext();
    quick.cur = next;

    if (!next) {
      var total = VOCAB.length + KANJI.length + GRAMMAR.length;
      $("qWhy").innerHTML = "오늘 볼 것을 모두 끝냈습니다.";
      $("qCard").innerHTML = '<div class="qdone"><div class="qdone-m">✓</div>' +
        '<div class="qdone-t">지금 복습할 것이 없습니다</div>' +
        '<div class="qdone-s">전체 ' + total + '개 중 ' + Object.keys(save.items).length +
        '개를 학습했습니다.<br />간격 반복에 따라 복습할 항목이 생기면 여기에 다시 나타납니다.</div>' +
        '<div class="qdone-b"><button class="btn btn-main btn-sm" id="qReset2">건너뛴 것 다시 보기</button></div></div>';
      var rb = $("qReset2");
      if (rb) rb.addEventListener("click", function () { quick.skipped = {}; quick.cur = null; drawQuick(); });
      $("qSkip").disabled = true;
      $("qSwitch").disabled = true;
      return;
    }

    $("qSkip").disabled = false;
    $("qSwitch").disabled = false;
    $("qWhy").innerHTML = REASON[next.reason] || "";

    var opts = { hideAnswer: true, inputId: "qRecall", flipId: "qFlip", ansId: "qAns" };
    var body = next.kind === "v" ? vocabCardHTML(next.item, opts)
      : next.kind === "k" ? kanjiCardHTML(next.item, opts)
      : grammarCardHTML(next.item, opts);

    $("qCard").innerHTML = body + '<div id="qGradeWrap" style="display:none;">' +
      gradeBtns("q") + '</div>';

    var flip = function () {
      $("qAns").className = "flash-a on";
      $("qGradeWrap").style.display = "";
      $("qFlip").disabled = true;
      bindGrade("qGrade", next.kind, next.item.id, function () {
        quick.cur = null;
        drawQuick();
        refreshAll();
      });
    };
    $("qFlip").addEventListener("click", flip);
    $("qRecall").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); flip(); }
    });
    setTimeout(function () { var i = $("qRecall"); if (i) i.focus(); }, 60);
  }

  /* ── 단어 탭 ─────────────────────────────────────── */
  function drawVocab() {
    chips($("vPos"), POS, ui.vPos,
      function (p) { return VOCAB.filter(function (v) { return v.pos === p; }).length; },
      function () { drawVocab(); });

    var list = vocabList();
    $("vCount").textContent = list.length ? "(" + list.length + ")" : "";
    if (!list.length) {
      $("vList").innerHTML = '<div class="empty">조건에 맞는 단어가 없어요.</div>';
      $("vCard").innerHTML = '<div class="blank"><p>필터를 바꿔보세요.</p></div>';
      return;
    }
    if (!list.some(function (v) { return v.id === ui.vPick; })) ui.vPick = list[0].id;

    $("vList").innerHTML = list.map(function (v) {
      var g = grade("v", v.id);
      var d = g === "known" ? " ok" : (g === "unknown" || g === "unsure") ? " no" : "";
      return '<button class="qrow" aria-current="' + (v.id === ui.vPick) + '" data-id="' + esc(v.id) + '">' +
        '<span class="dot' + d + '"></span>' +
        '<span class="qrow-t jp">' + esc(v.w) + '</span>' +
        '<span class="qrow-m">' + esc(v.m.slice(0, 10)) + '</span></button>';
    }).join("");
    Array.prototype.forEach.call($("vList").querySelectorAll(".qrow"), function (r) {
      r.addEventListener("click", function () {
        ui.vPick = r.getAttribute("data-id"); drawVocab();
      });
    });

    var v = VOCAB.filter(function (x) { return x.id === ui.vPick; })[0];
    if (!v) return;
    $("vCard").innerHTML = vocabCardHTML(v) + gradeBtns("v");
    bindGrade("vGrade", "v", v.id, function () { drawVocab(); });
  }

  /* ── 한자 탭 ─────────────────────────────────────── */
  function drawKanji() {
    chips($("kLevel"), LEVELS, ui.kLevel,
      function (l) { return KANJI.filter(function (k) { return k.level === l; }).length; },
      function () { drawKanji(); });

    var list = kanjiList();
    $("kCount").textContent = list.length ? "(" + list.length + ")" : "";
    if (!list.length) {
      $("kList").innerHTML = '<div class="empty">조건에 맞는 한자가 없어요.</div>';
      $("kCard").innerHTML = '<div class="blank"><p>필터를 바꿔보세요.</p></div>';
      return;
    }
    if (!list.some(function (k) { return k.id === ui.kPick; })) ui.kPick = list[0].id;

    $("kList").innerHTML = list.map(function (k) {
      var g = grade("k", k.id);
      var d = g === "known" ? " ok" : (g === "unknown" || g === "unsure") ? " no" : "";
      return '<button class="qrow" aria-current="' + (k.id === ui.kPick) + '" data-id="' + esc(k.id) + '">' +
        '<span class="dot' + d + '"></span>' +
        '<span class="qrow-t jp" style="font-size:1.2rem;">' + esc(k.kanji) + '</span>' +
        '<span class="qrow-m">' + esc(k.meaning.slice(0, 10)) + '</span></button>';
    }).join("");
    Array.prototype.forEach.call($("kList").querySelectorAll(".qrow"), function (r) {
      r.addEventListener("click", function () {
        ui.kPick = r.getAttribute("data-id"); drawKanji();
      });
    });

    var k = KANJI.filter(function (x) { return x.id === ui.kPick; })[0];
    if (!k) return;
    $("kCard").innerHTML = kanjiCardHTML(k) + gradeBtns("k");
    bindGrade("kGrade", "k", k.id, function () { drawKanji(); });
  }

  /* ── 문법 탭 ─────────────────────────────────────── */
  function drawGrammar() {
    chips($("gGroup"), GROUPS, ui.gGroup,
      function (gr) { return GRAMMAR.filter(function (g) { return g.group === gr; }).length; },
      function () { drawGrammar(); });

    var list = grammarList();
    $("gCount").textContent = list.length ? "(" + list.length + ")" : "";
    if (!list.length) {
      $("gList").innerHTML = '<div class="empty">조건에 맞는 문형이 없어요.</div>';
      $("gCard").innerHTML = '<div class="blank"><p>필터를 바꿔보세요.</p></div>';
      return;
    }
    if (!list.some(function (g) { return g.id === ui.gPick; })) ui.gPick = list[0].id;

    $("gList").innerHTML = list.map(function (g) {
      var gr = grade("g", g.id);
      var d = gr === "known" ? " ok" : (gr === "unknown" || gr === "unsure") ? " no" : "";
      return '<button class="qrow" aria-current="' + (g.id === ui.gPick) + '" data-id="' + esc(g.id) + '">' +
        '<span class="dot' + d + '"></span>' +
        '<span class="qrow-t jp">' + esc(g.pattern) + '</span>' +
        '<span class="qrow-m">' + esc(g.group) + '</span></button>';
    }).join("");
    Array.prototype.forEach.call($("gList").querySelectorAll(".qrow"), function (r) {
      r.addEventListener("click", function () {
        ui.gPick = r.getAttribute("data-id"); drawGrammar();
      });
    });

    var g = GRAMMAR.filter(function (x) { return x.id === ui.gPick; })[0];
    if (!g) return;
    $("gCard").innerHTML = grammarCardHTML(g) + gradeBtns("g");
    bindGrade("gGrade", "g", g.id, function () { drawGrammar(); });
  }

  /* ── 약점 ─────────────────────────────────────────── */
  function weakItems() {
    return allItems().filter(function (x) {
      var g = grade(x.kind, x.item.id);
      return g === "unknown" || g === "unsure";
    });
  }

  function drawWeak() {
    var w = weakItems();
    if (!w.length) {
      $("weakBody").innerHTML = '<div class="card blank"><div class="mark">✓</div>' +
        '<p>약점으로 표시한 항목이 없습니다.</p>' +
        '<p style="color:var(--ink-soft);font-size:0.82rem;">"애매함"이나 "모르겠음"으로 표시하면 여기에 모입니다.</p></div>';
      return;
    }

    var label = { v: "단어", k: "한자", g: "문법" };
    var byKind = { v: [], k: [], g: [] };
    w.forEach(function (x) { byKind[x.kind].push(x); });

    var html = '<div class="callout"><b>약점 집중</b> — ' +
      '"애매함" 또는 "모르겠음"으로 표시한 ' + w.length + '개입니다. ' +
      '간격 반복이 이 항목들을 더 자주 띄워주지만, 여기서 몰아서 보는 것도 효과적입니다.</div>';

    ["v", "k", "g"].forEach(function (kind) {
      var arr = byKind[kind];
      if (!arr.length) return;
      html += '<div class="section"><h2 class="section-h">' + label[kind] +
        ' <span class="wgroup-c">' + arr.length + '개</span></h2><div class="witems">';
      arr.forEach(function (x) {
        var it = x.item;
        var g = grade(kind, it.id);
        var main = kind === "v" ? it.w : kind === "k" ? it.kanji : it.pattern;
        var sub = kind === "v" ? it.r + " · " + it.m
          : kind === "k" ? it.meaning
          : it.mean;
        html += '<button class="witem" data-kind="' + kind + '" data-id="' + esc(it.id) + '">' +
          '<span class="witem-l"><span class="dot no"></span>' +
          '<span class="witem-t jp" style="font-size:1rem;">' + esc(main) + '</span></span>' +
          '<span class="witem-r"><span class="jp">' + esc(sub.slice(0, 30)) + '</span> · ' +
          (g === "unknown" ? '<span class="mine">모름</span>' : '<span style="color:var(--amber)">애매</span>') +
          '</span></button>';
      });
      html += '</div></div>';
    });

    $("weakBody").innerHTML = html;
    Array.prototype.forEach.call($("weakBody").querySelectorAll(".witem"), function (b) {
      b.addEventListener("click", function () {
        var kind = b.getAttribute("data-kind"), id = b.getAttribute("data-id");
        if (kind === "v") { ui.vPos = []; ui.vState = "all"; $("vState").value = "all"; ui.vPick = id; go("vocab"); }
        else if (kind === "k") { ui.kLevel = []; ui.kState = "all"; $("kState").value = "all"; ui.kPick = id; go("kanji"); }
        else { ui.gGroup = []; ui.gState = "all"; $("gState").value = "all"; ui.gPick = id; go("grammar"); }
      });
    });
  }

  /* ── 진도 ─────────────────────────────────────────── */
  function drawStats() {
    var total = VOCAB.length + KANJI.length + GRAMMAR.length;
    var seen = Object.keys(save.items).length;
    var known = Object.keys(save.items).filter(function (k) { return save.items[k].g === "known"; }).length;

    var html = '<div class="callout"><b>JLPT N2 합격 조건</b> — ' +
      '총점 90/180점 이상, 그리고 <b>각 영역(언어지식·독해·청해) 19점 이상</b>입니다. ' +
      '한 영역이라도 과락이면 총점이 높아도 불합격이므로 버리는 전략이 불가능합니다. ' +
      '이 앱은 <b>문자·어휘·문법</b>을 담당하고, 독해와 청해는 교재·음원이 필요합니다.</div>';

    // 종류별 진도
    var kinds = [
      { k: "v", label: "단어", arr: VOCAB },
      { k: "k", label: "한자", arr: KANJI },
      { k: "g", label: "문법", arr: GRAMMAR }
    ];
    html += '<div class="section"><h2 class="section-h">종류별 진도</h2><div class="ranks">';
    kinds.forEach(function (x) {
      var s = x.arr.filter(function (it) { return rec(x.k, it.id); }).length;
      var kn = x.arr.filter(function (it) { return grade(x.k, it.id) === "known"; }).length;
      var pct = x.arr.length ? Math.round((kn / x.arr.length) * 100) : 0;
      html += '<div class="rank"><div class="rank-i">' + x.label.charAt(0) + '</div>' +
        '<div class="rank-b"><div class="rank-t">' + x.label + '</div>' +
        '<div class="rank-d">' + s + ' / ' + x.arr.length + ' 학습 · 외운 것 ' + kn + '개</div>' +
        '<div class="bar"><div class="bar-f' + (pct >= 70 ? "" : pct >= 40 ? " warn" : " bad") +
        '" style="width:' + pct + '%"></div></div></div>' +
        '<div class="rank-n">' + pct + '%</div></div>';
    });
    html += '</div></div>';

    // 복습 상자 분포 — 간격 반복이 작동하는지 보여준다
    var boxes = [0, 0, 0, 0, 0, 0, 0];
    Object.keys(save.items).forEach(function (k) {
      var b = save.items[k].box || 1;
      boxes[Math.min(6, b)]++;
    });
    html += '<div class="section"><h2 class="section-h">복습 단계 분포</h2>' +
      '<p class="section-sub">단계가 올라갈수록 복습 간격이 길어집니다 (1일 → 2 → 4 → 8 → 15 → 30일). ' +
      '오른쪽으로 갈수록 확실히 외운 것입니다.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>단계</th><th>간격</th><th>항목 수</th></tr></thead><tbody>';
    for (var b = 1; b <= 6; b++) {
      html += '<tr><td>' + b + '단계</td><td class="num">' + boxGap(b) + '일</td>' +
        '<td class="num"><span class="heat ' + (boxes[b] === 0 ? "h0" : b <= 2 ? "h3" : b <= 4 ? "h2" : "h1") +
        '">' + (boxes[b] || "·") + '</span></td></tr>';
    }
    html += '</tbody></table></div></div>';

    // 최근 학습 기록
    var days = Object.keys(save.days).sort().reverse().slice(0, 14);
    if (days.length) {
      html += '<div class="section"><h2 class="section-h">최근 학습 기록</h2>' +
        '<p class="section-sub">어학은 매일 조금씩이 몰아서 하는 것보다 효과적입니다.</p>' +
        '<div class="tablewrap"><table><thead><tr><th>날짜</th><th>학습 개수</th><th>목표 달성</th></tr></thead><tbody>';
      days.forEach(function (d) {
        var n = save.days[d];
        var p = d.split("-");
        html += '<tr><td>' + Number(p[1]) + '/' + Number(p[2]) + '</td>' +
          '<td class="num">' + n + '개</td>' +
          '<td>' + (n >= DAILY_GOAL ? '<span class="passmark pass">달성</span>' :
            '<span class="passmark fail">' + Math.round((n / DAILY_GOAL) * 100) + '%</span>') + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // 전체 요약
    html += '<div class="section"><h2 class="section-h">전체 요약</h2><div class="goalgrid">' +
      '<div class="goalcard"><div class="goalcard-a">전체 항목</div>' +
      '<div class="goalcard-t">' + total + '개</div>' +
      '<div class="goalcard-n">단어 ' + VOCAB.length + ' · 한자 ' + KANJI.length + ' · 문법 ' + GRAMMAR.length + '</div></div>' +
      '<div class="goalcard"><div class="goalcard-a">학습한 항목</div>' +
      '<div class="goalcard-t">' + seen + '개</div>' +
      '<div class="goalcard-n">전체의 ' + (total ? Math.round((seen / total) * 100) : 0) + '%</div></div>' +
      '<div class="goalcard"><div class="goalcard-a">외운 항목</div>' +
      '<div class="goalcard-t">' + known + '개</div>' +
      '<div class="goalcard-n">학습한 것 중 ' + (seen ? Math.round((known / seen) * 100) : 0) + '%</div></div>' +
      '<div class="goalcard"><div class="goalcard-a">연속 학습일</div>' +
      '<div class="goalcard-t">' + streak() + '일</div>' +
      '<div class="goalcard-n">오늘 ' + todayCount() + '개 학습</div></div>' +
      '</div></div>';

    html += '<div class="section"><div class="toolbar">' +
      '<button class="btn btn-out btn-sm" id="stWipe">학습 기록 전체 삭제</button></div></div>';

    $("statsBody").innerHTML = html;
    $("stWipe").addEventListener("click", function () {
      if (!confirm("저장된 학습 기록을 모두 지웁니다. 계속할까요?")) return;
      save.items = {}; save.days = {}; save.lastDay = null;
      persist();
      quick.cur = null; quick.skipped = {};
      refreshAll(); drawScores(); drawBadges(); drawQuick(); drawStats();
    });
  }

  /* ── 점수판 ───────────────────────────────────────── */
  function drawScores() {
    var total = VOCAB.length + KANJI.length + GRAMMAR.length;
    var known = Object.keys(save.items).filter(function (k) { return save.items[k].g === "known"; }).length;
    $("scToday").textContent = todayCount() + "/" + DAILY_GOAL;
    $("scStreak").textContent = streak();
    $("scKnown").textContent = known + "/" + total;
  }
  function drawBadges() {
    var d = $("dueBadge"), n = dueCount();
    d.hidden = !n; d.textContent = n;
    var w = $("weakBadge"), m = weakItems().length;
    w.hidden = !m; w.textContent = m;
  }

  function refreshAll() {
    drawVocab(); drawKanji(); drawGrammar();
  }

  /* ── 탭 ───────────────────────────────────────────── */
  var TABS = [
    { k: "quick", t: "tabQuick", v: "viewQuick" },
    { k: "vocab", t: "tabVocab", v: "viewVocab" },
    { k: "kanji", t: "tabKanji", v: "viewKanji" },
    { k: "grammar", t: "tabGrammar", v: "viewGrammar" },
    { k: "weak", t: "tabWeak", v: "viewWeak" },
    { k: "stats", t: "tabStats", v: "viewStats" }
  ];
  function go(k) {
    ui.tab = k;
    TABS.forEach(function (x) {
      var on = x.k === k;
      $(x.t).setAttribute("aria-selected", on ? "true" : "false");
      $(x.v).className = "view" + (on ? " on" : "");
    });
    if (k === "quick") drawQuick();
    if (k === "vocab") drawVocab();
    if (k === "kanji") drawKanji();
    if (k === "grammar") drawGrammar();
    if (k === "weak") drawWeak();
    if (k === "stats") drawStats();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ── 초기화 ───────────────────────────────────────── */
  function init() {
    if (!VOCAB.length && !KANJI.length && !GRAMMAR.length) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif">' +
        '학습 데이터를 불러오지 못했습니다. data/ 폴더를 확인해주세요.</div>';
      return;
    }
    load();

    if (VOCAB.length) ui.vPick = VOCAB[0].id;
    if (KANJI.length) ui.kPick = KANJI[0].id;
    if (GRAMMAR.length) ui.gPick = GRAMMAR[0].id;

    TABS.forEach(function (x) {
      $(x.t).addEventListener("click", function () { go(x.k); });
    });

    $("vState").addEventListener("change", function () { ui.vState = this.value; drawVocab(); });
    $("kState").addEventListener("change", function () { ui.kState = this.value; drawKanji(); });
    $("gState").addEventListener("change", function () { ui.gState = this.value; drawGrammar(); });
    $("vReset").addEventListener("click", function () {
      ui.vPos = []; ui.vState = "all"; $("vState").value = "all"; drawVocab();
    });
    $("kReset").addEventListener("click", function () {
      ui.kLevel = []; ui.kState = "all"; $("kState").value = "all"; drawKanji();
    });
    $("gReset").addEventListener("click", function () {
      ui.gGroup = []; ui.gState = "all"; $("gState").value = "all"; drawGrammar();
    });

    $("qSkip").addEventListener("click", function () {
      if (!quick.cur) return;
      quick.skipped[key(quick.cur.kind, quick.cur.item.id)] = true;
      quick.cur = null;
      drawQuick();
    });
    $("qSwitch").addEventListener("click", function () {
      // 지금과 다른 종류가 나올 때까지 건너뛴다
      if (!quick.cur) return;
      var from = quick.cur.kind, guard = 0;
      while (quick.cur && quick.cur.kind === from && guard < 500) {
        quick.skipped[key(quick.cur.kind, quick.cur.item.id)] = true;
        quick.cur = pickNext();
        guard++;
      }
      drawQuick();
    });

    refreshAll();
    drawScores();
    drawBadges();
    drawQuick();

    // 키보드: 스페이스로 정답 확인
    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (ui.tab === "quick" && e.key === " ") {
        var f = $("qFlip");
        if (f && !f.disabled) { e.preventDefault(); f.click(); }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
