export interface Member {
  id: string;
  name: string;
  grade: number;
  role: string;
  deposit_balance?: number;
}

export interface BillingEvent {
  id: string;
  title: string;
  amount: number;
  due_date: string;
  type?: string;
  created_at?: string;
}

export interface Payment {
  id: string;
  billing_event_id: string;
  member_id: string;
  status: '未納' | '支払済';
  payment_method?: string;
  offset_expense_id?: string;
}

export interface Expense {
  id: string;
  member_id: string;
  title: string;
  amount: number;
  category: string;
  receipt_url?: string;
  status: '未精算' | '精算済' | '差戻し';
  reject_reason?: string;
  offset_payment_id?: string;
  created_at?: string;
}

export interface ClubTransaction {
  id: string;
  type: '支出' | '収入';
  title: string;
  amount: number;
  category: string;
  payment_source: '部口座振込' | '部室現金';
  event_tag?: string;
  receipt_url?: string;
  created_at?: string;
}
