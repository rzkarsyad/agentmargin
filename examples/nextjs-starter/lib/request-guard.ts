/** Browser CSRF/DNS-rebinding containment for demo routes, not user auth. */
export function rejectDemoRequest(request:Request,configuredOrigin?:string):Response|null{
 const failure=(status:number)=>Response.json({ok:false,message:'Demo request rejected.'},{status});
 let target:URL;
 try{target=new URL(request.url);}catch{return failure(400);}
 // Next can normalize request.url to localhost while the browser used 127.0.0.1.
 // Validate the actual Host authority; never trust forwarded-host headers.
 const host=request.headers.get('host');
 if(host!==null){
   try{
     const authority=new URL(target.protocol+'//'+host);
     if(authority.host.toLowerCase()!==host.toLowerCase()||authority.username||authority.password||authority.pathname!=='/'||authority.search||authority.hash)return failure(400);
     target=authority;
   }catch{return failure(400);}
 }
 if(configuredOrigin!==undefined){
   try{
     const trusted=new URL(configuredOrigin);
     if(trusted.origin!==configuredOrigin||trusted.protocol!=='https:'||target.origin!==trusted.origin)return failure(403);
   }catch{return failure(503);}
 }else if(target.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname))return failure(403);
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return failure(415);
 const origin=request.headers.get('origin');
 if(origin!==null&&origin!==target.origin)return failure(403);
 const site=request.headers.get('sec-fetch-site');
 if(site!==null&&!['same-origin','none'].includes(site))return failure(403);
 return null;
}
