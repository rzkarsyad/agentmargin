import { useState, type FormEvent, type CSSProperties } from 'react';
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
  const customers=analytics?.customers??[];
  const knownCustomers=customers.filter(c=>c.unknownEvents===0);
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
  return <div className="shell">
    <aside className="rail" aria-label="Primary navigation">
      <div className="railHeader">
        <a className="brand" href="/dashboard" aria-label="AgentMargin home"><span className="brandMark">↗</span><span>agentmargin<span className="brandDot">.</span></span></a>
        <span className="brandEdition">OPEN SOURCE / ALPHA</span>
      </div>
      <div className="railGroup">
        <span className="railCaption">WORKSPACE</span>
        <nav className="navList" aria-label="Sections">
          <button className={view==='overview'?'navItem active':'navItem'} type="button" aria-current={view==='overview'?'page':undefined} onClick={()=>switchTab('overview')}><span className="navIcon" aria-hidden="true">◫</span>Overview<span className="navTrail" aria-hidden="true">↗</span></button>
          <button className={view==='pricing'?'navItem active':'navItem'} type="button" aria-current={view==='pricing'?'page':undefined} onClick={()=>switchTab('pricing')}><span className="navIcon" aria-hidden="true">◈</span>Model pricing<span className="navTrail" aria-hidden="true">↗</span></button>
        </nav>
        <div className="railDivider"/>
        <span className="railCaption railExtra">RESOURCES</span>
        <a className="railLink" href="https://github.com/rzkarsyad/agentmargin/blob/main/README.md" target="_blank" rel="noreferrer">Documentation <span aria-hidden="true">↗</span></a>
        <a className="railLink" href="https://github.com/rzkarsyad/agentmargin/issues" target="_blank" rel="noreferrer">Report an issue <span aria-hidden="true">↗</span></a>
      </div>
      <div className="railBottom">
        <div className="railStatus"><span className="statusDot"/>LOCAL ENVIRONMENT</div>
        <div className="railBottomPanel"><span>STATUS</span><strong>Experimental preview</strong><small>Version 0.3 candidate<br/>Not production-ready</small></div>
      </div>
    </aside>

    <main className="main">
      <header className="topline">
        <div className="breadcrumbs"><span className="crumbRoot">AGENTMARGIN</span><span className="crumbDivider">/</span><span>{view==='overview'?'Overview':'Model pricing'}</span></div>
        <div className="topMeta"><span className="topDate">CUSTOMER INTELLIGENCE</span><span className="localBadge"><span className="statusDot"/> Local instance</span></div>
      </header>

      <section className="hero">
        <div className="heroCopy"><div className="eyebrow"><span className="eyebrowLine"/> {view==='overview'?'FINANCIAL OVERVIEW':'MODEL PRICING STUDIO'} <span className="heroIndex">/ {view==='overview'?'01':'02'}</span></div>
          <h1>{view==='overview'?<>Know where your<br/><span className="heroAccent">margin goes.</span></>:<>Price every model.<br/><span className="heroAccent">Keep the proof.</span></>}</h1>
          <p className="lede">{view==='overview'?'Customer-level AI economics, without the guesswork. Understand what is known, what is profitable, and what still needs attention.':'Set versioned inference rates with evidence and effective dates. Every calculation should have a defensible source.'}</p>
        </div>
        <div className="heroArtwork" aria-hidden="true">
          <div className="artOrb"><div className="artGrid"/><span className="artArrow">↗</span></div>
          <div className="artCaption"><span>AGENT / MARGIN</span><span className="artGlyph">✳</span></div>
        </div>
      </section>

      <section className="queryBar" aria-label="Workspace controls">
        <div className="queryHeader"><div className="queryTitle"><span className="queryIcon" aria-hidden="true">⌘</span> Workspace access</div><span className="queryHelp">Kept in this tab only · never stored</span></div>
        <div className="authBar">
          <div className="authField"><Input id="key" label="Workspace API key" type="password" value={key} onChange={e=>{setKey(e.target.value);setAnalytics(null);setPrices(null);}} autoComplete="off" placeholder="am_..." /></div>
          {view==='overview'&&<>
            <div className="dateField"><label htmlFor="period-from">From (UTC)</label><input id="period-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
            <div className="dateField"><label htmlFor="period-to">To (inclusive, UTC)</label><input id="period-to" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          </>}
          <div className="authButton"><Button id="load" type="button" loading={working} onClick={view==='overview'?loadOverview:loadPricing}>{view==='overview'?'Load analysis':'Refresh prices'} <span aria-hidden="true">↗</span></Button></div>
        </div>
      </section>
      {error&&<div className="alert error" role="alert"><span aria-hidden="true">!</span>{error}</div>}
      {message&&<div className="alert info" role="status" aria-live="polite"><span aria-hidden="true">✓</span>{message}</div>}

      {view==='overview'?<>
        <section className="sectionIntro"><div><span className="sectionKicker">01 / AT A GLANCE</span><h2>Performance overview</h2></div><Badge tone={analytics?.truncated?'warning':'neutral'} size="sm">{analytics?(analytics.truncated?'Partial dataset':'Period snapshot'):'Awaiting data'}</Badge></section>
        <section className="metrics" aria-label="Customer economics summary">
          <div className="metric metricRevenue"><div className="metricTop"><span>Customer revenue</span><span className="metricSymbol" aria-hidden="true">↗</span></div><strong id="revenue">{analytics?money(revenue.toString()):'—'}</strong><div className="metricBottom"><span className="metricIndicator indicatorMuted">●</span> Selected customers</div></div>
          <div className="metric"><div className="metricTop"><span>Known AI cost</span><span className="metricSymbol" aria-hidden="true">◈</span></div><strong id="cost">{analytics?money(cost.toString()):'—'}</strong><div className="metricBottom"><span className="metricIndicator indicatorMuted">●</span> Reported + priced usage</div></div>
          <div className="metric accentMetric"><div className="metricTop"><span>Verified contribution</span><span className="metricSymbol" aria-hidden="true">⌁</span></div><strong id="contribution">{analytics?(unknown?'Partial · ':'')+money(partial.toString()):'—'}</strong><div className="metricBottom"><span className="metricIndicator indicatorAccent">●</span> {unknown?'Unknown-cost customers excluded':'Tracked inference costs only'}</div></div>
          <div className="metric"><div className="metricTop"><span>Unknown-cost customers</span><span className="metricSymbol" aria-hidden="true">◎</span></div><strong id="unknown">{analytics?unknown:'—'}</strong><div className="metricBottom"><span className="metricIndicator indicatorWarn">●</span> Require price verification</div></div>
        </section>

        <section className="overviewGrid">
          <div className="primaryColumn">
            <section className="surface tableSurface" aria-labelledby="economics-title">
              <div className="surfaceTop surfaceTopStack"><div><span className="sectionKicker">02 / CUSTOMER ANALYTICS</span><h2 id="economics-title">Customer economics</h2><p>Identify which customers create margin and where coverage is incomplete.</p></div><span className="countLabel" id="count">{analytics?(customers.length+(analytics.truncated?'+':'')):'0'} customers</span></div>
              <div className="tableToolbar">
                <div className="customerSearch"><span aria-hidden="true">⌕</span><input aria-label="Search customers" placeholder="Search customers..." value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}/></div>
                <SegmentedControl label="Customer status filter" value={segment} onValueChange={setSegment} options={[{value:'all',label:'All'},{value:'profitable',label:'Profitable'},{value:'at-risk',label:'At risk'},{value:'unknown',label:'Unknown'}]}/>
              </div>
              <div className="tableScroll"><table><thead><tr><th>Customer</th><th>Revenue</th><th>AI cost</th><th>Contribution</th><th>Coverage</th></tr></thead><tbody id="rows">
                {visibleCustomers.map(c=><tr key={c.customerId}>
                  <td className="customerId"><span className="customerAvatar" aria-hidden="true">{c.customerId.slice(0,1).toUpperCase()}</span><div className="customerIdentity"><strong>{c.customerId}</strong><small>{c.usageEvents} usage event{c.usageEvents===1?'':'s'}</small></div></td>
                  <td>{money(c.revenueMicros)}</td><td>{money(c.knownAiCostMicros)}</td>
                  <td className={c.contributionMicros===null?'warningText':BigInt(c.contributionMicros)<0n?'lossText':'gainText'}>{c.contributionMicros===null?'Unknown':money(c.contributionMicros)}<small className="marginDetail">{c.marginBasisPoints===null?'Margin incomplete':(Number(c.marginBasisPoints)/100).toFixed(2)+'% margin'}</small></td>
                  <td><Badge tone={c.unknownEvents?'warning':'success'} size="sm">{c.unknownEvents?'Incomplete':'Complete'}</Badge></td>
                </tr>)}
              </tbody></table></div>
              {!analytics&&<div className="emptyState">Enter your local API key and load a period to inspect your customer economics.</div>}
              {analytics&&visibleCustomers.length===0&&<div className="emptyState">No customers match this filter. Try another status or search.</div>}
              <div className="surfaceFooter"><span>AI contribution excludes hosting, support, and non-inference expenses.</span><span>UTC PERIOD</span></div>
            </section>
            <section id="missing-panel" className="surface tableSurface" aria-labelledby="unknown-model-title">
              <div className="surfaceTop"><div><span className="sectionKicker">03 / PRICING GAPS</span><h2 id="unknown-model-title">Unknown-cost models</h2><p>A missing verified price is not a $0 cost. Historical usage remains unchanged.</p></div><Badge tone={(analytics?.unknownModels?.length??0)>0?'warning':'neutral'} size="sm">{analytics?.unknownModels?.length??0} affected model{(analytics?.unknownModels?.length??0)===1?'':'s'}</Badge></div>
              <div className="tableScroll"><table><thead><tr><th>Model identifier</th><th>Events with unknown cost</th></tr></thead><tbody id="missing-rows">
                {(analytics?.unknownModels??[]).map(m=><tr key={m.model}><td className="customerId"><span className="modelBullet" aria-hidden="true"/> {m.model}</td><td>{m.eventCount}</td></tr>)}
              </tbody></table></div>
              {!analytics?.unknownModels?.length&&<div className="emptyState">{analytics?'No unknown-cost models in the selected period.':'Load analysis to identify missing model costs.'}</div>}
              {analytics?.unknownModelsTruncated&&<p className="notice">Only the 20 most affected models are shown; more exist.</p>}
            </section>
          </div>
          <aside className="insightColumn">
            <section className="insightPanel" aria-labelledby="coverage-title">
              <div className="insightHeading"><span className="sectionKicker">COVERAGE ANALYSIS</span><span className="insightCorner" aria-hidden="true">↗</span></div>
              <h2 id="coverage-title">Cost coverage</h2><p className="insightDescription">Share of displayed customers whose AI inference costs are known.</p>
              <div className="ringWrap"><div className="coverageRing" role="img" aria-label={coverage===null?'No coverage data':'Known cost coverage '+coverage+' percent'} style={{'--coverage':String(coverage??0)+'%'} as CSSProperties}><div className="ringInside"><strong>{coverage===null?'—':coverage+'%'}</strong><span>KNOWN</span></div></div></div>
              <div className="insightStats"><div><span className="dot green"/>Complete coverage <strong>{analytics?knownCustomers.length:'—'}</strong></div><div><span className="dot amber"/>Unknown costs <strong>{analytics?unknown:'—'}</strong></div></div>
              <p className="insightFootnote">{analytics?.truncated?'Based on displayed customers only; customer results are truncated.':'Customer-based coverage, not a share of total AI spend.'}</p>
            </section>
            <section className="insightPanel healthPanel" aria-labelledby="signals-title">
              <div className="insightHeading"><span className="sectionKicker">CUSTOMER SIGNALS</span><span className="signalPulse" aria-hidden="true">✳</span></div><h2 id="signals-title">Margin signals</h2>
              <p className="insightDescription">A quick view of known-cost customers in this selection.</p>
              <div className="signalList">
                <div><span className="signalLabel"><span className="dot green"/>Profitable</span><strong>{analytics?profitable:'—'}</strong></div>
                <div><span className="signalLabel"><span className="dot red"/>At risk</span><strong>{analytics?atRisk:'—'}</strong></div>
                <div><span className="signalLabel"><span className="dot amber"/>Unverified</span><strong>{analytics?unknown:'—'}</strong></div>
              </div>
              <button className="inlineLink" type="button" onClick={()=>switchTab('pricing')}>Open model pricing <span aria-hidden="true">↗</span></button>
            </section>
          </aside>
        </section>
      </>:<>
        <section className="sectionIntro"><div><span className="sectionKicker">01 / PRICING CONTROL</span><h2>Workspace price versions</h2></div><Badge tone="warning" size="sm">Append-only ledger</Badge></section>
        <div className="pricingGrid">
          <section className="surface priceFormSurface" aria-labelledby="price-form-title">
            <div className="surfaceTop"><div><span className="sectionKicker">ADD A NEW VERSION</span><h2 id="price-form-title">Register model pricing</h2><p>Enter independently verified USD rates per million tokens.</p></div><span className="formIcon" aria-hidden="true">＋</span></div>
            <form className="priceForm" onSubmit={createPricing}>
              <Input label="Provider model identifier" value={draft.model} maxLength={200} onChange={e=>change('model',e.target.value)} placeholder="e.g. your-provider-model-id" required/>
              <div className="fieldRow"><div className="dateField"><label htmlFor="effective-from">Effective from (UTC)</label><input id="effective-from" type="date" value={draft.from} onChange={e=>change('from',e.target.value)} required/></div><div className="dateField"><label htmlFor="effective-to">Effective to (UTC, optional)</label><input id="effective-to" type="date" value={draft.to} onChange={e=>change('to',e.target.value)}/></div></div>
              <div className="fieldRow"><Input label="Input $ / 1M tokens" value={draft.input} onChange={e=>change('input',e.target.value)} inputMode="decimal" placeholder="1.00" required/><Input label="Output $ / 1M tokens" value={draft.output} onChange={e=>change('output',e.target.value)} inputMode="decimal" placeholder="4.00" required/></div>
              <Input label="Cached input $ / 1M (optional)" value={draft.cached} onChange={e=>change('cached',e.target.value)} inputMode="decimal" placeholder="Leave blank if unknown" description="Blank means cached usage cannot be estimated. It does not mean free."/>
              <Input label="Source / verification note" value={draft.source} onChange={e=>change('source',e.target.value)} maxLength={500} placeholder="Provider documentation URL and verification date" description="This evidence is kept with your immutable price version." required/>
              <div className="formFooter"><Button type="submit" loading={working}>Add immutable price <span aria-hidden="true">↗</span></Button><span>Stored event costs are never recalculated.</span></div>
            </form>
          </section>
          <aside className="pricingPrinciples">
            <span className="sectionKicker">A BETTER PRICING LEDGER</span>
            <span className="principleArt" aria-hidden="true">◎</span>
            <h3>Clarity is<br/>the feature.</h3>
            <p>A pricing record should explain not just what the rate was, but why and when it applied.</p>
            <div className="principleItem"><span>01</span><div><strong>Workspace-scoped</strong><p>Only your workspace sees and uses these rates.</p></div></div>
            <div className="principleItem"><span>02</span><div><strong>Effective-dated</strong><p>Choose the instant a new version takes effect.</p></div></div>
            <div className="principleItem"><span>03</span><div><strong>Immutable history</strong><p>New versions never rewrite persisted events.</p></div></div>
          </aside>
        </div>
        <section className="surface tableSurface" aria-labelledby="history-title">
          <div className="surfaceTop"><div><span className="sectionKicker">02 / AUDIT TRAIL</span><h2 id="history-title">Price history</h2><p>Recorded workspace rates, newest first. All prices are USD per million tokens.</p></div><Badge tone="neutral" size="sm">{prices?.items.length??0}{prices?.truncated?'+':''} versions</Badge></div>
          <div className="tableScroll"><table><thead><tr><th>Model identifier</th><th>Effective from (UTC)</th><th>Input / 1M</th><th>Output / 1M</th><th>Cached / 1M</th><th>Source evidence</th></tr></thead><tbody>
            {(prices?.items??[]).map(p=><tr key={p.id}><td className="customerId"><span className="modelBullet" aria-hidden="true"/> {p.model}</td><td>{p.effectiveFrom.slice(0,10)}</td><td>{usdRate(p.inputMicrosPerMillion)}</td><td>{usdRate(p.outputMicrosPerMillion)}</td><td>{p.cachedInputMicrosPerMillion==null?'Unknown':usdRate(p.cachedInputMicrosPerMillion)}</td><td className="sourceNote" title={p.sourceNote}>{p.sourceNote}</td></tr>)}
          </tbody></table></div>
          {!prices?.items.length&&<div className="emptyState">{prices?'No workspace price versions yet. Create one above.':'Enter your local key and choose Refresh prices to view history.'}</div>}
          {prices?.truncated&&<p className="notice">This listing contains only the newest 100 records.</p>}
        </section>
      </>}
      <footer><span>AGENTMARGIN / LOCAL ALPHA</span><span>API key held in browser memory only · <a href="https://github.com/rzkarsyad/agentmargin" target="_blank" rel="noreferrer">Source code ↗</a></span></footer>
    </main>
  </div>;
}
