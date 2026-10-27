#!/usr/bin/env node
/** 읽기를 조립할 수 없는 조각을 모아 보고한다. stems.json 을 채울 목록. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { segment, segmentReading, STEMS } from "./ja-reading.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
["vocab","kanji","grammar"].forEach(f=>new Function("window",readFileSync(join(ROOT,"data",f+".js"),"utf8"))(win));

const texts = [];
(win.VOCAB||[]).forEach(v=>{
  if(v.ex) texts.push({src:`${v.id} 예문`, t:v.ex, stored:v.exr});
  (v.collo||[]).forEach((c,i)=>{ if(c.c&&c.r) texts.push({src:`${v.id} 연어[${i}]`, t:c.c, stored:c.r}); });
});
(win.GRAMMAR||[]).forEach(g=>{ if(g.ex) texts.push({src:`${g.id} 예문`, t:g.ex, stored:g.exr}); });

const need = new Map();
let checked=0, okCount=0, mismatch=[];
for (const x of texts) {
  checked++;
  if(checked%40===0) process.stdout.write(`\r  ${checked}/${texts.length}   `);
  let out="", failed=false;
  for (const s of segment(x.t)) {
    if (!s.kj) { out+=s.raw; continue; }
    const { r, why } = await segmentReading(s);
    if (r===null) {
      failed=true;
      if(!need.has(s.raw)) need.set(s.raw,{raw:s.raw,kanji:s.kanji,kana:s.kana,n:0,where:[],why});
      const e=need.get(s.raw); e.n++; if(e.where.length<2) e.where.push(x.src);
      out+=`《${s.raw}》`;
    } else out+=r;
  }
  if(!failed){
    if(out===x.stored) okCount++;
    else mismatch.push(`${x.src} "${x.t}"\n     저장: ${x.stored}\n     사전: ${out}`);
  }
}
console.log("");
const list=[...need.values()].sort((a,b)=>b.n-a.n);
writeFileSync(join(ROOT,"tools","stems-needed.json"), JSON.stringify(list,null,1));
console.log(`대상 문장 ${texts.length}개 / stems.json 기재 ${Object.keys(STEMS).length}개`);
console.log(`사전 조립 성공: ${okCount+mismatch.length}개 (저장값과 일치 ${okCount}, 불일치 ${mismatch.length})`);
console.log(`조립 불가 조각: ${list.length}종\n`);
if(mismatch.length){ console.log("── 저장값과 다른 것 (실제 오류 후보) ──"); mismatch.slice(0,25).forEach(m=>console.log("  "+m)); if(mismatch.length>25)console.log(`  … 그 외 ${mismatch.length-25}개`); }
