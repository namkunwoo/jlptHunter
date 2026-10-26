#!/usr/bin/env node
/**
 * 일본어 데이터 외부 검증기 — Jisho.org API(JMdict 사전) 대조
 *
 *   node tools/verify-ja.mjs            # 어휘 + 한자 검증
 *   node tools/verify-ja.mjs vocab      # 어휘만
 *   node tools/verify-ja.mjs kanji      # 한자만
 *
 * tools/check.mjs 는 '형식'만 본다(읽기에 한자가 섞였는지 등).
 * 이 도구는 '내용'을 본다 — 읽기가 실제 사전과 일치하는지.
 *
 * 한계
 *  - JMdict에 없는 단어는 '사전에 없음'으로 나오지만 틀렸다는 뜻은 아니다
 *    (고유명사·복합어·구어는 누락될 수 있다).
 *  - jlpt 태그는 2010년 개편 이전 기준의 커뮤니티 태깅이라 참고용이다.
 *  - 한국어 뜻은 대조하지 않는다. 영어 뜻을 함께 출력하니 눈으로 확인하면 된다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WAIT = 1100;            // 사전 서버 배려 — 초당 1회 미만
const CACHE_PATH = join(ROOT, "tools", ".jisho-cache.json");

function load(file, key) {
  const win = {};
  new Function("window", readFileSync(join(ROOT, "data", file), "utf8"))(win);
  return win[key] || [];
}
const VOCAB = load("vocab.js", "VOCAB");
const KANJI = load("kanji.js", "KANJI");

let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(word) {
  if (cache[word]) return cache[word];
  const url = "https://jisho.org/api/v1/search/words?keyword=" + encodeURIComponent(word);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "study-check/1.0" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      cache[word] = j.data || [];
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      await sleep(WAIT);
      return cache[word];
    } catch (e) {
      if (attempt === 2) { console.error(`  ! ${word} 조회 실패: ${e.message}`); return null; }
      await sleep(2000);
    }
  }
}

// 사전 표제어에서 해당 단어의 읽기들을 모은다
const KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff\u30fc]+$/;
function readingsOf(entries, word) {
  const out = [];
  const kanaWord = KANA_ONLY.test(word);
  (entries || []).forEach((e) => {
    (e.japanese || []).forEach((j) => {
      if (j.word === word && j.reading) out.push(j.reading);
      if (!j.word && j.reading === word) out.push(j.reading);
      // ほぼ·ますます 처럼 보통 가나로만 쓰는 단어는 사전이 드문 한자 표기(粗 등)를
      // word 에 넣고 가나를 reading 에 둔다. 질의어가 가나뿐이면 reading 으로 맞춘다.
      if (kanaWord && j.reading === word) out.push(j.reading);
    });
  });
  return [...new Set(out)];
}
function meaningsOf(entries, word) {
  const hit = (entries || []).find((e) => e.slug === word
    || (e.japanese || []).some((j) => j.word === word || j.reading === word));
  if (!hit) return { en: [], jlpt: [], common: null };
  return {
    en: (hit.senses?.[0]?.english_definitions) || [],
    jlpt: hit.jlpt || [],
    common: hit.is_common,
  };
}

const bad = [], warn = [], notfound = [], ok = [];

async function checkVocab() {
  console.log(`\n── 어휘 ${VOCAB.length}개 대조 ─────────────────────────`);
  for (let i = 0; i < VOCAB.length; i++) {
    const v = VOCAB[i];
    const entries = await lookup(v.w);
    if (entries === null) continue;
    const rs = readingsOf(entries, v.w);
    const info = meaningsOf(entries, v.w);
    const tag = `[${i + 1}/${VOCAB.length}] ${v.id} ${v.w}`;
    if (!rs.length) {
      notfound.push(`${v.id} ${v.w} (${v.r}) — 사전 표제어에 없음`);
      process.stdout.write(`\r${tag} … 사전에 없음        `);
      continue;
    }
    if (rs.includes(v.r)) {
      ok.push(v.id);
      // JLPT 등급이 데이터와 다르면 참고용 경고
      const lv = (info.jlpt[0] || "").replace("jlpt-", "").toUpperCase();
      if (lv && v.level && lv !== v.level) {
        warn.push(`${v.id} ${v.w}: 등급 표기 ${v.level} / 사전 태그 ${lv} (사전 태그는 구 기준이라 참고용)`);
      }
      process.stdout.write(`\r${tag} … OK                 `);
    } else {
      bad.push(`${v.id} ${v.w}: 읽기 "${v.r}" / 사전 "${rs.join(", ")}"  [뜻: ${info.en.slice(0,3).join(", ")}]`);
      process.stdout.write(`\r${tag} … 불일치!            `);
    }
  }
  console.log("");
}

async function checkKanji() {
  console.log(`\n── 한자 ${KANJI.length}자의 예시 단어 대조 ──────────────`);
  let n = 0, total = KANJI.reduce((a, k) => a + (k.words || []).length, 0);
  for (const k of KANJI) {
    for (const wd of (k.words || [])) {
      n++;
      const entries = await lookup(wd.w);
      if (entries === null) continue;
      const rs = readingsOf(entries, wd.w);
      const info = meaningsOf(entries, wd.w);
      const tag = `[${n}/${total}] ${k.id} ${k.kanji} → ${wd.w}`;
      if (!rs.length) {
        notfound.push(`${k.id} 예시 ${wd.w} (${wd.r}) — 사전 표제어에 없음`);
        process.stdout.write(`\r${tag} … 사전에 없음        `);
      } else if (rs.includes(wd.r)) {
        ok.push(k.id + ":" + wd.w);
        process.stdout.write(`\r${tag} … OK                 `);
      } else {
        bad.push(`${k.id} 예시 ${wd.w}: 읽기 "${wd.r}" / 사전 "${rs.join(", ")}"  [뜻: ${info.en.slice(0,3).join(", ")}]`);
        process.stdout.write(`\r${tag} … 불일치!            `);
      }
    }
  }
  console.log("");
}

// 연어 읽기 검증 —
// 연어를 '한자덩어리 + 가나' 조각으로 쪼개, 각 한자 조각의 사전 읽기가
// 적어둔 읽기 안에 순서대로 들어있는지 확인한다.
// (활용형은 사전 표제어가 없을 수 있어 어간 일치까지만 본다)
const KJ = /[\u4e00-\u9fff]/;
function segment(jp) {
  const out = []; let i = 0;
  while (i < jp.length) {
    if (KJ.test(jp[i])) {
      let j = i; while (j < jp.length && KJ.test(jp[j])) j++;
      let k = j; while (k < jp.length && /[\u3040-\u309f]/.test(jp[k])) k++;
      out.push({ kj: true, kanji: jp.slice(i, j), raw: jp.slice(i, k) }); i = k;
    } else {
      let j = i; while (j < jp.length && !KJ.test(jp[j])) j++;
      out.push({ kj: false, raw: jp.slice(i, j) }); i = j;
    }
  }
  return out;
}
async function checkCollo() {
  const list = [];
  VOCAB.forEach((v) => (v.collo || []).forEach((c, i) => {
    if (c && typeof c === "object" && c.c && c.r) list.push({ id: v.id, idx: i, ...c });
  }));
  console.log(`\n── 연어 ${list.length}개 읽기 대조 ───────────────────`);
  let n = 0;
  for (const c of list) {
    n++;
    process.stdout.write(`\r[${n}/${list.length}] ${c.id} ${c.c}            `);
    let cursor = 0, failed = null;
    for (const s of segment(c.c)) {
      if (!s.kj) {   // 가나 조각은 적어둔 읽기에 그대로 있어야 한다
        const at = c.r.indexOf(s.raw, cursor);
        if (at < 0) { failed = `가나 "${s.raw}" 를 읽기에서 찾을 수 없음`; break; }
        cursor = at + s.raw.length;
        continue;
      }
      // 한자 조각: 전체형 → 한자부만 순서로 사전 읽기를 찾는다
      let rs = [];
      for (const probe of [s.raw, s.kanji]) {
        const e = await lookup(probe);
        if (e === null) continue;
        rs = readingsOf(e, probe);
        if (rs.length) break;
      }
      if (!rs.length) { warn.push(`${c.id} 연어 "${c.c}": '${s.raw}' 사전 표제어 없음 — 읽기 "${c.r}" 직접 확인 필요`); break; }
      const hit = rs.find((r) => c.r.indexOf(r, cursor) >= 0);
      if (!hit) { failed = `'${s.raw}' 의 사전 읽기 [${rs.join(", ")}] 가 "${c.r}" 안에 없음`; break; }
      cursor = c.r.indexOf(hit, cursor) + hit.length;
    }
    if (failed) bad.push(`${c.id} 연어 "${c.c}" (${c.r}): ${failed}`);
    else ok.push(c.id + ":collo" + c.idx);
  }
  console.log("");
}

const mode = process.argv[2];
if (!mode || mode === "vocab") await checkVocab();
if (!mode || mode === "kanji") await checkKanji();
if (!mode || mode === "collo") await checkCollo();

console.log("\n══ 결과 ══════════════════════════════════");
console.log(`사전과 일치: ${ok.length}개`);
if (bad.length) {
  console.log(`\n✗ 읽기 불일치 ${bad.length}개 — 반드시 고쳐야 합니다`);
  bad.forEach((b) => console.log("  " + b));
}
if (notfound.length) {
  console.log(`\n? 사전 표제어에 없음 ${notfound.length}개 — 직접 확인 필요`);
  notfound.forEach((b) => console.log("  " + b));
}
if (warn.length) {
  console.log(`\n△ 등급 표기 차이 ${warn.length}개 (참고용)`);
  warn.slice(0, 12).forEach((b) => console.log("  " + b));
  if (warn.length > 12) console.log(`  … 그 외 ${warn.length - 12}개`);
}
if (!bad.length && !notfound.length) console.log("\n✓ 모든 읽기가 사전과 일치합니다.");
console.log("\n※ 출처: Jisho.org API (JMdict 사전 데이터)");
process.exit(bad.length ? 1 : 0);
