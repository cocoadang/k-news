import React from 'react';
const taas='https://taas.koroad.or.kr/sta/acs/gus/selectTfcacdOccrrncSttus.do?menuId=WEB_KMP_OVT_TAC_TOS';
const index='https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1614';
const definitions='https://www.data.go.kr/data/15070339/fileData.do?recommendDataYn=Y';
const samsung='https://d.samsungfire.com/html/productInfo/PRD030301.html';
const link=(url:string,title:string)=><a className="text-cyan-300 underline" href={url} target="_blank" rel="noreferrer">{title}</a>;
const percent=(p:number)=>(p*100).toLocaleString('ko-KR',{maximumFractionDigits:6})+'%';
const annual=[{year:2024,crashes:196349,fatalCrashes:2426,deaths:2521,injured:278482},{year:2025,crashes:193889,fatalCrashes:2482,deaths:2549,injured:271751}];
export function AccidentStatistics({rows}:{rows:{id:string;name:string;p:number}[]}){
 return <div className="mt-4 space-y-4 text-sm leading-6">
 <div className="rounded-xl border border-cyan-800 bg-cyan-950/30 p-4"><h4 className="font-bold text-cyan-200">공식 집계 · 전국 경찰접수 인적피해 사고</h4><p>조회일 2026-11-14 · 최신 확인 연도 2025년. 물적 피해만 있는 사고, 미신고 사고를 포함하는 전체 사고 통계가 아닙니다.</p>
 <div className="overflow-x-auto mt-3"><table className="w-full text-right whitespace-nowrap"><caption className="text-left text-slate-400">원자료: 한국도로교통공단 TAAS / 경찰청, e-나라지표 교통사고 현황</caption><thead><tr><th className="text-left p-2">연도</th><th className="p-2">사고 (건)</th><th className="p-2">사망사고 (건)</th><th className="p-2">사망자 (명)</th><th className="p-2">부상자 (명)</th></tr></thead><tbody>{annual.map(a=><tr key={a.year} className="border-t border-slate-700"><th className="text-left p-2">{a.year}</th>{[a.crashes,a.fatalCrashes,a.deaths,a.injured].map((v,i)=><td key={i} className="p-2">{v.toLocaleString('ko-KR')}</td>)}</tr>)}</tbody></table></div>
 <p className="mt-3">공식 집계에서 계산한 사망사고 구성비: <strong>{percent(2482/193889)}</strong> = 사망사고 2,482건 ÷ 인적피해 사고 193,889건. 분모가 이미 발생한 사고이므로 운전자나 부부의 연간 사고 확률이 아닙니다. 사망자 2,549명을 사망사고 건수 대신 사용하지 않았습니다.</p><p>{link(taas,'TAAS 원자료')} · {link(index,'경찰청 통계·범위 확인')}</p></div>
 <h4 className="font-bold">현재 계산 가정과 대조 · 세 유형 모두 개인 확률 검증 불가</h4>
 <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><caption className="text-left text-slate-400">현재 입력 주행거리·위험배율 반영. 아래 가정은 전국 통계로 보정된 값이 아닙니다.</caption><thead><tr><th className="p-2">계산 대상</th><th className="p-2">현재 연간 확률 (가정)</th><th className="p-2">공식 자료와 비교 결과</th></tr></thead><tbody>{rows.map(a=><tr key={a.id} className="border-t border-slate-700"><th className="p-2 align-top">{a.name}</th><td className="p-2 align-top text-amber-200">{percent(a.p)}<br/>검증 안 됨</td><td className="p-2">{a.id==='death'?<>2025년 사망사고 2,482건은 확인. 구성비 {percent(2482/193889)}와 현재 연간 확률은 분모·대상이 달라 직접 비교하거나 배수로 해석할 수 없습니다. 가해 책임·면책·보장 요건을 충족한 사고와 운전 노출량의 연결자료가 필요합니다.</>:a.id==='serious'?<>공식 통계의 ‘중상’은 3주 이상 치료가 필요한 부상자 분류입니다. 약관의 중상해·상해등급·형사절차 요건과 동일하지 않고, 사람 수도 사고 건수가 아닙니다. 중상자 수를 이 확률로 바꾸지 않았습니다.</>:<>사고 통계는 확정 벌금형과 보험금 지급을 연결하지 않습니다. 사망·중상해 사고에도 벌금이 함께 발생할 수 있어, 벌금 통계를 별도 사고 확률로 단순 합산하면 중복될 수 있습니다. 보장 대상 확정 벌금과 운전 노출량을 연결한 자료는 이번 확인에서 확보하지 못했습니다.</>}</td></tr>)}</tbody></table></div>
 <p>{link(definitions,'한국도로교통공단 공개자료 · 중상·사망 정의')} · {link(samsung,'삼성화재 · 지급사유와 보장 조건')}</p>
 <div className="rounded-xl border border-amber-700 bg-amber-950/20 p-4"><strong className="text-amber-200">검증 결론: 기존 0.0002%·0.004%·0.003%를 실제 통계가 뒷받침한다고 볼 수 없습니다.</strong><p>직접 대체할 수 있는 부부 합산 10,000km 기준의 가해·보장 대상 확률을 확보하지 못해 기본값은 가정으로 유지합니다. 아래에서 주행거리와 추가 가정으로 추정 범위를 비교합니다. 공식 집계만으로 직접 확인된 개인 확률은 아니므로 기존 QQQ 그래프에는 자동 대입하지 않습니다. 주행거리 비례와 위험배율도 미검증 가정입니다. ‘사망 / 중상해 / 벌금형 상해’는 계산상 겹치지 않는 가상 분류로, 실제 통계의 분류체계가 아닙니다. 따라서 현재 기대값으로 보험 불필요 또는 투자 우위를 실증했다고 해석할 수 없습니다.</p></div>
 </div>;
}
