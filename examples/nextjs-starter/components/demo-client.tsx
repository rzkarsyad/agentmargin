'use client';
import {useState} from 'react';
type Result={ok?:boolean;kind?:string;customerId?:string;eventId?:string;tracked?:{inserted:number;duplicate:number};revenue?:{inserted:number;duplicate:number};message?:string};
export default function DemoClient(){
 const [data,setData]=useState<Result|null>(null);
 const [pending,setPending]=useState<'synthetic'|'live'|null>(null);
 async function run(kind:'synthetic'|'live'){
  setPending(kind);setData(null);
  try{
   const response=await fetch(kind==='synthetic'?'/api/simulate':'/api/live',{method:'POST',headers:{'content-type':'application/json'},body:'{}',cache:'no-store'});
   const body=await response.json() as Result;
   setData({...body,ok:response.ok});
  }catch{setData({ok:false,message:'Unable to reach local demo endpoint.'});}
  finally{setPending(null);}
 }
 return <section style={{border:'1px solid #323438',padding:24,borderRadius:8,marginTop:20}}>
  <p>Local demo API at <code>127.0.0.1:8787</code></p>
  <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
   <button disabled={pending!==null} onClick={()=>run('synthetic')} style={{padding:'11px 16px',cursor:'pointer'}}>Track synthetic request</button>
   <button disabled={pending!==null} onClick={()=>run('live')} style={{padding:'11px 16px',cursor:'pointer'}}>Optional real OpenAI request</button>
  </div>
  {pending&&<p role="status">Recording {pending} usage…</p>}
  {data&&<pre aria-live="polite" style={{background:'#191b1f',padding:16,overflowX:'auto',whiteSpace:'pre-wrap'}}>{JSON.stringify(data,null,2)}</pre>}
 </section>;
}
