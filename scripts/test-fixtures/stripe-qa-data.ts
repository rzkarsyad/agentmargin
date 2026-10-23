/** Fictional provider objects shared ONLY by local regression tests. */
export function stripeQaData(run:string,now=Math.floor(Date.now()/1000)-30){
 const metadata={agentmargin_qa_run:'agentmargin-qa-'+run};
 const invoice=(id:string,amount:number,currency='usd')=>({id,created:now,livemode:false,customer:'cus_qa',currency,status:'paid',amount_paid:amount,status_transitions:{paid_at:now},metadata});
 // Matches official Refund schema: no livemode field on the resource itself.
 const refund=(id:string,amount:number,inv:string)=>({id,created:now,status:'succeeded',currency:'usd',amount,payment_intent:'pi_'+inv,metadata});
 const objects:Record<string,any>={in_29:invoice('in_29',2900),in_99:invoice('in_99',9900),in_eur:invoice('in_eur',1000,'eur'),
  re_partial:refund('re_partial',625,'in_29'),re_full:refund('re_full',9900,'in_99'),
  cn_credit:{id:'cn_credit',livemode:false,created:now,status:'issued',type:'post_payment',currency:'usd',invoice:'in_29',customer:'cus_qa',amount:1200,pre_payment_amount:0,post_payment_amount:1200,out_of_band_amount:null,refunds:[],customer_balance_transaction:'cbtxn_qa',metadata},
  in_unpaid:{...invoice('in_unpaid',0),status:'open',amount_due:1500}};
 const events=[['invoice.paid','in_29'],['invoice.paid','in_99'],['invoice.paid','in_eur'],['refund.created','re_partial'],['refund.created','re_full'],['refund.updated','re_partial'],['refund.updated','re_full'],['credit_note.created','cn_credit']].map(([type,id],i)=>({id:'evt_qa_'+i,type,livemode:false,created:now,api_version:i%2?'2026-09-30.endive':'2025-03-31.basil',data:{object:objects[id!]}}));
 return {events,objects};
}
