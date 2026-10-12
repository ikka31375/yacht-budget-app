import type {BillingEvent, Member, Payment} from '../types';
import {parseDate, type ClubData} from './accounting';

export function duesMonth(value:string):string {
  if(!/^\d{4}-\d{2}$/.test(value))throw new Error('部費の対象月を指定してください。');
  return parseDate(`${value}-01`);
}

export function eventDuesMonth(event:BillingEvent):string|null {
  if(event.billing_kind==='other')return null;
  if(event.billing_kind==='dues')return event.billing_month?.slice(0,7)||null;
  // Read-only fallback for the short interval before the database update.
  const dated=/^(\d{4})年(\d{1,2})月部費(?:[（(].*[）)])?$/.exec(event.title);
  const short=/^(\d{1,2})月(?:度)?部費$/.exec(event.title);
  const month=dated?`${dated[1]}-${dated[2].padStart(2,'0')}`:short&&event.due_date?.slice(5,7)===short[1].padStart(2,'0')?event.due_date.slice(0,7):null;
  if(!month)return null;
  try{duesMonth(month);return month;}catch{return null;}
}

export function billingKind(event:BillingEvent):'dues'|'other' {
  return event.billing_kind|| (eventDuesMonth(event)?'dues':'other');
}

export function fiscalMonths(year:number):string[] {
  return Array.from({length:12},(_,i)=>`${year+(i>=9?1:0)}-${String((i+3)%12+1).padStart(2,'0')}`);
}

export function monthlyDues(data:ClubData,member:Member,month:string) {
  const events=data.events.filter(e=>eventDuesMonth(e)===month);
  const ids=new Set(events.map(e=>e.id));
  const payments=data.payments.filter(p=>p.member_id===member.id&&ids.has(p.billing_event_id));
  const billed=payments.reduce((n,p)=>n+(events.find(e=>e.id===p.billing_event_id)?.amount||0),0);
  const paid=payments.reduce((n,p)=>n+(p.paid_amount||0),0);
  const remaining=Math.max(0,billed-paid);
  const reason=member.dues_excluded_months?.[month];
  const state=payments.length?remaining===0?'納入済':paid>0?'一部納入':'未納':reason?'対象外':'要確認';
  return {state,billed,paid,remaining,payments,events,reason:reason||'',duplicate:payments.length>1};
}

export function eligibleMembers(members:Member[],payments:Payment[],events:BillingEvent[],event:BillingEvent):Member[] {
  const month=eventDuesMonth(event);
  const eventIds=new Set(month?events.filter(e=>eventDuesMonth(e)===month).map(e=>e.id):[event.id]);
  const existing=new Set(payments.filter(p=>eventIds.has(p.billing_event_id)).map(p=>p.member_id));
  return members.filter(m=>m.is_active!==false&&!existing.has(m.id)&&(!month||!m.dues_excluded_months?.[month]));
}
