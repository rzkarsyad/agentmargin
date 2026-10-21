/** Per-process authenticated-workspace request limiter. NOT distributed. */
export class WorkspaceRateLimiter {
  private readonly hits=new Map<string,{start:number,count:number}>();
  readonly maxRequests:number;
  readonly windowMs:number;
  private readonly now:()=>number;
  constructor(maxRequests=120,windowMs=60_000,now=()=>Date.now()){
    if(maxRequests<1||windowMs<1)throw new Error('Invalid rate limit');
    this.maxRequests=maxRequests;this.windowMs=windowMs;this.now=now;
  }
  allow(workspaceId:string):boolean{
    const now=this.now(),old=this.hits.get(workspaceId);
    if(!old||now-old.start>=this.windowMs){this.hits.set(workspaceId,{start:now,count:1});return true;}
    if(old.count>=this.maxRequests)return false;
    old.count++;return true;
  }
}
