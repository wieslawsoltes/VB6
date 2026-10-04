import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/runtime/financial.js';
const close=(actual,expected,eps=1e-9)=>assert.ok(Math.abs(actual-expected)<=eps*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
const error=(fn,n=5)=>assert.throws(fn,e=>e.number===n);
test('financial zero rate cashflow identities',()=>{
  close(f.FV(0,10,-100,1000),0);close(f.PV(0,10,-100),1000);close(f.PMT(0,10,1000),-100);
  close(f.NPER(0,-100,1000),10);close(f.IPMT(0,3,10,1000),0);close(f.PPMT(0,3,10,1000),-100);
});
test('annuity closed-form reference results',()=>{
  close(f.PMT(.1,10,1000),-162.7453948825115);close(f.PV(.1,10,-100),614.456710570468);
  close(f.FV(.1,10,-100,1000),-1000);close(f.SLN(10000,1000,5),1800);close(f.SYD(10000,1000,5,1),3000);
  [4000,2400,1440,864,296].forEach((v,i)=>close(f.DDB(10000,1000,5,i+1),v));
});
test('annuity inverses and complete principal amortization',()=>{
  for(const rate of [0,1e-12,.001,.01,.1,-.01]) for(const due of [0,1]) {
    const n=12,pv=1000,pmt=f.PMT(rate,n,pv,0,due);
    close(f.FV(rate,n,pmt,pv,due),0,1e-7); close(f.PV(rate,n,pmt,0,due),pv);
    close(f.NPER(rate,pmt,pv,0,due),n,rate===1e-12 ? 1e-4 : 1e-8);
    let principal=0;
    for(let period=1;period<=n;period++) {close(f.IPMT(rate,period,n,pv,0,due)+f.PPMT(rate,period,n,pv,0,due),pmt);principal+=f.PPMT(rate,period,n,pv,0,due);}
    close(principal,-pv,1e-8);
    close(f.RATE(n,pmt,pv,0,due,rate+.001),rate,1e-8);
  }
});
test('due-date interest and invalid payment periods',()=>{
  close(f.IPMT(.1,1,3,1000,0,1),0);
  const payment=f.PMT(.1,3,1000,0,1);close(f.IPMT(.1,2,3,1000,0,1),-(1000+payment)*.1);
  error(()=>f.IPMT(.1,0,3,1000)); error(()=>f.PPMT(.1,4,3,1000));error(()=>f.PMT(0,0,100));
});
test('net-present value period convention and typed arrays',()=>{
  close(f.NPV(.1,[-100,110]),0);close(f.NPV(0,[1,2,3]),6);close(f.NPV(.1,new Float64Array([-100,110])),0);
  error(()=>f.NPV(-1,[1]));error(()=>f.NPV(.1,[]));error(()=>f.NPV(.1,[NaN]),6);error(()=>f.NPV(.1,['1']),13);
});
test('IRR and MIRR independent polynomial roots',()=>{
  close(f.IRR([-100,110]),.1);close(f.IRR([-100,0,121]),.1);close(f.IRR([0,-100,110,0]),.1);
  close(f.IRR([-100,230,-132],.1),.1);close(f.IRR([-100,230,-132],.2),.2);
  close(f.MIRR([-100,0,121],.1,.1),.1); close(f.MIRR([-100,110],0,0),.1);
  error(()=>f.IRR([1,2]));error(()=>f.IRR([-1,-2]));error(()=>f.MIRR([0,0],.1,.1));error(()=>f.MIRR([-1,2],-1,.1));
});
test('bounded solvers reject indeterminate rates',()=>{error(()=>f.RATE(10,0,0));error(()=>f.RATE(0,-10,100));error(()=>f.RATE(10,-10,100,0,0,-1));error(()=>f.IRR([-1,1,-1]));});
test('input errors have stable VB-style numbers',()=>{error(()=>f.FV('0',1,1),13);error(()=>f.FV(Infinity,1,1),6);error(()=>f.FV(.1,1,1,0,2));error(()=>f.SLN(1,0,0));error(()=>f.SYD(1,0,3,4));error(()=>f.DDB(1,0,3,1,0));});
test('13 financial declarations have callable implementations',()=>{assert.equal(Object.keys(f.FINANCIAL_FUNCTIONS).length,13);for(const [name,fn] of Object.entries(f.FINANCIAL_FUNCTIONS)){assert.equal(typeof fn,'function');assert.ok(f.FINANCIAL_SIGNATURES[name].length>=2);}});
