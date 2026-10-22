import type {Metadata} from 'next';
export const metadata:Metadata={title:'AgentMargin Next.js starter',robots:'noindex, nofollow'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body style={{fontFamily:'ui-sans-serif,system-ui',background:'#111214',color:'#ececec',maxWidth:850,margin:'60px auto',padding:'0 22px'}}>{children}</body></html>;
}
