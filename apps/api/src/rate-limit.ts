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

/** Process-local preauthentication abuse limiter. Not a replacement for a distributed
 * edge/gateway rate limit on internet-exposed infrastructure.
 *
 * Calls with syntactically invalid or unknown bearer credentials count against
 * a global unknown-credential bucket; legitimate authenticated calls do not.
 * This avoids spoofable X-Forwarded-For / per-IP bypasses on localhost.
 */
export class InvalidCredentialLimiter {
  private start=0;
  private count=0;
  readonly maxAttempts:number;
  readonly windowMs:number;
  private readonly now:()=>number;
  constructor(maxAttempts=60,windowMs=60000,now:()=>number=()=>Date.now()){
    if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||!Number.isSafeInteger(windowMs)||windowMs<1)
      throw new Error('Invalid invalid-credential limiter config');
    this.maxAttempts=maxAttempts;
    this.windowMs=windowMs;
    this.now=now;
  }
  allowInvalidAttempt():boolean{
    const time=this.now();
    if(!this.start||time-this.start>=this.windowMs){
      this.start=time;this.count=1;return true;
    }
    if(this.count>=this.maxAttempts)return false;
    this.count++;return true;
  }
}

/** Bound unauthenticated DB work without a queue or a cache of valid credentials.
 * This is local concurrency containment, not distributed abuse prevention.
 */
export class AuthenticationAdmission {
 private active=0;
 readonly maximum:number;
 constructor(maximum=2){if(!Number.isSafeInteger(maximum)||maximum<1)throw new Error('Invalid authentication capacity');this.maximum=maximum;}
 enter():boolean{if(this.active>=this.maximum)return false;this.active++;return true;}
 leave():void{this.active--;}
}
