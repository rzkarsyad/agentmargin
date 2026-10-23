import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const marker='<!-- agentmargin:fallback-script -->';
/** Compose trusted, repository-owned assets. This is not an HTML sanitizer or a
 * parser for external documents. Never pass request/provider/customer content.
 * Hash exactly the bytes placed between <script> and </script> for CSP.
 */
export function composeFallbackDashboard(template:string,script:string):{html:string;scriptHash:string}{
 const at=template.indexOf(marker);
 if(at<0||at!==template.lastIndexOf(marker))throw new Error('Expected one fallback script marker');
 return {html:template.slice(0,at)+'<script>'+script+'</script>'+template.slice(at+marker.length),
   scriptHash:createHash('sha256').update(script,'utf8').digest('base64')};
}
export function loadFallbackDashboard():{html:string;scriptHash:string}{
 return composeFallbackDashboard(readFileSync(new URL('./dashboard.html',import.meta.url),'utf8'),
   readFileSync(new URL('./dashboard.js',import.meta.url),'utf8'));
}
