#!/usr/bin/env node
/**
 * 한자 음독·훈독을 KANJIDIC2(kanjiapi.dev)와 대조한다.
 *   node tools/verify-kanji.mjs
 *
 * 검사 항목
 *   - 음독(on) 이 사전의 on_readings 에 있는가
 *   - 훈독(kun) 이 사전의 kun_readings 에 있는가 (표기 형식을 맞춰 비교)
 *   - level 이 사전의 jlpt 등급과 맞는가 (참고용 — 사전 등급은 구 기준)
 *   - 예시 단어에 해당 한자가 실제로 들어있는가
 * 예시 단어의 '읽기'는 tools/verify-readings.mjs 가 JMdict 로 따로 검증한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", ".kanji-cache.json");

const win = {};
new Function("window", readFileSync(join(ROOT, "data", "kanji.js"), "utf8"))(win);
const KANJI = win.KANJI || [];

let cache = {};
try { cache = JSON.parse(readFileSync(CACHE, "utf8")); } catch {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchKanji(ch) {
  if (cache[ch] !== undefined) return cache[ch];
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://kanjiapi.dev/v1/kanji/" + encodeURIComponent(ch));
      cache[ch] = r.ok ? await r.json() : null;
      writeFileSync(CACHE, JSON.stringify(cache));
      await sleep(350);
      return cache[ch];
    } catch (e) { if (a === 2) return null; await sleep(1500); }
  }
}

// 앱 표기 "き(める)" ↔ 사전 표기 "き.める" 를 맞춘다
function normKun(s) { return s.replace(/[()\.\-]/g, ""); }

const bad = [], warn = [];
let okOn = 0, okKun = 0;
for (let i = 0; i < KANJI.length; i++) {
  const k = KANJI[i];
  process.stdout.write(`\r[${i + 1}/${KANJI.length}] ${k.kanji}    `);
  const d = await fetchKanji(k.kanji);
  if (!d) { warn.push(`${k.id} ${k.kanji}: 사전 조회 실패`); continue; }

  const dOn = (d.on_readings || []).map((x) => x.replace(/[-.]/g, ""));
  (k.on || []).forEach((o) => {
    if (dOn.includes(o.replace(/[-.]/g, ""))) okOn++;
    else bad.push(`${k.id} ${k.kanji}: 음독 "${o}" 가 사전 [${(d.on_readings || []).join(", ")}] 에 없음`);
  });
  const dKun = (d.kun_readings || []).map(normKun);
  (k.kun || []).forEach((u) => {
    if (dKun.includes(normKun(u))) okKun++;
    else bad.push(`${k.id} ${k.kanji}: 훈독 "${u}" 가 사전 [${(d.kun_readings || []).join(", ")}] 에 없음`);
  });
  if (d.jlpt && k.level !== "N" + d.jlpt) {
    warn.push(`${k.id} ${k.kanji}: 등급 ${k.level} / 사전 N${d.jlpt} (사전 등급은 구 기준이라 참고용)`);
  }
  (k.words || []).forEach((w, wi) => {
    if (w.w.indexOf(k.kanji) === -1) bad.push(`${k.id} ${k.kanji}: 예시[${wi}] "${w.w}" 에 그 한자가 없음`);
  });
}
console.log("");
console.log(`한자 ${KANJI.length}자`);
console.log(`✓ 음독 ${okOn}개 · 훈독 ${okKun}개 사전 일치`);
console.log(`✗ 불일치 ${bad.length}건`);
if (bad.length) bad.forEach((b) => console.log("  " + b));
if (warn.length) {
  console.log(`\n△ 참고 ${warn.length}건`);
  warn.slice(0, 10).forEach((w) => console.log("  " + w));
  if (warn.length > 10) console.log(`  … 그 외 ${warn.length - 10}건`);
}
console.log("\n※ 출처: KANJIDIC2 (kanjiapi.dev)");
process.exit(bad.length ? 1 : 0);
