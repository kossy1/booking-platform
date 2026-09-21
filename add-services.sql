USE booking;

-- Replace with your actual business id
SET @business_id = 'f3400290-fa41-4ae4-b581-01e0185de820';

-- ─── 1. Add a staff member ───────────────────────────
SET @staff_id = UUID();

INSERT INTO staff (id, business_id, name, email, is_active, display_order)
VALUES (@staff_id, @business_id, 'Default Staff', 'staff@example.com', 1, 0);

-- ─── 2. Add services ─────────────────────────────────
SET @svc1 = UUID();
SET @svc2 = UUID();
SET @svc3 = UUID();

INSERT INTO services (id, business_id, name, description, duration_minutes, buffer_before, buffer_after, price, is_active, display_order)
VALUES
  (@svc1, @business_id, 'Standard Service', 'A standard appointment', 30, 0, 0, 2500.00, 1, 0),
  (@svc2, @business_id, 'Deluxe Service',   'A longer, premium appointment', 60, 0, 0, 5000.00, 1, 1),
  (@svc3, @business_id, 'Quick Consultation', 'A quick 15-minute consultation', 15, 0, 0, 1000.00, 1, 2);

-- ─── 3. Link staff to services ───────────────────────
INSERT INTO staff_services (staff_id, service_id) VALUES
  (@staff_id, @svc1),
  (@staff_id, @svc2),
  (@staff_id, @svc3);

-- ─── 4. Add weekly availability (Mon–Fri, 9am–5pm) ───
INSERT INTO availability_rules (id, staff_id, day_of_week, start_time, end_time) VALUES
  (UUID(), @staff_id, 1, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 2, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 3, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 4, '09:00:00', '17:00:00'),
  (UUID(), @staff_id, 5, '09:00:00', '17:00:00');

-- ─── Verify ──────────────────────────────────────────
SELECT 'staff' AS table_name, COUNT(*) AS n FROM staff WHERE business_id = @business_id
UNION ALL
SELECT 'services', COUNT(*) FROM services WHERE business_id = @business_id
UNION ALL
SELECT 'availability', COUNT(*) FROM availability_rules WHERE staff_id = @staff_id;