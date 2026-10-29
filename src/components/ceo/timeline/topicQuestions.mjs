/** @type {Array<[string,string,RegExp]>} */
const rules=[
 ['investment','AI 투자 방향·효과는 어떻게 달라졌나?',/\b(capex|capital expenditures?|investments?|investing)\b/ig],
 ['release','제품·모델 출시 목표는 어떻게 달라졌나?',/\b(launch\w*|releas\w*|shipping|rollout|introduc\w*|available|availability)\b/ig],
 ['monetization','매출·수익화 근거는 어떻게 달라졌나?',/\b(revenue|monetiz\w*|profit\w*|earnings|paid|paying)\b/ig],
 ['demand','수요·사용량과 공급 여력은 어떻게 달라졌나?',/\b(demand|supply|capacity|usage|users|customers|adoption|tokens)\b/ig],
 ['strategy','경쟁·제휴·사업 방향은 어떻게 달라졌나?',/\b(partner\w*|compet\w*|ecosystem|strategy|strategic)\b/ig]
];
export function questionsFor(statements,personId,companyId){
 const scoped=statements.filter(s=>s.personId===personId&&s.companyId===companyId);
 return rules.map(([id,label,re])=>({id,label,method:'원문 단어 일치 · 분류 검토 필요',items:scoped.flatMap(s=>{
  // Do not classify from a model summary or article headline.
  const q=s.kind==='direct_quote'?s.quoteText||'':'';const terms=[...new Set(q.match(re)||[])];
  return terms.length?[{statement:s,matchedTerms:terms}]:[];
 })})).filter(q=>q.items.length);
}
