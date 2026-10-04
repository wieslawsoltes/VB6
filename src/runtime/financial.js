/**
 * Double-precision financial functions for the browser VB runtime.
 * Pure ES module: no DOM, network, filesystem or dynamic evaluation.
 * Integration callers may supply their own Variant-to-Double conversion.
 */
import {VBError} from '../language/errors.js';

export class FinancialError extends VBError {
  constructor(number, message) { super(message, number); }
}
const bad = (message = 'Invalid procedure call or argument') => { throw new FinancialError(5, message); };
const finite = value => {
  if (typeof value !== 'number') throw new FinancialError(13, 'Type mismatch');
  if (!Number.isFinite(value)) throw new FinancialError(6, 'Overflow');
  return value;
};
const result = value => { if (!Number.isFinite(value)) throw new FinancialError(6, 'Overflow'); return Object.is(value, -0) ? 0 : value; };
const dueValue = due => { finite(due); if (due !== 0 && due !== 1) bad('Payment timing must be 0 or 1'); return due; };
function growth(rate, periods) {
  finite(rate); finite(periods);
  if (rate === 0) return [1, periods];
  const x = periods * Math.log1p(rate);
  const power = rate > -1 ? Math.exp(x) : Math.pow(1 + rate, periods);
  const annuity = rate > -1 ? Math.expm1(x) / rate : (power - 1) / rate;
  return [result(power), result(annuity)];
}
function payments(rate, periods, payment, present, future, due) {
  [rate, periods, payment, present, future].forEach(finite); dueValue(due);
}
export function FV(rate, periods, payment, present = 0, due = 0) {
  payments(rate, periods, payment, present, 0, due);
  const [power, annuity] = growth(rate, periods);
  return result(-present * power - payment * (1 + rate * due) * annuity);
}
export function PV(rate, periods, payment, future = 0, due = 0) {
  payments(rate, periods, payment, 0, future, due);
  const [power, annuity] = growth(rate, periods);
  if (power === 0) bad('Present value is undefined for these arguments');
  return result((-future - payment * (1 + rate * due) * annuity) / power);
}
export function PMT(rate, periods, present, future = 0, due = 0) {
  payments(rate, periods, 0, present, future, due);
  if (periods === 0) bad('Number of periods cannot be zero');
  const [power, annuity] = growth(rate, periods), denominator = (1 + rate * due) * annuity;
  if (denominator === 0) bad('Payment is undefined for these arguments');
  return result(-(present * power + future) / denominator);
}
export function IPMT(rate, period, periods, present, future = 0, due = 0) {
  payments(rate, periods, 0, present, future, due); finite(period);
  if (periods <= 0 || period < 1 || period > periods) bad('Payment period is outside the loan');
  if (rate === 0 || (due === 1 && period === 1)) return 0;
  const payment = PMT(rate, periods, present, future, due);
  const balance = FV(rate, period - 1, payment, present, due);
  if (due === 1 && rate === -1) bad('Interest is undefined for these arguments');
  return result(balance * rate / (due === 1 ? 1 + rate : 1));
}
export function PPMT(rate, period, periods, present, future = 0, due = 0) {
  return result(PMT(rate, periods, present, future, due) - IPMT(rate, period, periods, present, future, due));
}
export function NPER(rate, payment, present, future = 0, due = 0) {
  payments(rate, 0, payment, present, future, due);
  if (rate === 0) { if (payment === 0) bad('Number of periods is indeterminate'); return result(-(present + future) / payment); }
  if (rate <= -1) bad('Rate must be greater than -1');
  const term = payment * (1 + rate * due);
  const denominator = present * rate + term;
  const delta = -(present + future) * rate / denominator;
  if (denominator === 0 || !(delta > -1) || !Number.isFinite(delta)) bad('No real number of periods exists');
  return result(Math.log1p(delta) / Math.log1p(rate));
}
function numericValues(input, minimum = 1) {
  if (!Array.isArray(input) && !(ArrayBuffer.isView(input) && !(input instanceof DataView))) throw new FinancialError(13, 'Expected a numeric array');
  if (input.length < minimum || input.length > 1000000) bad('Invalid cash-flow array length');
  return Array.from(input, finite);
}
export function NPV(rate, values) {
  finite(rate); if (rate === -1) bad('Rate cannot be -1');
  const cash = numericValues(values); let total = 0;
  // Reverse Horner evaluates periods 1..N without powers or a second data copy.
  for (let i = cash.length - 1; i >= 0; --i) total = result((total + cash[i]) / (1 + rate));
  return result(total);
}
const opposite = (a, b) => (a < 0 && b > 0) || (a > 0 && b < 0);
/** Bounded sign-bracket solver in log(1+rate), with guess-dependent root selection. */
function rateRoot(evaluate, guess) {
  finite(guess); if (guess <= -1) bad('Rate guess must be greater than -1');
  const center = Math.log1p(guess), minimum = -36, maximum = 36;
  const xs = new Set([Math.max(minimum, Math.min(maximum, center)), 0, minimum, maximum]);
  for (const step of [.000001, .00001, .0001, .001, .01, .025, .05, .1, .2, .4, .8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2]) {
    xs.add(Math.max(minimum, Math.min(maximum, center - step)));
    xs.add(Math.max(minimum, Math.min(maximum, center + step)));
  }
  // A fixed secondary scan catches separated roots not bracketed around the guess.
  for (let x = -4; x <= 4; x += .125) xs.add(x);
  const samples = [...xs].sort((a,b) => a-b).map(x => [x, evaluate(x)]);
  const exact = samples.filter(([,y]) => y === 0).sort((a,b) => Math.abs(a[0]-center)-Math.abs(b[0]-center));
  if (exact.length) return result(Math.expm1(exact[0][0]));
  const brackets = [];
  for (let i=1; i<samples.length; ++i) {
    const left=samples[i-1], right=samples[i];
    if (Number.isFinite(left[1]) && Number.isFinite(right[1]) && opposite(left[1],right[1])) brackets.push([left,right]);
  }
  brackets.sort((a,b) => Math.abs((a[0][0]+a[1][0])/2-center)-Math.abs((b[0][0]+b[1][0])/2-center));
  if (!brackets.length) bad('Financial iteration did not find a real rate');
  let [[lo, flo], [hi, fhi]] = brackets[0];
  for (let iteration=0; iteration<256; ++iteration) {
    const mid=(lo+hi)/2, fm=evaluate(mid);
    if (!Number.isFinite(fm)) bad('Financial iteration is not finite');
    if (fm === 0 || hi-lo <= 4*Number.EPSILON*Math.max(1,Math.abs(mid))) return result(Math.expm1(mid));
    if (opposite(flo,fm)) { hi=mid; fhi=fm; } else { lo=mid; flo=fm; }
  }
  bad('Financial iteration did not converge');
}
export function RATE(periods, payment, present, future = 0, due = 0, guess = .1) {
  payments(0, periods, payment, present, future, due);
  if (periods <= 0) bad('Number of periods must be positive');
  const scale=Math.max(Math.abs(payment),Math.abs(present),Math.abs(future));
  if (!scale) bad('Rate is indeterminate');
  payment/=scale; present/=scale; future/=scale;
  return rateRoot(x => {
    const rate=Math.expm1(x), y=periods*x;
    if (x === 0) return present+payment*periods+future;
    // Divide by the growth term when positive to avoid exp(n*log(1+r)) overflow.
    if (y > 0) return present+payment*(1+rate*due)*(-Math.expm1(-y)/rate)+future*Math.exp(-y);
    return present*Math.exp(y)+payment*(1+rate*due)*(Math.expm1(y)/rate)+future;
  }, guess);
}
export function IRR(values, guess = .1) {
  let cash=numericValues(values,2);
  if (!cash.some(v=>v>0) || !cash.some(v=>v<0)) bad('Cash flows must include positive and negative values');
  // Removing zero endpoints avoids spurious roots from exponential underflow.
  let first=0,last=cash.length-1; while(cash[first]===0) first++; while(cash[last]===0) last--;
  cash=cash.slice(first,last+1);
  let scale=0; for(const v of cash) scale=Math.max(scale,Math.abs(v)); cash=cash.map(v=>v/scale);
  return rateRoot(x=>{
    let sum=0;
    if (x>=0) { const discount=Math.exp(-x); for(let i=cash.length-1;i>=0;--i) sum=sum*discount+cash[i]; }
    else { const growth=Math.exp(x); for(let i=0;i<cash.length;++i) sum=sum*growth+cash[i]; }
    return sum;
  },guess);
}
function logSum(logs) {
  let maximum=-Infinity; for (const value of logs) maximum=Math.max(maximum,value);
  let sum=0, correction=0;
  for(const value of logs) { const next=Math.exp(value-maximum)-correction, total=sum+next; correction=(total-sum)-next; sum=total; }
  return maximum+Math.log(sum);
}
export function MIRR(values, financeRate, reinvestRate) {
  finite(financeRate); finite(reinvestRate);
  if (financeRate<=-1 || reinvestRate<=-1) bad('Rates must be greater than -1');
  const cash=numericValues(values,2), positive=[],negative=[];
  const fr=Math.log1p(financeRate), rr=Math.log1p(reinvestRate);
  for(let i=0;i<cash.length;++i) {
    if(cash[i]>0) positive.push(Math.log(cash[i])+(cash.length-1-i)*rr);
    else if(cash[i]<0) negative.push(Math.log(-cash[i])-i*fr);
  }
  if(!positive.length || !negative.length) bad('Cash flows must include positive and negative values');
  return result(Math.expm1((logSum(positive)-logSum(negative))/(cash.length-1)));
}
export function SLN(cost, salvage, life) {
  [cost,salvage,life].forEach(finite); if(life===0) bad('Life cannot be zero');
  return result((cost-salvage)/life);
}
export function SYD(cost, salvage, life, period) {
  [cost,salvage,life,period].forEach(finite);
  if(life<=0 || period<1 || period>life) bad('Invalid asset life or period');
  return result((cost-salvage)*(life-period+1)*2/(life*(life+1)));
}
export function DDB(cost, salvage, life, period, factor = 2) {
  [cost,salvage,life,period,factor].forEach(finite);
  if(cost<0 || salvage<0 || life<=0 || period<=0 || period>life || factor<=0) bad('Invalid depreciation arguments');
  if(salvage>=cost) return 0;
  const rate=Math.min(1,factor/life);
  const before=rate===1 ? (period<=1 ? cost : 0) : cost*Math.pow(1-rate,period-1);
  return result(Math.max(0,Math.min(before*rate,before-salvage)));
}
/** Public VB names; ? denotes an optional argument. */
export const FINANCIAL_SIGNATURES = Object.freeze({
  FV:'rate,nper,pmt,pv?,type?', PV:'rate,nper,pmt,fv?,type?', PMT:'rate,nper,pv,fv?,type?',
  IPMT:'rate,per,nper,pv,fv?,type?', PPMT:'rate,per,nper,pv,fv?,type?',
  NPER:'rate,pmt,pv,fv?,type?', RATE:'nper,pmt,pv,fv?,type?,guess?',
  NPV:'rate,values', IRR:'values,guess?', MIRR:'values,finance_rate,reinvest_rate',
  SLN:'cost,salvage,life', SYD:'cost,salvage,life,period', DDB:'cost,salvage,life,period,factor?'
});
export const FINANCIAL_FUNCTIONS = Object.freeze({FV,PV,PMT,IPMT,PPMT,NPER,RATE,NPV,IRR,MIRR,SLN,SYD,DDB});
