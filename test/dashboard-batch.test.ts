import { describe, expect, it, vi } from 'vitest';
import { estimateBatch, recoverComparisonCurves } from '../src/dashboard-batch.js';
import type { SavedQuery } from '../src/query-history-types.js';

const terms = ['One','Two','Three','Four','Five'];
const dates = Array.from({length:30}, (_,i) => new Date(Date.UTC(2026,9,i+1)).toISOString());
const points = (value:number) => dates.map(t=>({t,value}));
const saved = {
  record:{terms,geo:'US',time:'today 1-m'},result:{series:terms.map(keyword=>({keyword,points:points(40)}))},
} as SavedQuery;
describe('on-demand calibration',()=>{
  it('infers the fifth term from the original comparison with one paid request',async()=>{
    const compare = vi.fn(async(keywords:string[])=>({ok:true,series:keywords.map(keyword=>({keyword,points:points(40)}))}));
    const state=await estimateBatch(saved,{geo:'US'},'request',compare,async()=>{},async()=>null);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![0]).toHaveLength(5);
    expect(state.series.every(row=>row.traffic.average===1600)).toBe(true);
    expect(state.series.filter(row=>row.via)).toHaveLength(1);
  });
  it('rechecks only the weak term and leaves all-zero signals unavailable', async()=>{
    const compare=vi.fn(async(keywords:string[])=>({ok:true,series:keywords.map(keyword=>({keyword,points:points(keyword==='Five'?0:40)}))}));
    const state=await estimateBatch(saved,{geo:'US'},'request',compare,async()=>{},async()=>null);
    expect(compare.mock.calls[1]![0]).toEqual(['Five','psi to bar']);
    expect(state.series.find(row=>row.keyword==='Five')).toMatchObject({reason:'samples',traffic:{average:null}});
    expect(state.series.find(row=>row.keyword==='Five')?.below).toBeUndefined();
  });
  it('preserves densely observed low-score curves and recovers older completed comparisons',async()=>{
    const scores = terms.slice(0,2).map((keyword,i) => ({keyword,points:dates.map((t,n)=>({t,value:i ? 2+n%2 : 50}))}));
    const input = {...saved,record:{...saved.record,tool:'trends_compare' as const,terms:['One','Two']},result:{series:scores}};
    const state=await estimateBatch(input,{geo:'US'},'id',async keywords=>({ok:true,series:keywords.map(keyword=>
      scores.find(s=>s.keyword===keyword)??{keyword,points:points(25)})}),async()=>{},async()=>null);
    const weak=state.series.find(s=>s.keyword==='Two')!;
    expect(weak.traffic.average).toBe(160);
    weak.traffic.average=null; weak.points=[]; weak.reason='samples'; delete weak.anchor;
    recoverComparisonCurves({...input,result:{...input.result,batchVolume:state}});
    expect(state.series.find(s=>s.keyword==='Two')).toMatchObject({via:'One',traffic:{average:160}});
  });
  it('runs another calibration only on a new estimate request after an upstream error', async()=>{
    const one={...saved,record:{...saved.record,terms:['One']}};
    const compare=vi.fn(async(keywords:string[])=>({ok:true,series:keywords.map(keyword=>({keyword,points:points(40)}))} as Record<string,unknown>));
    compare.mockResolvedValueOnce({ok:false,meta:{actorRunId:'one'},error:{code:'NETWORK_ERROR'}});
    const failed=await estimateBatch(one,{geo:'US'},'request',compare,async()=>{},async()=>null);
    expect(failed).toMatchObject({complete:false,error:'NETWORK_ERROR',series:[]});
    expect(compare).toHaveBeenCalledTimes(1);
    const state=await estimateBatch(one,{geo:'US'},'manual-retry',compare,async()=>{},async()=>null);
    expect(compare).toHaveBeenCalledTimes(2);
    expect(compare.mock.calls[0]).toEqual(compare.mock.calls[1]);
    expect(state.series[0]?.traffic.average).toBe(1600);
    expect(state.complete).toBe(true);
  });
  it.each(['NETWORK_ERROR','RATE_LIMITED','BLOCKED'])('never invents sample evidence on %s', async(code)=>{
    const compare=vi.fn(async()=>({ok:false,meta:{actorRunId:'one'},error:{code}}));
    const state=await estimateBatch(saved,{geo:'US'},'request',compare,async()=>{},async()=>null);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({series:[],complete:false,error:code});
  });
});
