
(() => {
  const $=id=>document.getElementById(id);
  const today=new Date(), end=today.toISOString().slice(0,10), start=new Date(today.getTime()-29*86400000).toISOString().slice(0,10);
  $('start').value=start;$('end').value=end;
  const dollars=s=>{const n=BigInt(s),a=n<0n?-n:n,cents=(a+5000n)/10000n;
    const whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return (n<0n?'−':'')+'$'+whole+'.'+(cents%100n).toString().padStart(2,'0');};
  const write=(id,value)=>{$(id).textContent=value};
  $('load').addEventListener('click',async()=>{
    const key=$('key').value.trim();if(!key){write('status','Enter an API key.');return}
    const periodStart=$('start').value+'T00:00:00.000Z',periodEnd=new Date(Date.parse($('end').value+'T00:00:00.000Z')+86400000).toISOString();
    write('status','Loading verified workspace data…');$('load').disabled=true;
    try{
      const url='/v1/analytics?start='+encodeURIComponent(periodStart)+'&end='+encodeURIComponent(periodEnd);
      const r=await fetch(url,{headers:{authorization:'Bearer '+key},cache:'no-store'});
      if(!r.ok)throw new Error('Request failed ('+r.status+'). Verify the key and selected period.');
      const data=await r.json();let revenue=0n,cost=0n,contribution=0n,unknown=0;
      const rows=$('rows');rows.replaceChildren();
      for(const c of data.customers){
        revenue+=BigInt(c.revenueMicros);cost+=BigInt(c.knownAiCostMicros);
        if(c.unknownEvents)unknown++;else contribution+=BigInt(c.contributionMicros);
        const tr=document.createElement('tr');
        const values=[c.customerId,dollars(c.revenueMicros),dollars(c.knownAiCostMicros),c.contributionMicros===null?'Unknown':dollars(c.contributionMicros),c.marginBasisPoints===null?'—':(Number(c.marginBasisPoints)/100).toFixed(2)+'%',c.unknownEvents?'Incomplete':'Complete'];
        values.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===3&&c.contributionMicros!==null&&BigInt(c.contributionMicros)<0n)td.className='negative';if(c.unknownEvents&&(i===3||i===5))td.className='unknown';tr.append(td)});rows.append(tr);
      }
      // Model diagnostics query covers the entire selected workspace/period even if customers are truncated.
      // Model identifiers are user-controlled and must never be inserted as HTML.
      const missing=Array.isArray(data.unknownModels)?data.unknownModels:[];
      const missingRows=$('missing-rows');missingRows.replaceChildren();
      for(const item of missing){
        const tr=document.createElement('tr');
        const model=document.createElement('td');model.textContent=item.model;
        const events=document.createElement('td');events.textContent=String(item.eventCount);
        tr.append(model,events);missingRows.append(tr);
      }
      $('missing-panel').hidden=missing.length===0;
      write('missing-note',data.unknownModelsTruncated?'Top 20 models shown · more exist':missing.length+' affected model'+(missing.length===1?'':'s'));
      write('revenue',dollars(revenue));write('cost',dollars(cost));write('contribution',unknown?'Partial · '+dollars(contribution):dollars(contribution));write('unknown',String(unknown));
      write('count',data.customers.length+(data.truncated?'+ customers':' customers'));$('empty').hidden=data.customers.length>0;
      write('status',data.truncated?'Partial results: more than 2,000 customers. Displayed totals are NOT workspace-wide. Narrow the date range or use a complete export.':
        'Updated. '+(unknown?'Contribution excludes customers with unknown usage costs.':'All returned customer costs are known.'));
    }catch(e){write('status',e.message)}finally{$('load').disabled=false}
  });
})();
