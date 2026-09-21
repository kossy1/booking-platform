USE booking;

-- Fixed UUIDs so we can reference them in later inserts
SET @user_id     = '00000000-0000-0000-0000-000000000001';
SET @business_id = '00000000-0000-0000-0000-000000000002';
SET @staff_id    = '00000000-0000-0000-0000-000000000003';
SET @service_id  = '00000000-0000-0000-0000-000000000004';
SET @customer_id = '00000000-0000-0000-0000-000000000005';

-- 1. Business owner
INSERT INTO users (id, email, full_name, role)
VALUES (@user_id, 'owner@example.com', 'Business Owner', 'business_owner');

-- 2. Customer
INSERT INTO users (id, email, full_name, role)
VALUES (@customer_id, 'customer@example.com', 'Test Customer', 'customer');

-- 3. Business
INSERT INTO businesses (
  id, owner_id, name, slug, category, timezone, currency,
  min_lead_minutes, max_advance_days, status, commission_rate
)
VALUES (
  @business_id, @user_id, 'Test Barbershop', 'test-barbershop', 'barber',
  'America/New_York', 'USD', 60, 90, 'active', 0.0500
);

-- 4. Staff member
INSERT INTO staff (id, business_id, name, email, is_active)
VALUES (@staff_id, @business_id, 'Alice Barber', 'alice@example.com', 1);

-- 5. Service
INSERT INTO services (
  id, business_id, name, duration_minutes, buffer_before, buffer_after, price, is_active
)
VALUES (
  @service_id, @business_id, 'Haircut', 30, 0, 0, 25.00, 1
);

-- 6. Link staff ↔ service
INSERT INTO staff_services (staff_id, service_id) VALUES (@staff_id, @service_id);

-- 7. Working hours: Mon–Fri, 9–5
INSERT INTO availability_rules (id, staff_id, day_of_week, start_time, end_time) VALUES
  (UUID(), @staff_id, 1, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 2, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 3, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 4, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 5, '09:00:00', '17:00:00');