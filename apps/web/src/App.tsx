import { useState, type FormEvent, type CSSProperties, type ReactNode } from 'react';
import { Button } from './components/arc/button/button';
import { Input } from './components/arc/input/input';
import { Badge } from './components/arc/badge/badge';
import SegmentedControl from './components/arc/segmented-control/segmented-control';

type View = 'overview' | 'pricing';
type Customer = {
  customerId:string; revenueMicros:string; knownAiCostMicros:string;
  contributionMicros:string|null; marginBasisPoints:string|null;
  unknownEvents:number; usageEvents:number;
};
type Analytics = {
  customers:Customer[]; truncated:boolean;
  unknownModels?:{model:string;eventCount:number}[];
  unknownModelsTruncated?:boolean;
};
type Price = {
  id:string; model:string;effectiveFrom:string;effectiveTo:string|null;
  inputMicrosPerMillion:string;outputMicrosPerMillion:string;
  cachedInputMicrosPerMillion:string|null;sourceNote:string;createdAt:string;
};
type Prices = {items:Price[];truncated:boolean};

function utcDate(offsetDays=0):string {
  return new Date(Date.now()+offsetDays*86400000).toISOString().slice(0,10);
}
function money(micros:string):string {
  const n=BigInt(micros),negative=n<0n,a=negative?-n:n;
  const cents=(a+5000n)/10000n;
  return (negative?'−':'')+'$'+(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(cents%100n).toString().padStart(2,'0');
}
function usdRate(micros:string):string {
  const n=BigInt(micros);
  const whole=(n/1000000n).toString();
  const fraction=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
  return '$'+whole+(fraction?'.'+fraction:'');
}
function usdToMicros(value:string):string {
  if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new Error('Enter a USD amount with at most 6 decimal places');
  }
  const [whole,fraction='']=value.trim().split('.');
  const result=BigInt(whole!)*1000000n+BigInt((fraction+'000000').slice(0,6));
  if(result>9223372036854775807n)throw new Error('Price exceeds supported range');
  return result.toString();
}
function utcStart(date:string):string {
  const d=new Date(date+'T00:00:00.000Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw new Error('Invalid UTC date');
  return d.toISOString();
}
async function fetchJson<T>(path:string,key:string,init:RequestInit={}):Promise<T> {
  const response=await fetch(path,{...init,cache:'no-store',
    headers:{...(init.body?{'Content-Type':'application/json'}:{}),
      authorization:'Bearer '+key,...init.headers}});
  if(!response.ok){
    let message='Request failed ('+response.status+').';
    try {const error=await response.json() as {error?:string};if(error.error)message=error.error;}catch{/* no body */}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
const blankPrice={model:'',from:utcDate(),to:'',input:'',output:'',cached:'',source:''};

type IconName = 'arrow'|'overview'|'pricing'|'docs'|'issue'|'revenue'|'cost'|'contribution'|'unknown';
function UIIcon({name}: {name:IconName}){
  const common={fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  const shape:Record<IconName,ReactNode>={
    arrow:<><path d="M7 17 17 7M8 7h9v9"/></>,
    overview:<><rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/></>,
    pricing:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 15h4"/></>,
    docs:<><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-6-6H8Z"/><path d="M14 3v7h7M8 14h8M8 18h7"/></>,
    issue:<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.8 2.8 0 0 1 5.2 1.5c0 1.8-2.7 2.3-2.7 4"/><path d="M12 17h.01"/></>,
    revenue:<><path d="m3 17 6-6 4 4 8-8M15 7h6v6"/></>,
    cost:<><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M7 9h.01M17 15h.01"/></>,
    contribution:<><path d="M4 17h4l3-10 4 10 2-6h3"/></>,
    unknown:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></>,
  };
  return <svg className="uiIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>{shape[name]}</svg>;
}

export function App(){
  const [view,setView]=useState<View>('overview');
  const [key,setKey]=useState('');
  const [from,setFrom]=useState(utcDate(-29));
  const [to,setTo]=useState(utcDate());
  const [analytics,setAnalytics]=useState<Analytics|null>(null);
  const [prices,setPrices]=useState<Prices|null>(null);
  const [draft,setDraft]=useState(blankPrice);
  const [working,setWorking]=useState(false);
  const [segment,setSegment]=useState('all');
  const [customerSearch,setCustomerSearch]=useState('');
  const [accessOpen,setAccessOpen]=useState(true);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const change=(field:keyof typeof blankPrice,value:string)=>setDraft(old=>({...old,[field]:value}));
  async function loadOverview(){
    if(!key.trim()){setError('Enter your local workspace API key.');return;}
    setWorking(true);setError('');setMessage('Loading customer economics…');
    try{
      const start=utcStart(from),endDate=new Date(utcStart(to));
      endDate.setUTCDate(endDate.getUTCDate()+1);
      const result=await fetchJson<Analytics>('/v1/analytics?start='+encodeURIComponent(start)+'&end='+encodeURIComponent(endDate.toISOString()),key.trim());
      setAnalytics(result);setAccessOpen(false);
      setMessage(result.truncated?'Partial results: customer list is truncated. Displayed sums are not workspace-wide.':'Analytics updated for your local workspace.');
    }catch(e){setError(e instanceof Error?e.message:'Analytics request failed');setMessage('');}
    finally{setWorking(false);}
  }
  async function loadPricing(){
    if(!key.trim()){setError('Enter your local workspace API key.');return;}
    setWorking(true);setError('');setMessage('Loading price history…');
    try{
      const result=await fetchJson<Prices>('/v1/prices',key.trim());
      setPrices(result);setAccessOpen(false);
      setMessage(result.truncated?'Only the newest 100 versions are shown.':'Price history updated.');
    }catch(e){setError(e instanceof Error?e.message:'Pricing request failed');setMessage('');}
    finally{setWorking(false);}
  }
  function switchTab(tab:View){setView(tab);setError('');setMessage('');}
  async function createPricing(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!key.trim()){setError('Enter your local workspace API key.');return;}
    setWorking(true);setError('');setMessage('');
    try{
      const body={
        model:draft.model.trim(),effectiveFrom:utcStart(draft.from),
        effectiveTo:draft.to?utcStart(draft.to):null,
        inputMicrosPerMillion:usdToMicros(draft.input),
        outputMicrosPerMillion:usdToMicros(draft.output),
        cachedInputMicrosPerMillion:draft.cached.trim()?usdToMicros(draft.cached):null,
        sourceNote:draft.source.trim()
      };
      if(!body.model||body.model.length>200)throw new Error('Enter a model identifier of 1–200 characters.');
      if(body.effectiveTo&&body.effectiveTo<=body.effectiveFrom)throw new Error('End date must follow the start date.');
      if(body.sourceNote.length<3||body.sourceNote.length>500)throw new Error('Include a source note of 3–500 characters.');
      await fetchJson<Price>('/v1/prices',key.trim(),{method:'POST',body:JSON.stringify(body)});
      const list=await fetchJson<Prices>('/v1/prices',key.trim());
      setPrices(list);setDraft(blankPrice);setMessage('Price version added. Existing usage events have not been recalculated.');
    }catch(e){setError(e instanceof Error?e.message:'Could not create pricing version');}
    finally{setWorking(false);}
  }
  let revenue=0n,cost=0n,partial=0n,unknown=0;
  for(const c of analytics?.customers??[]){
    revenue+=BigInt(c.revenueMicros);cost+=BigInt(c.knownAiCostMicros);
    if(c.unknownEvents)unknown++;else partial+=BigInt(c.contributionMicros??'0');
  }
  const customers=analytics?.customers??[];
  const knownCustomers=customers.filter(c=>c.unknownEvents===0);
  const profitableCount=knownCustomers.filter(c=>c.contributionMicros!==null&&BigInt(c.contributionMicros)>0n).length;
  const lossCount=knownCustomers.filter(c=>c.contributionMicros!==null&&BigInt(c.contributionMicros)<=0n).length;
  const profitable=knownCustomers.filter(c=>c.contributionMicros!==null&&BigInt(c.contributionMicros)>0n).length;
  const atRisk=knownCustomers.filter(c=>c.contributionMicros!==null&&BigInt(c.contributionMicros)<=0n).length;
  const coverage=customers.length?Math.round(100*knownCustomers.length/customers.length):null;
  const visibleCustomers=customers.filter(c=>{
    const matching=!customerSearch||c.customerId.toLowerCase().includes(customerSearch.trim().toLowerCase());
    if(!matching)return false;
    if(segment==='profitable')return c.unknownEvents===0&&c.contributionMicros!==null&&BigInt(c.contributionMicros)>0n;
    if(segment==='at-risk')return c.unknownEvents===0&&c.contributionMicros!==null&&BigInt(c.contributionMicros)<=0n;
    if(segment==='unknown')return c.unknownEvents>0;
    return true;
  });

  // This chart intentionally uses customer aggregates in the selected period.
  // We have NO historical time series; do not fabricate a line graph or trend.
  const maxAmount=customers.reduce((m,c)=>{
    const r=BigInt(c.revenueMicros),cost=BigInt(c.knownAiCostMicros);
    return r>m?r:cost>m?cost:m;
  },0n);
  const percent=(amount:string)=>maxAmount===0n?'0%':Number(BigInt(amount)*100n/maxAmount)+'%';
  return <div className="shell">
    <aside className="rail" aria-label="Primary navigation">
      <a href="/dashboard" className="brand" aria-label="AgentMargin home"><span className="brandMark"><UIIcon name="arrow"/></span><span>AgentMargin</span></a>
      <div className="railSection">
        <div className="railLabel">WORKSPACE</div>
        <nav className="navList" aria-label="Sections">
          <button type="button" className={view==='overview'?'navItem active':'navItem'} aria-current={view==='overview'?'page':undefined} onClick={()=>switchTab('overview')}><span className="navIcon" aria-hidden="true"><UIIcon name="overview"/></span> Overview</button>
          <button type="button" className={view==='pricing'?'navItem active':'navItem'} aria-current={view==='pricing'?'page':undefined} onClick={()=>switchTab('pricing')}><span className="navIcon" aria-hidden="true"><UIIcon name="pricing"/></span> Model pricing</button>
        </nav>
      </div>
      <div className="railSection railAnalytics">
        <div className="railLabel">ANALYTICS</div>
        <nav className="navList" aria-label="Analytics links">
          <button type="button" className="navItem" onClick={()=>{switchTab('overview');requestAnimationFrame(()=>document.getElementById('economics-title')?.scrollIntoView({block:'start'}));}}><span className="navIcon"><UIIcon name="overview"/></span> Customer activity</button>
          <button type="button" className="navItem" onClick={()=>{switchTab('overview');requestAnimationFrame(()=>document.getElementById('missing-panel')?.scrollIntoView({block:'start'}));}}><span className="navIcon"><UIIcon name="unknown"/></span> Pricing gaps</button>
        </nav>
      </div>
      <div className="railSection railSupport">
        <div className="railLabel">RESOURCES</div>
        <a className="railLink" href="https://github.com/rzkarsyad/agentmargin/blob/main/README.md" target="_blank" rel="noreferrer"><span aria-hidden="true"><UIIcon name="docs"/></span> Documentation <span aria-hidden="true" className="external">↗</span></a>
        <a className="railLink" href="https://github.com/rzkarsyad/agentmargin/issues" target="_blank" rel="noreferrer"><span aria-hidden="true"><UIIcon name="issue"/></span> Report issue <span aria-hidden="true" className="external">↗</span></a>
      </div>
      <div className="railBottom">
        <div className="instance"><span className="instanceDot"/> Local instance</div>
        <div className="buildInfo">AgentMargin v0.3 preview<br/>Experimental · Not production-ready</div>
      </div>
    </aside>

    <main className="main">
      <header className="topline">
        <div className="breadcrumbs"><span>Workspace</span><span className="crumbDivider">/</span><strong>{view==='overview'?'Overview':'Model pricing'}</strong></div>
        <div className="topMeta"><span className="localBadge"><span className="instanceDot"/> Local instance</span></div>
      </header>
      <section className="queryBar" aria-label="Workspace controls">
        <div className="queryHeader"><div><span className={analytics||prices?'instanceDot':'emptyDot'}/> {analytics||prices?'Workspace connected':'Connect your workspace'}</div><button type="button" className="connectionToggle" onClick={()=>setAccessOpen(v=>!v)} aria-expanded={accessOpen}>{accessOpen?'Hide controls':'Change connection'}</button></div>
        <div className={accessOpen?'authBar':'authBar accessHidden'}>
          <div className="authField"><Input id="key" label="Workspace API key" type="password" value={key} onChange={e=>{setKey(e.target.value);setAnalytics(null);setPrices(null);}} autoComplete="off" placeholder="am_..." /></div>
          {view==='overview'&&<>
            <div className="dateField"><label htmlFor="period-from">From (UTC)</label><input id="period-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
            <div className="dateField"><label htmlFor="period-to">To (inclusive, UTC)</label><input id="period-to" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          </>}
          <div className="authButton"><Button id="load" type="button" loading={working} onClick={view==='overview'?loadOverview:loadPricing}>{view==='overview'?'Load analysis':'Refresh prices'} <span aria-hidden="true">↗</span></Button></div>
        </div>
      </section>
      {error&&<div className="alert error" role="alert">{error}</div>}
      {message&&<div className="alert info" role="status" aria-live="polite">{message}</div>}

      {view==='overview'?<>
        <section className="metrics" aria-label="Customer economics summary">
          <div className="metric"><div className="metricTop"><span>Customer revenue</span></div><strong id="revenue">{analytics?money(revenue.toString()):'—'}</strong><small>Selected customers</small></div>
          <div className="metric"><div className="metricTop"><span>Known AI cost</span></div><strong id="cost">{analytics?money(cost.toString()):'—'}</strong><small>Reported + priced usage</small></div>
          <div className="metric"><div className="metricTop"><span>Verified contribution</span></div><strong id="contribution">{analytics?(unknown?'Partial · ':'')+money(partial.toString()):'—'}</strong><small>Excludes unknown-cost customers</small></div>
          <div className="metric"><div className="metricTop"><span>Unknown-cost customers</span></div><strong id="unknown">{analytics?unknown:'—'}</strong><small>Require pricing review</small></div>
        </section>

        <div className="analysisGrid">
          <section className="surface distributionPanel" aria-labelledby="distribution-title">
            <div className="panelHeading"><div><h2 id="distribution-title">Customer economics</h2><p>Revenue and verified inference costs by customer</p></div><div className="legend"><span><i className="legendRevenue"/> Revenue</span><span><i className="legendCost"/> Known AI cost</span></div></div>
            <div className="barChart" role="img" aria-label="Customer revenue and known inference cost comparison">
              <div className="chartAxis" aria-hidden="true"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
              <div className="chartStage"><div className="chartGridlines" aria-hidden="true"><i/><i/><i/><i/><i/></div>
                <div className="chartBars">{customers.slice(0,8).map(c=><div className="chartCustomer" key={c.customerId} title={c.customerId+' · Revenue '+money(c.revenueMicros)+' · Known AI cost '+money(c.knownAiCostMicros)}>
                  <div className="chartPair"><div className="chartRevenue" style={{height:percent(c.revenueMicros)}}/><div className={c.unknownEvents>0?'chartCost unverifiedBar':'chartCost'} style={{height:percent(c.knownAiCostMicros)}}/></div>
                  <span className="chartLabel">{c.customerId}</span>{c.unknownEvents>0&&<span className="barUnverified" title="Cost unverified">Unverified</span>}
                </div>)}</div>
              </div>
            </div>
            {(!analytics||customers.length===0)&&<div className="panelEmpty">{analytics?'No customers in this period.':'Load analysis to show a real customer cost comparison.'}</div>}
            <div className="panelFoot">Customer categories, not a historical trend · Up to 8 customers · Unknown is never $0</div>
          </section>
          <section className="surface coveragePanel" aria-labelledby="coverage-title">
            <div className="panelHeading"><div><h2 id="coverage-title">Cost coverage</h2><p>Share of customers with known costs</p></div><span className="countLabel">{coverage===null?'—':coverage+'%'}</span></div>
            <div className="coverageCount"><strong>{analytics?knownCustomers.length:'—'}</strong><span>of {analytics?customers.length:'—'} customers verified</span></div>
            <div className="coverageTrack" aria-label={coverage===null?'No cost coverage loaded':'Verified coverage '+coverage+' percent'}>
              {customers.length>0&&<><div className="coverageGood" style={{width:(profitableCount/customers.length*100)+'%'}}/><div className="coverageLoss" style={{width:(lossCount/customers.length*100)+'%'}}/><div className="coverageUnknown" style={{width:(unknown/customers.length*100)+'%'}}/></>}
            </div>
            <div className="coverageList"><div><span><i className="legendGood"/> Profitable</span><strong>{analytics?profitableCount:'—'}</strong></div><div><span><i className="legendLoss"/> Loss-making</span><strong>{analytics?lossCount:'—'}</strong></div><div><span><i className="unknownDot"/> Unverified</span><strong>{analytics?unknown:'—'}</strong></div></div>
            <div className="panelFoot">{analytics?.truncated?'Customer results truncated.':'Customer-based coverage, not a share of total AI spend.'}</div>
          </section>
        </div>

        <section className="surface tableSurface" aria-labelledby="economics-title">
          <div className="panelHeading"><div><h2 id="economics-title">Customer activity</h2><p>Customer-level revenue, AI cost and contribution</p></div><span id="count" className="countLabel">{analytics?(customers.length+(analytics.truncated?'+':'')):'0'} customers</span></div>
          <div className="tableToolbar">
            <div className="customerSearch"><span aria-hidden="true">⌕</span><input aria-label="Search customers" placeholder="Search customers" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}/></div>
            <SegmentedControl label="Customer status filter" value={segment} onValueChange={setSegment} options={[{value:'all',label:'All'},{value:'profitable',label:'Profitable'},{value:'at-risk',label:'At risk'},{value:'unknown',label:'Unknown'}]}/>
          </div>
          <div className="tableScroll"><table><thead><tr><th>Customer</th><th>Revenue</th><th>AI cost</th><th>Contribution</th><th>Margin</th><th>Usage</th><th>Coverage</th></tr></thead><tbody id="rows">
            {visibleCustomers.map(c=><tr key={c.customerId}>
              <td className="customerId"><span>{c.customerId}</span></td>
              <td>{money(c.revenueMicros)}</td><td title={c.unknownEvents>0?"Partial known cost: remaining inference usage is unverified":"All usage costs are verified"} className={c.unknownEvents>0?"costIncomplete":undefined}>{c.unknownEvents>0&&BigInt(c.knownAiCostMicros)===0n?"Unverified":money(c.knownAiCostMicros)}{c.unknownEvents>0&&BigInt(c.knownAiCostMicros)>0n?" + unknown":""}</td>
              <td className={c.contributionMicros===null?'warningText':BigInt(c.contributionMicros)<0n?'lossText':'gainText'}>{c.contributionMicros===null?'Unknown':money(c.contributionMicros)}</td>
              <td>{c.marginBasisPoints===null?'—':(Number(c.marginBasisPoints)/100).toFixed(2)+'%'}</td>
              <td>{c.usageEvents}</td>
              <td><Badge tone={c.unknownEvents?'warning':'success'} size="sm">{c.unknownEvents?'Incomplete':'Complete'}</Badge></td>
            </tr>)}
          </tbody></table></div>
          {!analytics&&<div className="tableEmpty">Enter your local API key and load a period to view customer economics.</div>}
          {analytics&&visibleCustomers.length===0&&<div className="tableEmpty">No customers match your search or filter.</div>}
          <div className="panelFoot">Contribution excludes hosting, support and non-inference costs. Unknown is never treated as zero.</div>
        </section>

        <section id="missing-panel" className="surface tableSurface" aria-labelledby="unknown-model-title">
          <div className="panelHeading"><div><h2 id="unknown-model-title">Unknown-cost models</h2><p>Events with missing verified prices · existing costs are immutable</p></div><span className="countLabel">{analytics?.unknownModels?.length??0} affected models</span></div>
          <div className="tableScroll"><table><thead><tr><th>Model identifier</th><th>Events with unknown cost</th></tr></thead><tbody id="missing-rows">
            {(analytics?.unknownModels??[]).map(m=><tr key={m.model}><td className="customerId">{m.model}</td><td>{m.eventCount}</td></tr>)}
          </tbody></table></div>
          {!analytics?.unknownModels?.length&&<div className="tableEmpty">{analytics?'No unknown-cost models in the selected period.':'Load analysis to identify missing model costs.'}</div>}
          {analytics?.unknownModelsTruncated&&<p className="notice">Only the 20 most affected models are shown; more exist.</p>}
        </section>
      </>:<>
        <div className="pricingGrid">
          <section className="surface priceFormSurface" aria-labelledby="price-form-title">
            <div className="panelHeading"><div><h2 id="price-form-title">Add model pricing</h2><p>Versioned rates in USD per million tokens</p></div><Badge tone="neutral" size="sm">Append-only</Badge></div>
            <form className="priceForm" onSubmit={createPricing}>
              <Input label="Provider model identifier" value={draft.model} maxLength={200} onChange={e=>change('model',e.target.value)} placeholder="e.g. your-provider-model-id" required/>
              <div className="fieldRow"><div className="dateField"><label htmlFor="effective-from">Effective from (UTC)</label><input id="effective-from" type="date" value={draft.from} onChange={e=>change('from',e.target.value)} required/></div><div className="dateField"><label htmlFor="effective-to">Effective to (UTC, optional)</label><input id="effective-to" type="date" value={draft.to} onChange={e=>change('to',e.target.value)}/></div></div>
              <div className="fieldRow"><Input label="Input $ / 1M tokens" value={draft.input} onChange={e=>change('input',e.target.value)} inputMode="decimal" placeholder="1.00" required/><Input label="Output $ / 1M tokens" value={draft.output} onChange={e=>change('output',e.target.value)} inputMode="decimal" placeholder="4.00" required/></div>
              <Input label="Cached input $ / 1M (optional)" value={draft.cached} onChange={e=>change('cached',e.target.value)} inputMode="decimal" placeholder="Leave blank if unknown" description="Blank means cached usage cannot be estimated, not that it is free."/>
              <Input label="Source / verification note" value={draft.source} onChange={e=>change('source',e.target.value)} maxLength={500} placeholder="Provider docs URL and verification date" description="Recorded alongside each immutable version." required/>
              <div className="formFooter"><Button type="submit" loading={working}>Add immutable price</Button><span>Stored usage costs never recalculate.</span></div>
            </form>
          </section>
          <aside className="surface auditPanel"><div className="panelHeading"><div><h2>Pricing rules</h2><p>What makes a rate auditable?</p></div></div>
            <div className="rule"><span>01</span><div><strong>Workspace isolation</strong><p>Prices belong only to the workspace authenticated by your API key.</p></div></div>
            <div className="rule"><span>02</span><div><strong>Effective dates</strong><p>New versions apply by UTC effective time for future ingestion.</p></div></div>
            <div className="rule"><span>03</span><div><strong>Immutable history</strong><p>Existing usage events keep their original stored costs.</p></div></div>
          </aside>
        </div>
        <section className="surface tableSurface" aria-labelledby="history-title">
          <div className="panelHeading"><div><h2 id="history-title">Price history</h2><p>Workspace rates sorted by newest recorded version</p></div><span className="countLabel">{prices?.items.length??0}{prices?.truncated?'+':''} versions</span></div>
          <div className="tableScroll"><table><thead><tr><th>Model</th><th>Effective from (UTC)</th><th>Input / 1M</th><th>Output / 1M</th><th>Cached / 1M</th><th>Source note</th></tr></thead><tbody>
            {(prices?.items??[]).map(p=><tr key={p.id}><td className="customerId">{p.model}</td><td>{p.effectiveFrom.slice(0,10)}</td><td>{usdRate(p.inputMicrosPerMillion)}</td><td>{usdRate(p.outputMicrosPerMillion)}</td><td>{p.cachedInputMicrosPerMillion===null?'Unknown':usdRate(p.cachedInputMicrosPerMillion)}</td><td className="sourceNote" title={p.sourceNote}>{p.sourceNote}</td></tr>)}
          </tbody></table></div>
          {!prices?.items.length&&<div className="tableEmpty">{prices?'No workspace price versions yet. Add one above.':'Enter your local key and choose Refresh prices to view history.'}</div>}
          {prices?.truncated&&<p className="notice">Only the newest 100 records are shown.</p>}
        </section>
      </>}
      <footer><span>AgentMargin · Open-source alpha</span><span>Workspace key held in tab memory only · <a href="https://github.com/rzkarsyad/agentmargin" target="_blank" rel="noreferrer">GitHub ↗</a></span></footer>
    </main>
  </div>;
}
