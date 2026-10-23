import type {SafeRequestLog} from './app.ts';

/** Process-level, fixed-cardinality metrics. No tenant, key, URL or error labels. */
export class OperationalMetrics {
  private requests=new Map<string,number>();
  private latency=new Map<string,{sum:number;count:number;buckets:number[]}>();
  private readonly bounds=[0.01,0.05,0.1,0.5,1,5];
  observe(entry:SafeRequestLog):void {
    const key=`route="${entry.route}",status="${entry.status}"`;
    this.requests.set(key,(this.requests.get(key)??0)+1);
    const value=this.latency.get(entry.route)??{sum:0,count:0,buckets:this.bounds.map(()=>0)};
    const seconds=entry.durationMs/1000;
    value.sum+=seconds;value.count++;
    this.bounds.forEach((bound,i)=>{if(seconds<=bound)value.buckets[i]!++;});
    this.latency.set(entry.route,value);
  }
  render():string {
    const rows=['# TYPE agentmargin_http_requests_total counter'];
    for(const [labels,count] of this.requests)rows.push(`agentmargin_http_requests_total{${labels}} ${count}`);
    rows.push('# TYPE agentmargin_http_duration_seconds histogram');
    for(const [route,value] of this.latency){
      this.bounds.forEach((bound,i)=>rows.push(`agentmargin_http_duration_seconds_bucket{route="${route}",le="${bound}"} ${value.buckets[i]}`));
      rows.push(`agentmargin_http_duration_seconds_bucket{route="${route}",le="+Inf"} ${value.count}`,
        `agentmargin_http_duration_seconds_sum{route="${route}"} ${value.sum}`,
        `agentmargin_http_duration_seconds_count{route="${route}"} ${value.count}`);
    }
    return rows.join('\n')+'\n';
  }
}
