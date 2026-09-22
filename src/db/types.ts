import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

export interface DB {
  users: UsersTable;
  businesses: BusinessesTable;
  staff: StaffTable;
  services: ServicesTable;
  availability_rules: AvailabilityRulesTable;
  time_off: TimeOffTable;
  bookings: BookingsTable;
  refresh_tokens: RefreshTokensTable;
  audit_log: AuditLogTable;
  login_attempts: LoginAttemptsTable;
  notifications: NotificationsTable;
}

interface UsersTable {
  id: string;
  email: string;
  phone: string | null;
  password_hash: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: 'customer' | 'business_owner' | 'staff' | 'admin' | 'support';
  email_verified: number;
  stripe_customer_id: string | null;
  timezone: string;
  locale: string;
  failed_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, never>;
  deleted_at: Date | null;
}

interface BusinessesTable {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
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
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, never>;
}

interface StaffTable {
  id: string;
  business_id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_active: number;
  display_order: number;
  created_at: ColumnType<Date, never, never>;
}

interface ServicesTable {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_before: number;
  buffer_after: number;
  price: string;
  deposit_required: number;
  deposit_amount: string | null;
  max_per_slot: number;
  is_active: number;
  display_order: number;
  created_at: ColumnType<Date, never, never>;
}

interface AvailabilityRulesTable {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  valid_from: Date | null;
  valid_until: Date | null;
}

interface TimeOffTable {
  id: string;
  staff_id: string;
  start_time: Date;
  end_time: Date;
  reason: string | null;
  is_recurring: number;
  rrule: string | null;
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
  deposit_paid: string;
  platform_fee: string;
  customer_notes: string | null;
  internal_notes: string | null;
  cancellation_reason: string | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, never>;
}

interface RefreshTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: ColumnType<Date, never, never>;
}

interface AuditLogTable {
  id: ColumnType<number, never, never>;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  action_group: string | null;
  changes: string | null;
  ip_address: string | null;
  created_at: ColumnType<Date, never, never>;
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

interface NotificationsTable {
  id: string;
  user_id: string | null;
  booking_id: string | null;
  channel: string;
  template: string;
  payload: string | null;
  status: string;
  sent_at: Date | null;
  error: string | null;
  attempts: number;
  last_error: string | null;
  processed_at: Date | null;
  created_at: ColumnType<Date, never, never>;
}

export type Booking = Selectable<BookingsTable>;
export type NewBooking = Insertable<BookingsTable>;