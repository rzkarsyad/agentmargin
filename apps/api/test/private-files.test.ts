import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,symlinkSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readCheckedFile,requirePrivateDirectory} from '../../../scripts/lib/private-files.ts';
test('evidence reads reject symlinks, public permissions and excess bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agentmargin-files-'));
 try{
   const file=join(dir,'evidence.json'),link=join(dir,'link');writeFileSync(file,'private',{mode:0o600});symlinkSync(file,link);
   assert.equal(readCheckedFile(file,{privateFile:true}).contents,'private');
   assert.throws(()=>readCheckedFile(link,{privateFile:true}));
   assert.throws(()=>readCheckedFile(file,{maxBytes:2}));
   chmodSync(file,0o644);assert.throws(()=>readCheckedFile(file,{privateFile:true}));
   chmodSync(dir,0o777);assert.throws(()=>requirePrivateDirectory(dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
