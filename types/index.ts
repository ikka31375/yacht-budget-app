export interface Member {
  id: string;
  name: string;
  grade: number;
  role: string;
  deposit_balance: number;
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
  payment_method?: '現金/振込' | '相殺' | 'デポジット';
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
