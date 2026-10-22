import { useState, type FormEvent } from 'react';
import { Button } from './components/arc/button/button';
import { Input } from './components/arc/input/input';

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

export function App(){
  const [view,setView]=useState<View>('overview');
  const [key,setKey]=useState('');
  const [from,setFrom]=useState(utcDate(-29));
  const [to,setTo]=useState(utcDate());
  const [analytics,setAnalytics]=useState<Analytics|null>(null);
  const [prices,setPrices]=useState<Prices|null>(null);
  const [draft,setDraft]=useState(blankPrice);
  const [working,setWorking]=useState(false);
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
      setAnalytics(result);
      setMessage(result.truncated?'Partial results: customer list is truncated. Displayed sums are not workspace-wide.':'Analytics updated for your local workspace.');
    }catch(e){setError(e instanceof Error?e.message:'Analytics request failed');setMessage('');}
    finally{setWorking(false);}
  }
  async function loadPricing(){
    if(!key.trim()){setError('Enter your local workspace API key.');return;}
    setWorking(true);setError('');setMessage('Loading price history…');
    try{
      const result=await fetchJson<Prices>('/v1/prices',key.trim());
      setPrices(result);
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
  return <div className="shell">
    <aside className="rail" aria-label="Primary navigation">
      <a className="brand" href="/dashboard" aria-label="AgentMargin overview">
        <span className="brandMark">↗</span><span>AgentMargin</span>
      </a>
      <div className="railGroup"><span className="railCaption">WORKSPACE</span>
        <nav className="navList" aria-label="Sections">
          <button className={view==='overview'?'navItem active':'navItem'} aria-current={view==='overview'?'page':undefined} type="button" onClick={()=>switchTab('overview')}><span className="navIcon">◫</span> Overview</button>
          <button className={view==='pricing'?'navItem active':'navItem'} aria-current={view==='pricing'?'page':undefined} type="button" onClick={()=>switchTab('pricing')}><span className="navIcon">◈</span> Model pricing</button>
        </nav>
      </div>
      <div className="railBottom"><span className="statusDot"/> LOCAL EXPERIMENTAL ALPHA
        <p>Source-first analytics<br/>Version 0.3 candidate</p>
      </div>
    </aside>
    <main className="main">
      <header className="topline"><span className="path">WORKSPACE / {view==='overview'?'OVERVIEW':'MODEL PRICING'}</span><span className="localBadge">● Local instance</span></header>
      <section className="hero">
        <div><span className="eyebrow">CUSTOMER INTELLIGENCE / {view==='overview'?'01':'02'}</span>
          <h1>{view==='overview'?<>Know your<br/><em>real margins.</em></>:<>Make every token<br/><em>accountable.</em></>}</h1>
          <p className="lede">{view==='overview'?'Find which customers create value and which quietly consume it. Coverage is part of the truth.':'Build a trusted, immutable pricing history for every AI model. Clear effective dates, no silent repricing.'}</p>
        </div>
        <div className="heroGraphic" aria-hidden="true"><span>↗</span><small>AGENT / MARGIN</small></div>
      </section>
      <section className="authBar" aria-label="Local workspace credentials">
        <div className="authField"><Input id="key" label="Workspace API key" type="password" value={key} onChange={e=>{setKey(e.target.value);setAnalytics(null);setPrices(null);}} autoComplete="off" placeholder="am_…" /></div>
        {view==='overview'&&<>
          <div className="dateField"><label htmlFor="period-from">From (UTC)</label><input id="period-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="dateField"><label htmlFor="period-to">To (inclusive, UTC)</label><input id="period-to" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
        </>}
        <div className="authButton"><Button id="load" type="button" loading={working} onClick={view==='overview'?loadOverview:loadPricing}>{view==='overview'?'Load analysis':'Refresh prices'} ↗</Button></div>
      </section>
      {error&&<div className="alert error" role="alert">{error}</div>}
      {message&&<div className="alert info" role="status" aria-live="polite">{message}</div>}
      {view==='overview'?<>
        <section className="metrics" aria-label="Customer economics summary">
          <div className="metric"><span>Customer revenue</span><strong id="revenue">{analytics?money(revenue.toString()):'—'}</strong><small>For selected customers</small></div>
          <div className="metric"><span>Known AI cost</span><strong id="cost">{analytics?money(cost.toString()):'—'}</strong><small>Reported + priced usage</small></div>
          <div className="metric accentMetric"><span>AI contribution</span><strong id="contribution">{analytics?(unknown?'Partial · ':'')+money(partial.toString()):'—'}</strong><small>{unknown?'Unknown-cost customers excluded':'Revenue minus tracked AI inference'}</small></div>
          <div className="metric"><span>Unknown-cost customers</span><strong id="unknown">{analytics?unknown:'—'}</strong><small>Require pricing review</small></div>
        </section>
        <section className="surface tableSurface" aria-labelledby="economics-title">
          <div className="surfaceTop"><div><h2 id="economics-title">Customer economics</h2><p>Contribution excludes hosting, support and all non-inference spending.</p></div><div className="countLabel" id="count">{analytics?(analytics.customers.length+(analytics.truncated?'+':'')):'0'} customers</div></div>
          <div className="tableScroll"><table><thead><tr><th>Customer</th><th>Revenue</th><th>AI cost</th><th>Contribution</th><th>Margin</th><th>Coverage</th></tr></thead><tbody id="rows">
            {(analytics?.customers??[]).map(c=><tr key={c.customerId}>
              <td className="customerId">{c.customerId}</td><td>{money(c.revenueMicros)}</td><td>{money(c.knownAiCostMicros)}</td>
              <td className={c.contributionMicros===null?'warningText':BigInt(c.contributionMicros)<0n?'lossText':'gainText'}>{c.contributionMicros===null?'Unknown':money(c.contributionMicros)}</td>
              <td>{c.marginBasisPoints===null?'—':(Number(c.marginBasisPoints)/100).toFixed(2)+'%'}</td>
              <td><span className={c.unknownEvents?'chip chipWarning':'chip chipGood'}>{c.unknownEvents?'Incomplete':'Complete'}</span></td>
            </tr>)}
          </tbody></table></div>
          {!analytics?.customers.length&&<div className="emptyState">Enter your local API key and load a period to inspect your customer economics.</div>}
        </section>
        <section id="missing-panel" className="surface tableSurface" aria-labelledby="unknown-model-title">
          <div className="surfaceTop"><div><h2 id="unknown-model-title">Unknown-cost models</h2><p>A missing trusted price is not a $0 expense. Historical events are immutable.</p></div><span className="countLabel">{analytics?.unknownModels?.length??0} models</span></div>
          <div className="tableScroll"><table><thead><tr><th>Model</th><th>Events without verified cost</th></tr></thead><tbody id="missing-rows">
            {(analytics?.unknownModels??[]).map(m=><tr key={m.model}><td className="customerId">{m.model}</td><td>{m.eventCount}</td></tr>)}
          </tbody></table></div>
          {!analytics?.unknownModels?.length&&<div className="emptyState">{analytics?'No unknown-cost models in the selected period.':'Load your analysis to see missing model prices.'}</div>}
          {analytics?.unknownModelsTruncated&&<p className="notice">Only top 20 models are shown; more are affected.</p>}
        </section>
      </>:<>
        <div className="pricingGrid">
          <section className="surface priceFormSurface" aria-labelledby="price-form-title">
            <div className="surfaceTop"><div><span className="eyebrow">NEW VERSION</span><h2 id="price-form-title">Add model pricing</h2><p>Append-only. Later effective dates supersede earlier rates for new events.</p></div></div>
            <form className="priceForm" onSubmit={createPricing}>
              <Input label="Provider model identifier" value={draft.model} maxLength={200} onChange={e=>change('model',e.target.value)} placeholder="e.g. your-provider-model-id" required/>
              <div className="fieldRow">
                <div className="dateField"><label htmlFor="effective-from">Effective from (UTC)</label><input id="effective-from" type="date" value={draft.from} onChange={e=>change('from',e.target.value)} required/></div>
                <div className="dateField"><label htmlFor="effective-to">Effective to (UTC, optional)</label><input id="effective-to" type="date" value={draft.to} onChange={e=>change('to',e.target.value)}/></div>
              </div>
              <div className="fieldRow"><Input label="Input $ / 1M tokens" value={draft.input} onChange={e=>change('input',e.target.value)} inputMode="decimal" placeholder="1.00" required/><Input label="Output $ / 1M tokens" value={draft.output} onChange={e=>change('output',e.target.value)} inputMode="decimal" placeholder="4.00" required/></div>
              <Input label="Cached input $ / 1M (optional)" value={draft.cached} onChange={e=>change('cached',e.target.value)} inputMode="decimal" placeholder="Leave blank if unknown" description="Blank means cached usage cannot be estimated, not that it is free."/>
              <Input label="Source / verification note" value={draft.source} onChange={e=>change('source',e.target.value)} maxLength={500} placeholder="Provider docs URL and verification date" description="Recorded alongside the version for auditing." required/>
              <div className="formFooter"><Button type="submit" loading={working}>Add immutable price ↗</Button><span>New rates never rewrite stored usage costs.</span></div>
            </form>
          </section>
          <aside className="helpPanel" aria-label="Pricing principles">
            <span className="miniLabel">THE PRICING CONTRACT</span><h3>Precision over guesses.</h3>
            <p>Rates are stored as exact USD microdollars per million tokens, not floating-point values.</p>
            <div className="helpDivider"/>
            <b>01 · Workspace-scoped</b><p>Every version belongs to the workspace authenticated by your key.</p>
            <b>02 · Time-aware</b><p>Effective dates apply to new event ingestion; older events retain their original cost.</p>
            <b>03 · Auditable</b><p>Versions cannot be edited or deleted through the API. Include a source to explain every rate.</p>
          </aside>
        </div>
        <section className="surface tableSurface" aria-labelledby="history-title">
          <div className="surfaceTop"><div><h2 id="history-title">Model price history</h2><p>Latest recorded versions first. Listed rates are USD per million tokens.</p></div><span className="countLabel">{prices?.items.length??0}{prices?.truncated?'+':''} versions</span></div>
          <div className="tableScroll"><table><thead><tr><th>Model</th><th>Effective from (UTC)</th><th>Input / 1M</th><th>Output / 1M</th><th>Cached / 1M</th><th>Source note</th></tr></thead><tbody>
            {(prices?.items??[]).map(p=><tr key={p.id}><td className="customerId">{p.model}</td><td>{p.effectiveFrom.slice(0,10)}</td><td>{usdRate(p.inputMicrosPerMillion)}</td><td>{usdRate(p.outputMicrosPerMillion)}</td><td>{p.cachedInputMicrosPerMillion==null?'Unknown':usdRate(p.cachedInputMicrosPerMillion)}</td><td className="sourceNote" title={p.sourceNote}>{p.sourceNote}</td></tr>)}
          </tbody></table></div>
          {!prices?.items.length&&<div className="emptyState">{prices?'No workspace price versions yet. Create one above.':'Enter your local key and choose Refresh prices to view history.'}</div>}
          {prices?.truncated&&<p className="notice">This view is limited to 100 records.</p>}
        </section>
      </>}
      <footer>LOCALHOST-ONLY ALPHA · No keys stored in browser storage · <a href="https://github.com/rzkarsyad/agentmargin">Open source ↗</a></footer>
    </main>
  </div>;
}
