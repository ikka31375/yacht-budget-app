export interface RecordReview {
  source_reference?: string | null;
  review_note?: string | null;
  date_provisional?: boolean;
}

export interface Member {
  id: string;
  name: string;
  grade: number;
  role: string;
  deposit_balance?: number;
  is_active?: boolean;
}

export interface BillingEvent {
  id: string;
  title: string;
  amount: number;
  due_date: string;
  type?: string;
  created_at?: string;
}

export interface Payment extends RecordReview {
  id: string;
  billing_event_id: string;
  member_id: string;
  status: '未納' | '支払済' | '一部納入';
  paid_amount: number;
  payment_method?: string;
  paid_at?: string | null;
  paid_on?: string | null;
}

export interface Expense extends RecordReview {
  id: string;
  member_id: string;
  title: string;
  amount: number;
  category: string;
  receipt_url?: string;
  status: '未精算' | '精算済' | '一部精算';
  settled_amount: number;
  reject_reason?: string;
  created_at?: string;
  settled_at?: string | null;
  incurred_on?: string | null;
  settled_on?: string | null;
  settlement_provisional?: boolean;
}

export interface OffsetTransaction {
  id: string;
  member_id: string;
  payment_id: string;
  expense_id: string;
  amount: number;
  created_at: string;
}

export interface ClubTransaction extends RecordReview {
  id: string;
  type: '支出' | '収入';
  title: string;
  amount: number;
  category: string;
  payment_source: '部口座振込' | '部室現金' | '不明';
  event_tag?: string;
  receipt_url?: string;
  created_at?: string;
  transaction_date?: string | null;
}
