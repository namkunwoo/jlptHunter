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

/**
 * 명사 뒤에 붙는 꼬리인지 판정한다. 이때만 '한자부 명사읽기 + 꼬리'가 성립한다.
 *
 * 근거: 조사·조동사(が·を·に·は·の·と·で·も·へ·や·から·まで·より·だ)로 시작하는
 * 꼬리는 앞 한자의 읽기를 바꾸지 않는다. 반대로 동사·형용사의 오쿠리가나는
 * 이 글자들로 시작하지 않는다 — 실제 데이터 201종을 대조해 확인했다.
 *   오쿠리가나 예: 増えた(え) 上げた(げ) 選ばない(ば) 守って(っ) 盛んだ(ん)
 *                  高くなった(く) 忘れ(れ) 痛みを(み) 誘いを(い) 豊かだ(か)
 * 그래서 '증가した' 류(する 활용)와 조사류만 허용하고, 나머지는
 * stems.json 에 사전형을 명시하게 한다.
 */
const SURU_TAIL = /^(する|した|して|している|しています|します|しましょう|してください|しても|しない|させる|させた|させている|される|された|されている|できる|できない|できません|せずに|すれば|的な|的に|的だ|性がある|性がない)/;
const PARTICLE_START = /^(が|を|に|は|の|と|で|も|へ|や|から|まで|より|だ|です|である|な)/;
// 'な' 는 な형용사의 연체형(率直な)에 필요해 넣었다. 'が'·'な' 는 5단동사 부정형
// (泳がない·死なない)의 오쿠리가나와 겹칠 수 있으나, 한자부가 사전에
// 독립 표제어로 있어야 한다는 조건이 걸러준다.
function isNounTail(kana) {
  if (!kana) return false;
  return SURU_TAIL.test(kana) || PARTICLE_START.test(kana);
}

// 체언처럼 쓰여 뒤에 조사·조동사가 붙을 수 있는 품사들.
// 사전은 率直 을 Na-adjective, 彼 를 Pronoun 으로 분류하므로 Noun 만 보면 놓친다.
const NOMINAL_POS = /Noun|Pronoun|Na-adjective|Adverb|Numeric|Counter|adjectival/i;
function isNounEntry(entries, kanji) {
  return (entries || []).some((e) =>
    (e.japanese || []).some((j) => j.word === kanji) &&
    (e.senses || []).some((sn) => (sn.parts_of_speech || []).some((p) => NOMINAL_POS.test(p))));
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
    // read: 사전으로 확인할 수 없는 읽기를 직접 적는 마지막 수단.
    // 일본어의 불규칙 동사는 来る·する 둘뿐이고 그 활용형은 사전 표제어가 아니다
    // (来ない=こない 는 来 의 사전 읽기 らい 로 설명되지 않는다).
    // note 를 반드시 적게 하고, 검증 보고서에서 '사전 미확인'으로 따로 센다.
    if (spec.read) {
      if (!spec.note) return { r: null, why: `read 를 쓰려면 note 에 근거를 적어야 함` };
      return { r: spec.read, via: "규칙(사전 미확인)", unverified: true };
    }
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
          // pick: 읽기가 여러 개인 한자에서 어느 것인지 지정한다(様=よう/さま).
          // 지정한 읽기가 실제로 사전에 있는지 확인하므로 추측이 아니다.
          if (u.pick) {
            if (!wr.includes(u.pick)) return { r: null, why: `단위 '${u.word}' 의 지정 읽기 '${u.pick}' 가 사전 읽기 [${wr.join(", ")}] 에 없음` };
            out += u.pick;
          } else out += wr[0];
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

  if (isNounTail(s.kana)) {
    const kEntries = await lookup(s.kanji);
    if (isNounEntry(kEntries, s.kanji)) {
      const kr = exactReadings(kEntries, s.kanji);
      if (kr.length) return { r: kr[0] + s.kana, via: "명사+꼬리" };
    }
  }
  return { r: null, why: `'${s.raw}' — 표제어도 아니고 stems.json 에도 없음` };
}

/**
 * 조각 하나가 가질 수 있는 '모든' 읽기 후보.
 * 한자는 읽기가 여러 개인 경우가 많고(前=まえ/ぜん, 数=かず/すう, 彼=かれ/あの)
 * 어느 것이 맞는지는 문맥이 정한다. 기계는 고를 수 없으므로 후보를 전부 돌려주고,
 * 검증은 '저장된 읽기가 후보들의 조합으로 설명되는가'를 본다.
 */
export async function segmentCandidates(s) {
  const out = [];
  const whole = await lookup(s.raw);
  exactReadings(whole, s.raw).forEach((r) => out.push(r));

  const spec = STEMS[s.raw];
  if (spec) {
    const one = await segmentReading(s);
    if (one.r) out.push(one.r);
  }
  // 주: spec.read 로 온 후보는 사전 미확인이다. verifyReading 이 따로 집계한다.
  // 검증은 '설명 가능한가'를 보므로 후보를 넓게 잡는다.
  // 생성(segmentReading)은 하나를 골라야 하므로 엄격하게 유지한다.
  if (isNounTail(s.kana)) {
    const kEntries = await lookup(s.kanji);
    exactReadings(kEntries, s.kanji).forEach((r) => out.push(r + s.kana));
  }
  return [...new Set(out)];
}

/**
 * 저장된 읽기가 사전 근거로 설명되는지 검증한다.
 * 조각마다 후보를 하나씩 집어 읽기를 끝까지 소비할 수 있으면 통과.
 * 되돌아가기(백트래킹)를 하므로 후보가 여러 개여도 올바른 조합을 찾아낸다.
 */
export async function verifyReading(jp, stored) {
  const segs = segment(jp);
  const cands = [];
  const ruleBased = [];
  for (const s of segs) {
    if (!s.kj) { cands.push([s.raw]); continue; }
    const c = await segmentCandidates(s);
    if (!c.length) return { ok: false, why: `'${s.raw}' 의 읽기 근거를 찾을 수 없음 (사전 표제어 아님, stems.json 에도 없음)`, unresolved: s.raw };
    if (STEMS[s.raw] && STEMS[s.raw].read) ruleBased.push(s.raw);
    cands.push(c);
  }
  function walk(i, pos) {
    if (i === cands.length) return pos === stored.length;
    for (const c of cands[i]) {
      if (stored.startsWith(c, pos) && walk(i + 1, pos + c.length)) return true;
    }
    return false;
  }
  if (walk(0, 0)) return { ok: true, ruleBased };
  return { ok: false, why: `사전 근거로 설명되지 않음. 조각별 후보: ` +
    segs.map((s, i) => `${s.raw}=[${cands[i].join("|")}]`).join(" ") };
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
