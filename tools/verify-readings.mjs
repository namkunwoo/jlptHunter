#!/usr/bin/env node
/**
 * 저장된 모든 읽기를 사전 근거로 검증한다.
 *   node tools/verify-readings.mjs
 *
 * 통과 = 조각마다 사전에 등재된 읽기(또는 stems.json 의 사전형에서 얻은 어간)를
 *        골라 저장된 읽기를 끝까지 설명할 수 있다.
 * 실패 = 사전으로 설명되지 않음 → 데이터 오류 가능성.
 * 미해결 = 조각의 읽기 근거 자체가 없음 → stems.json 보강 필요.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyReading, segment, segmentCandidates } from "./ja-reading.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
["vocab","kanji","grammar"].forEach(f=>new Function("window",readFileSync(join(ROOT,"data",f+".js"),"utf8"))(win));

const targets=[];
(win.VOCAB||[]).forEach(v=>{
  if(v.w&&v.r) targets.push({src:`${v.id} 표제어`, jp:v.w, r:v.r});
  if(v.ex&&v.exr) targets.push({src:`${v.id} 예문`, jp:v.ex, r:v.exr});
  (v.collo||[]).forEach((c,i)=>{ if(c.c&&c.r) targets.push({src:`${v.id} 연어[${i}]`, jp:c.c, r:c.r}); });
});
(win.KANJI||[]).forEach(k=>(k.words||[]).forEach((w,i)=>{
  if(w.w&&w.r) targets.push({src:`${k.id} 예시[${i}]`, jp:w.w, r:w.r}); }));
(win.GRAMMAR||[]).forEach(g=>{ if(g.ex&&g.exr) targets.push({src:`${g.id} 예문`, jp:g.ex, r:g.exr}); });

const fail=[], unresolved=new Map(), rule=new Set();
let pass=0;
for(let i=0;i<targets.length;i++){
  const t=targets[i];
  if(i%50===0) process.stdout.write(`\r  ${i}/${targets.length}   `);
  const res=await verifyReading(t.jp, t.r);
  if(res.ok){ pass++; (res.ruleBased||[]).forEach(r=>rule.add(r)); continue; }
  if(res.unresolved){
    if(!unresolved.has(res.unresolved)) unresolved.set(res.unresolved,{raw:res.unresolved,n:0,where:[]});
    const e=unresolved.get(res.unresolved); e.n++; if(e.where.length<2) e.where.push(t.src);
  } else fail.push(`${t.src} "${t.jp}" (${t.r})\n     ${res.why}`);
}
console.log("");
console.log(`검증 대상 ${targets.length}개`);
console.log(`✓ 사전 근거 확인: ${pass}개`);
console.log(`✗ 사전으로 설명 안 됨: ${fail.length}개`);
console.log(`? 읽기 근거 없음(stems 보강 필요): ${unresolved.size}종`);
if(rule.size) console.log(`△ 사전 미확인 — 활용 규칙 근거: ${rule.size}종 (${[...rule].join(", ")})`);
if(fail.length){ console.log("\n── 데이터 오류 가능성 ──"); fail.forEach(f=>console.log("  "+f)); }
if(unresolved.size){
  const list=[...unresolved.values()].sort((a,b)=>b.n-a.n);
  writeFileSync(join(ROOT,"tools","stems-needed.json"), JSON.stringify(list,null,1));
  console.log(`\n── stems.json 에 추가 필요 (${list.length}종) ──`);
  list.slice(0,40).forEach(x=>console.log(`  ${x.raw}  (${x.n}회)  ${x.where.join(", ")}`));
  if(list.length>40) console.log(`  … 그 외 ${list.length-40}종`);
}
process.exit(fail.length?1:0);
