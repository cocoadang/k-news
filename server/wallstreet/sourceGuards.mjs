// Explicit reviewed vocabulary, not a claim of comprehensive named-entity recognition.
// Only NFC, whitespace removal, and Latin case are normalized. No ASR corrections.
export const REVIEWED_TERMS=Object.freeze(['뱅크오브아메리카','백악관','트럼프','러시아','미국','베네수엘라','비트코인','이더리움','스테이블코인','코인베이스','리플','마이크로소프트','알파벳','엔비디아','이스라엘','네타냐후','갤럭시디지털','엔트로픽']);
const compact=s=>s.normalize('NFC').replace(/\s+/gu,'').toLowerCase();
const quantities=s=>compact(s).replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g,n=>n.replace(/,/g,''));
export function assertSourceAnchors(text,source,{nameContext=source}={}){
 const claim=compact(text),evidence=compact(source);
 for(const term of REVIEWED_TERMS)if(claim.includes(compact(term))&&!compact(nameContext).includes(compact(term)))throw Error('unanchored_named_term:'+term);
 for(const term of ['최저점','최고점'])if(claim.includes(term)&&!evidence.includes(term))throw Error('unsupported_strengthening:'+term);
 for(const term of text.match(/[A-Za-z][A-Za-z0-9.-]*/g)||[]){
  const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(!new RegExp('(^|[^A-Za-z0-9])'+escaped+'($|[^A-Za-z0-9])','i').test(source))throw Error('unsupported_source_term');
 }
 for(const quantity of text.match(/\d+(?:[.,]\d+)*\s*(?:%|퍼센트|달러|원|억|조|배|개월|년|분기)/gu)||[]){
  if(!quantities(source).includes(quantities(quantity)))throw Error('unanchored_quantity_or_unit');
 }
 if(/꼭\s*맞으리라는\s*법은\s*없|반드시.*아니|보장.*없/u.test(source)&&!/불확실|보장.*없|단정.*어렵|가능성|반드시.*아니/u.test(text))throw Error('lost_uncertainty_caveat');
 if(/현실\s*가능성이\s*없|실현\s*가능성.*낮/u.test(source)&&!/현실\s*가능성.*없|실현.*어렵|가능성.*낮|불확실/u.test(text))throw Error('lost_feasibility_caveat');
}
