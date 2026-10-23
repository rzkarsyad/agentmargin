/** Operator evidence files: validate/read the SAME descriptor, never stat then
 * reopen a filename. Directories must have operator/root-controlled ancestors.
 * Same-UID/host compromise is outside this local filesystem boundary. */
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
export function requirePrivateDirectory(path:string):string{
 const uid=process.getuid?.(),rootOwner=lstatSync('/').uid;
 const canonical=realpathSync(path);
 let current=canonical,first=true;
 for(;;){
   const s=lstatSync(current);
   if(!s.isDirectory()||s.isSymbolicLink()||uid===undefined||![0,rootOwner,uid].includes(s.uid)||
      first&&(s.mode&0o077)!==0||!first&&(s.mode&0o022)!==0&&!([0,rootOwner].includes(s.uid)&&(s.mode&0o1000)!==0))
     throw new Error('Private directory and trusted ancestors required');
   const parent=dirname(current);if(parent===current)break;current=parent;first=false;
 }
 return canonical;
}
export function readCheckedFile(path:string,{privateFile=false,maxBytes=10_000_000}:{privateFile?:boolean;maxBytes?:number}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>10_000_000)throw new Error('Invalid file bound');
 const source=privateFile?join(requirePrivateDirectory(dirname(path)),basename(path)):path;
 const fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
   const metadata=fstatSync(fd);
   if(!metadata.isFile()||metadata.size>maxBytes||privateFile&&((metadata.mode&0o077)!==0||metadata.uid!==process.getuid?.()))throw new Error('Invalid evidence file');
   const chunks:Buffer[]=[];let total=0;
   for(;;){
     const buffer=Buffer.alloc(Math.min(65536,maxBytes-total+1)),length=readSync(fd,buffer,0,buffer.length,null);
     if(!length)break;total+=length;if(total>maxBytes)throw new Error('Input exceeds byte bound');chunks.push(buffer.subarray(0,length));
   }
   return {contents:Buffer.concat(chunks).toString('utf8'),mode:metadata.mode};
 }finally{closeSync(fd);}
}
