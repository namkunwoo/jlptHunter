/**
 * 일본어 읽기 조립·검증 공용 모듈
 *
 * 원칙: 읽기를 사람이 적지 않는다. 모든 읽기는
 *   (1) 사전(JMdict) 표제어 조회  또는
 *   (2) tools/stems.json 에 명시한 '사전형'의 읽기에서 어간을 떼어
 * 조립한다. 추측하는 경로는 없다.
 *
 * 왜 필요한가: 활용형은 사전 표제어가 아니다. 한자만 따로 조회해
 * 꼬리 가나를 붙이면 「行われた」가 ぎょうわれた 처럼 엉뚱해진다
 * (行 의 명사 읽기 ぎょう 를 집어오기 때문). 그래서 활용형은
 * 사전형을 명시해 어간을 얻는다.
 *   行われた → 사전형 行う → おこなう → 꼬리 う 제거 → おこな → おこな+われた
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(HERE, ".jisho-cache.json");
const STEMS_PATH = join(HERE, "stems.json");

let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch {}
export const STEMS = existsSync(STEMS_PATH)
  ? JSON.parse(readFileSync(STEMS_PATH, "utf8")) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 1100;   // 사전 서버 배려

// 々(반복 기호)는 앞 한자의 일부로 취급해야 年々→ねんねん 가 맞는다
const KJ = /[一-鿿々]/;
const HIRA = /[぀-ゟ]/;
export const KANA_ONLY = /^[぀-ゟ゠-ヿー、。・\s~〜ー]+$/;

export async function lookup(word) {
  if (cache[word] !== undefined) return cache[word];
  const url = "https://jisho.org/api/v1/search/words?keyword=" + encodeURIComponent(word);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "study-check/1.0" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      cache[word] = (await r.json()).data || [];
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      await sleep(WAIT);
      return cache[word];
    } catch (e) {
      if (a === 2) return null;
      await sleep(2000);
    }
  }
}

/** 표제어가 word 와 정확히 일치하는 항목의 읽기들 */
export function exactReadings(entries, word) {
  const out = [];
  const kanaWord = KANA_ONLY.test(word);
  (entries || []).forEach((e) => (e.japanese || []).forEach((j) => {
    if (j.word === word && j.reading) out.push(j.reading);
    if (!j.word && j.reading === word) out.push(j.reading);
    if (kanaWord && j.reading === word) out.push(j.reading);
  }));
  return [...new Set(out)];
}

/** 문장을 '한자덩어리+오쿠리가나' / '가나' 조각으로 자른다 */
export function segment(jp) {
  const out = []; let i = 0;
  while (i < jp.length) {
    if (KJ.test(jp[i])) {
      let j = i; while (j < jp.length && KJ.test(jp[j])) j++;
      let k = j; while (k < jp.length && HIRA.test(jp[k])) k++;
      out.push({ kj: true, kanji: jp.slice(i, j), kana: jp.slice(j, k), raw: jp.slice(i, k) });
      i = k;
    } else {
      let j = i; while (j < jp.length && !KJ.test(jp[j])) j++;
      out.push({ kj: false, raw: jp.slice(i, j) });
      i = j;
    }
  }
  return out;
}

// 명사에 붙는 꼬리 — 이때만 '한자부 명사읽기 + 꼬리'가 성립한다
const NOUN_TAIL = /^(する|した|して|している|しています|します|しましょう|してください|しても|しない|させる|させた|させている|される|された|されている|できる|できない|せずに|すれば|的な|的に|的だ|性がある|性がない|がある|がない|だ|だった|だと|な|に|の|が|を|と|は|で|も|から|まで|より|へ|か)$/;

function isNounEntry(entries, kanji) {
  return (entries || []).some((e) =>
    (e.japanese || []).some((j) => j.word === kanji) &&
    (e.senses?.[0]?.parts_of_speech || []).some((p) => /Noun/.test(p)));
}

/**
 * 조각 하나의 읽기. 못 구하면 null 과 이유를 돌려준다.
 * 경로: ① 조각 전체가 표제어 → ② stems.json 의 사전형 → ③ 명사+꼬리
 */
export async function segmentReading(s) {
  const whole = await lookup(s.raw);
  const rs = exactReadings(whole, s.raw);
  if (rs.length) return { r: rs[0], via: "표제어" };

  const spec = STEMS[s.raw];
  if (spec) {
    // units: 조각을 더 작은 단위로 쪼개 지정한다. 단위는 세 종류.
    //   { word: "年々" }              사전 표제어 — 읽기를 그대로 쓴다
    //   { dict: "減る", kana: "っている" }  사전형의 어간 + 지정한 가나
    //   { kana: "を" }                가나 그대로
    // 일본어는 단어 경계가 없어 한자가 연달으면 한 덩어리로 잘린다
    // (年々減っている). 그때 이 방식으로 분해를 명시한다.
    if (spec.units) {
      let out = "";
      for (const u of spec.units) {
        if (u.word) {
          const wr = exactReadings(await lookup(u.word), u.word);
          if (!wr.length) return { r: null, why: `단위 '${u.word}' 가 사전에 없음` };
          out += wr[0];
        } else if (u.dict) {
          const dr2 = exactReadings(await lookup(u.dict), u.dict);
          if (!dr2.length) return { r: null, why: `단위 사전형 '${u.dict}' 조회 실패` };
          const dSeg2 = segment(u.dict);
          const dTail2 = dSeg2.map((x) => (x.kj ? x.kana : x.raw)).join("");
          let st = dr2[0];
          if (dTail2) {
            if (!st.endsWith(dTail2)) return { r: null, why: `단위 '${u.dict}'(${dr2[0]}) 꼬리 '${dTail2}' 불일치` };
            st = st.slice(0, st.length - dTail2.length);
          }
          out += st + (u.kana || "");
        } else if (u.kana !== undefined) {
          out += u.kana;
        } else return { r: null, why: `units 항목이 word/dict/kana 중 어느 것도 아님` };
      }
      return { r: out, via: "units" };
    }
    if (spec.parts) {               // 복합어를 사전 표제어 둘 이상으로 분할
      let out = "";
      for (const p of spec.parts) {
        const pr = exactReadings(await lookup(p), p);
        if (!pr.length) return { r: null, why: `분할 '${p}' 가 사전에 없음` };
        out += pr[0];
      }
      return { r: out + (spec.tail || ""), via: "분할" };
    }
    const d = spec.dict;
    const dr = exactReadings(await lookup(d), d);
    if (!dr.length) return { r: null, why: `사전형 '${d}' 조회 실패` };
    // 사전형의 꼬리 가나를 읽기에서 떼어 어간을 얻는다
    const dSeg = segment(d);
    const dTail = dSeg.map((x) => (x.kj ? x.kana : x.raw)).join("");
    let stem = dr[0];
    if (dTail) {
      if (!stem.endsWith(dTail)) return { r: null, why: `사전형 '${d}'(${dr[0]}) 의 꼬리 '${dTail}' 가 읽기 끝과 다름` };
      stem = stem.slice(0, stem.length - dTail.length);
    }
    return { r: stem + s.kana, via: `사전형 ${d}` };
  }

  if (NOUN_TAIL.test(s.kana) && isNounEntry(whole === null ? [] : await lookup(s.kanji), s.kanji)) {
    const kr = exactReadings(await lookup(s.kanji), s.kanji);
    if (kr.length) return { r: kr[0] + s.kana, via: "명사+꼬리" };
  }
  return { r: null, why: `'${s.raw}' — 표제어도 아니고 stems.json 에도 없음` };
}

/** 문장 전체의 읽기를 조립. 실패한 조각은 misses 에 쌓인다. */
export async function composeReading(jp) {
  let out = ""; const misses = [];
  for (const s of segment(jp)) {
    if (!s.kj) { out += s.raw; continue; }
    const { r, why } = await segmentReading(s);
    if (r === null) { misses.push(why); out += `《${s.raw}》`; }
    else out += r;
  }
  return { reading: out, misses };
}
