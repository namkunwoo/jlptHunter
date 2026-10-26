#!/usr/bin/env node
/**
 * JLPT 학습 데이터 검사기
 *
 *   node tools/check.mjs
 *
 * 데이터를 추가·수정한 뒤 반드시 실행하세요.
 * ID 중복, 필드 누락, 읽기 표기 오류를 잡아냅니다.
 *
 * 이 검사기는 '형식'만 봅니다(ID 중복, 필드 누락, 읽기에 한자 섞임 등).
 * 읽기가 실제로 맞는지는 tools/verify-ja.mjs 가 Jisho(JMdict) 사전과 대조합니다.
 *   node tools/verify-ja.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function load(file, key) {
  const src = readFileSync(join(ROOT, "data", file), "utf8");
  const win = {};
  new Function("window", src)(win);
  return win[key] || [];
}

let VOCAB = [], KANJI = [], GRAMMAR = [];
try { VOCAB = load("vocab.js", "VOCAB"); } catch { /* 아직 없을 수 있음 */ }
try { KANJI = load("kanji.js", "KANJI"); } catch {}
try { GRAMMAR = load("grammar.js", "GRAMMAR"); } catch {}

const errors = [];
const warns = [];

const HIRA_KATA = /^[぀-ゟ゠-ヿー\s()（）・、]+$/;
const HAS_KANJI = /[一-鿿]/;

/* ── 어휘 ─────────────────────────────────────────── */
const vIds = new Set(), vWords = new Set();
VOCAB.forEach((v, i) => {
  const at = `vocab[${i}] ${v.id || "(id없음)"}`;
  ["id", "w", "r", "m", "pos", "level", "ex", "exr", "exm"].forEach((k) => {
    if (!v[k]) errors.push(`${at}: '${k}' 필드가 비어 있습니다`);
  });
  if (v.id) {
    if (vIds.has(v.id)) errors.push(`${at}: ID 중복 (학습 기록이 어긋납니다)`);
    vIds.add(v.id);
  }
  if (v.w) {
    if (vWords.has(v.w)) warns.push(`${at}: 단어 '${v.w}'가 중복됩니다`);
    vWords.add(v.w);
  }
  // 읽기에 한자가 섞이면 학습에 방해가 된다
  if (v.r && HAS_KANJI.test(v.r)) errors.push(`${at}: 읽기(r)에 한자가 섞였습니다 — "${v.r}"`);
  if (v.exr && HAS_KANJI.test(v.exr)) errors.push(`${at}: 예문읽기(exr)에 한자가 섞였습니다`);
  if (v.r && !HIRA_KATA.test(v.r)) warns.push(`${at}: 읽기에 히라가나/카타카나 외 문자가 있습니다 — "${v.r}"`);
  if (v.collo && !Array.isArray(v.collo)) errors.push(`${at}: collo는 배열이어야 합니다`);
});

/* ── 한자 ─────────────────────────────────────────── */
const kIds = new Set(), kChars = new Set();
KANJI.forEach((k, i) => {
  const at = `kanji[${i}] ${k.id || "(id없음)"}`;
  ["id", "kanji", "level", "meaning", "words", "tip"].forEach((f) => {
    if (!k[f]) errors.push(`${at}: '${f}' 필드가 비어 있습니다`);
  });
  if (k.id) {
    if (kIds.has(k.id)) errors.push(`${at}: ID 중복`);
    kIds.add(k.id);
  }
  // kanji 필드는 한자 한 글자여야 한다
  if (k.kanji && !/^[一-鿿]$/.test(k.kanji)) {
    errors.push(`${at}: kanji 필드가 한자 한 글자가 아닙니다 — "${k.kanji}"`);
  }
  if (k.kanji) {
    if (kChars.has(k.kanji)) warns.push(`${at}: 한자 '${k.kanji}'가 중복됩니다`);
    kChars.add(k.kanji);
  }
  if (!Array.isArray(k.on)) errors.push(`${at}: on(음독)은 배열이어야 합니다`);
  if (!Array.isArray(k.kun)) errors.push(`${at}: kun(훈독)은 배열이어야 합니다`);
  if ((k.on || []).length === 0 && (k.kun || []).length === 0) {
    errors.push(`${at}: 음독과 훈독이 모두 비어 있습니다`);
  }
  // 음독은 카타카나, 훈독은 히라가나가 관례다
  (k.on || []).forEach((o) => {
    if (HAS_KANJI.test(o)) errors.push(`${at}: 음독에 한자가 섞였습니다 — "${o}"`);
    if (!/[゠-ヿ]/.test(o)) warns.push(`${at}: 음독 "${o}"가 카타카나가 아닙니다`);
  });
  (k.kun || []).forEach((u) => {
    if (HAS_KANJI.test(u)) errors.push(`${at}: 훈독에 한자가 섞였습니다 — "${u}"`);
  });
  (k.words || []).forEach((w, wi) => {
    if (!w.w || !w.r || !w.m) errors.push(`${at}: words[${wi}]에 w/r/m 중 빈 값이 있습니다`);
    if (w.r && HAS_KANJI.test(w.r)) errors.push(`${at}: words[${wi}] 읽기에 한자가 섞였습니다 — "${w.r}"`);
    // 예시 단어에 그 한자가 실제로 들어있는지
    if (w.w && k.kanji && w.w.indexOf(k.kanji) === -1) {
      warns.push(`${at}: 예시 단어 "${w.w}"에 한자 '${k.kanji}'가 없습니다`);
    }
  });
});

/* ── 문법 ─────────────────────────────────────────── */
const gIds = new Set(), gPatterns = new Set();
GRAMMAR.forEach((g, i) => {
  const at = `grammar[${i}] ${g.id || "(id없음)"}`;
  ["id", "pattern", "group", "level", "form", "mean", "ex", "exr", "exm", "note"].forEach((k) => {
    if (!g[k]) errors.push(`${at}: '${k}' 필드가 비어 있습니다`);
  });
  if (g.id) {
    if (gIds.has(g.id)) errors.push(`${at}: ID 중복`);
    gIds.add(g.id);
  }
  if (g.pattern) {
    if (gPatterns.has(g.pattern)) warns.push(`${at}: 문형 '${g.pattern}'이 중복됩니다`);
    gPatterns.add(g.pattern);
  }
  if (g.exr && HAS_KANJI.test(g.exr)) errors.push(`${at}: 예문읽기(exr)에 한자가 섞였습니다`);
  if (g.confuse) {
    if (!Array.isArray(g.confuse)) errors.push(`${at}: confuse는 배열이어야 합니다`);
    else g.confuse.forEach((c, ci) => {
      if (!c.p || !c.d) errors.push(`${at}: confuse[${ci}]에 p/d 중 빈 값이 있습니다`);
    });
  } else {
    warns.push(`${at}: 비슷한 문형 비교(confuse)가 없습니다 — N2는 문형 구분이 핵심입니다`);
  }
});

/* ── 입력란 안내문이 정답을 누출하지 않는지 ───────────── */
// js/app.js 의 placeholder 는 '답안 형식'을 보여주는 용도다.
// 거기에 데이터에 실재하는 읽기·뜻·문형을 쓰면 그 항목이 나왔을 때 정답이 노출된다.
try {
  const appSrc = readFileSync(join(ROOT, "js", "app.js"), "utf8");
  const phs = [...appSrc.matchAll(/placeholder="예:\s*([^"]+)"/g)].map((m) => m[1].trim());
  phs.forEach((ph) => {
    const parts = ph.split("/").map((x) => x.trim()).filter(Boolean);
    const leaks = [];
    VOCAB.forEach((v) => {
      if (parts.includes(v.r) || parts.includes(v.m) || ph === `${v.r} ${v.m}`) leaks.push(`어휘 ${v.id} ${v.w}`);
    });
    KANJI.forEach((k) => {
      (k.on || []).forEach((o) => { if (parts.includes(o)) leaks.push(`한자 ${k.id} ${k.kanji} 음독`); });
      (k.kun || []).forEach((u) => { if (parts.includes(u)) leaks.push(`한자 ${k.id} ${k.kanji} 훈독`); });
    });
    GRAMMAR.forEach((g) => {
      const mean = (g.mean || "").replace(/\s*\(.*$/, "").trim();
      if (mean && (parts.includes(mean) || ph === mean)) leaks.push(`문법 ${g.id} ${g.pattern}`);
    });
    if (leaks.length) {
      errors.push(`입력란 안내문 "예: ${ph}" 가 실제 정답을 노출합니다 — ${[...new Set(leaks)].join(", ")}`);
    }
  });
} catch (e) { warns.push(`안내문 검사를 건너뛰었습니다: ${e.message}`); }

/* ── 결과 ─────────────────────────────────────────── */
const posCount = {};
VOCAB.forEach((v) => { posCount[v.pos] = (posCount[v.pos] || 0) + 1; });
const grpCount = {};
GRAMMAR.forEach((g) => { grpCount[g.group] = (grpCount[g.group] || 0) + 1; });

console.log("── JLPT 학습 데이터 검사 ──────────────────");
console.log(`어휘 ${VOCAB.length}개`);
if (VOCAB.length) {
  console.log(`  품사: ${Object.entries(posCount).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
console.log(`한자 ${KANJI.length}자 (예시 단어 ${KANJI.reduce((a, k) => a + (k.words || []).length, 0)}개)`);
console.log(`문법 ${GRAMMAR.length}개`);
if (GRAMMAR.length) {
  console.log(`  분류: ${Object.entries(grpCount).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  문형 비교: ${GRAMMAR.reduce((a, g) => a + (g.confuse || []).length, 0)}개`);
}
console.log(`전체 학습 항목: ${VOCAB.length + KANJI.length + GRAMMAR.length}개`);
console.log("");

if (warns.length) {
  console.log(`⚠ 경고 ${warns.length}개`);
  warns.slice(0, 15).forEach((w) => console.log("  " + w));
  if (warns.length > 15) console.log(`  … 그 외 ${warns.length - 15}개`);
  console.log("");
}
if (errors.length) {
  console.log(`✗ 오류 ${errors.length}개 — 고쳐야 배포할 수 있습니다`);
  errors.slice(0, 20).forEach((e) => console.log("  " + e));
  if (errors.length > 20) console.log(`  … 그 외 ${errors.length - 20}개`);
  process.exit(1);
}
console.log("✓ 형식 오류 없습니다.");
console.log("  읽기 정확성은 `node tools/verify-ja.mjs` 로 사전(JMdict)과 대조하세요.");
console.log("  한국어 뜻과 예문의 자연스러움은 사전으로 검증되지 않습니다 — 교재와 교차 확인 권장.");
