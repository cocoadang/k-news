export const defaults = { premium: 10000, probability: 0.1, multiplier: 3, returnRate: 8, costGrowth: 0, settlement: 3000, lawyer: 500, fine: 500, settlementCover: 3000, lawyerCover: 300, fineCover: 500, eligibility: 100 };
export function annuity(rate, periods) {
  return Math.abs(rate) < 1e-12 ? periods : Math.expm1(periods * Math.log1p(rate)) / rate;
}
export function calculate(input, years, multiplier = 1) {
  const p = Math.min(1, Math.max(0, input.probability / 100 * multiplier));
  const cost = (input.settlement + input.lawyer + input.fine) * 10000;
  const cover = (Math.min(input.settlement, input.settlementCover) + Math.min(input.lawyer, input.lawyerCover) + Math.min(input.fine, input.fineCover)) * 10000 * input.eligibility / 100;
  const monthly = Math.expm1(Math.log1p(input.returnRate / 100) / 12);
  const investment = input.premium * annuity(monthly, years * 12);
  const lossFactor = annuity(input.costGrowth / 100, years);
  const uninsuredLoss = p * cost * lossFactor;
  const insuredLoss = p * (cost - cover) * lossFactor;
  const insurance = -insuredLoss;
  const qqq = investment - uninsuredLoss;
  return { p, cost, cover, investment, uninsuredLoss, insuredLoss, insurance, qqq, difference: qqq - insurance, cumulative: -Math.expm1(years * Math.log1p(-p)), premiums: input.premium * years * 12 };
}
