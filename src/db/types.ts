import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

export interface DB {
  businesses: BusinessesTable;
  staff: StaffTable;
  services: ServicesTable;
  availability_rules: AvailabilityRulesTable;
  time_off: TimeOffTable;
  bookings: BookingsTable;
}

interface BusinessesTable {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string;
  currency: string;
  min_lead_minutes: number;
  max_advance_days: number;
  cancellation_policy: string | null;
  stripe_account_id: string | null;
  stripe_onboarded: number;
  subscription_plan: string;
  commission_rate: string;
  status: 'pending' | 'active' | 'suspended' | 'closed';
  rating_avg: string;
  rating_count: number;
  logo_url: string | null;
  cover_url: string | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, never>;
}

interface AuditLogTable {
  id: ColumnType<number, never, never>;
  actor_id: string | null;
  entity_type: 'user' | 'business' | 'booking' | 'system';
  entity_id: string | null;
  action: string;
  action_group: string | null;
  changes: string | null;
  ip_address: string | null;
  created_at: ColumnType<Date, never, never>;
}

interface UsersTable {
  // ... existing fields ...
  failed_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  role: 'customer' | 'business_owner' | 'staff' | 'admin' | 'support';
}

interface LoginAttemptsTable {
  id: ColumnType<number, never, never>;
  email: string;
  ip_address: string | null;
  user_agent: string | null;
  success: number;
  reason: string | null;
  created_at: ColumnType<Date, never, never>;
}

// In DB interface:
// login_attempts: LoginAttemptsTable;

interface StaffTable {
  id: string;
  business_id: string;
  name: string;
  is_active: number;                    // TINYINT(1) → 0/1 in mysql2
}

interface ServicesTable {
  id: string;
  business_id: string;
  name: string;
  duration_minutes: number;
  buffer_before: number;
  buffer_after: number;
  price: string;
  is_active: number;
}

interface AvailabilityRulesTable {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;                   // 'HH:MM:SS' from TIME column
  end_time: string;
}

interface TimeOffTable {
  id: string;
  staff_id: string;
  start_time: Date;
  end_time: Date;
}

interface BookingsTable {
  id: string;
  business_id: string;
  staff_id: string;
  service_id: string;
  customer_id: string;
  start_time: Date;
  end_time: Date;
  buffer_start: Date;
  buffer_end: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  payment_status: 'unpaid' | 'deposit_paid' | 'paid' | 'refunded' | 'partially_refunded';
  total_amount: string;
  platform_fee: string;
  customer_notes: string | null;
  created_at: ColumnType<Date, never, never>;
}

export type Booking = Selectable<BookingsTable>;
export type NewBooking = Insertable<BookingsTable>;