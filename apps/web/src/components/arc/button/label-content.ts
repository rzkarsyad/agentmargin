import {Children,isValidElement} from 'react';
import type {ReactNode} from 'react';

/** Inspect declared children only. Never render/call components or treat label
 * strings as HTML. SVG titles and aria-hidden content are not visible labels.
 */
export function hasButtonLabelText(node:ReactNode):boolean{
 if(typeof node==='string')return node.trim().length>0;
 if(typeof node==='number'||typeof node==='bigint')return true;
 if(node==null||typeof node==='boolean')return false;
 if(isValidElement(node)){
   const props=node.props as {children?:ReactNode;'aria-hidden'?:boolean|'true'|'false'};
   if(node.type==='svg'||props['aria-hidden']===true||props['aria-hidden']==='true')return false;
   return hasButtonLabelText(props.children);
 }
 let found=false;
 Children.forEach(node,child=>{if(child!==node&&hasButtonLabelText(child))found=true;});
 return found;
}
/** Structured identity avoids collisions between literal '<svg>' and an SVG
 * element while retaining label/icon transitions on meaningful child changes.
 */
export function buttonLabelKey(node:ReactNode):string{
 if(node==null||typeof node==='boolean')return JSON.stringify(['empty']);
 if(typeof node==='string'||typeof node==='number'||typeof node==='bigint')return JSON.stringify([typeof node,String(node)]);
 if(isValidElement(node)){
   const type=node.type as string|symbol|{displayName?:string;name?:string};
   const name=typeof type==='string'?type:typeof type==='symbol'?String(type):type.displayName??type.name??'';
   return JSON.stringify(['element',name,buttonLabelKey((node.props as {children?:ReactNode}).children)]);
 }
 return JSON.stringify(Children.toArray(node).map(child=>child===node?'opaque':buttonLabelKey(child)));
}
