export interface Member {
  id: string;
  name: string;
  grade: number;
  role: string;
}

export interface BillingEvent {
  id: string;
  title: string;
  amount: number;
  due_date: string;
}

export interface Payment {
  id: string;
  billing_event_id: string;
  member_id: string;
  status: '未納' | '支払済';
}

export interface Expense {
  id: string;
  member_id: string;
  title: string;
  amount: number;
  category: string;
  receipt_url?: string;
  status: '未精算' | '精算済';
}
