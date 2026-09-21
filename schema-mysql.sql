-- ============================================================
-- Booking Platform Schema (MySQL 8+ / MariaDB 10.6+)
-- Note: XAMPP ships MariaDB. Both work with this schema.
-- ============================================================

CREATE DATABASE IF NOT EXISTS booking
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE booking;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id                  CHAR(36) PRIMARY KEY,
  email               VARCHAR(255) NOT NULL,
  phone               VARCHAR(20),
  password_hash       VARCHAR(255),
  full_name           VARCHAR(255),
  avatar_url          TEXT,
  role                ENUM('customer','business_owner','staff','admin') NOT NULL DEFAULT 'customer',
  email_verified      TINYINT(1) NOT NULL DEFAULT 0,
  stripe_customer_id  VARCHAR(255),
  timezone            VARCHAR(50) NOT NULL DEFAULT 'UTC',
  locale              VARCHAR(10) NOT NULL DEFAULT 'en',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- ============================================================
-- BUSINESSES
-- ============================================================
CREATE TABLE businesses (
  id                    CHAR(36) PRIMARY KEY,
  owner_id              CHAR(36) NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(255) NOT NULL,
  category              ENUM('salon','barber','clinic','photographer','consultant','other') NOT NULL,
  description           TEXT,
  logo_url              TEXT,
  cover_url             TEXT,
  phone                 VARCHAR(20),
  email                 VARCHAR(255),
  website               TEXT,
  address_line1         VARCHAR(255),
  address_line2         VARCHAR(255),
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  postal_code           VARCHAR(20),
  country               CHAR(2),
  latitude              DECIMAL(10,7),
  longitude             DECIMAL(10,7),
  timezone              VARCHAR(50) NOT NULL DEFAULT 'UTC',
  currency              CHAR(3) NOT NULL DEFAULT 'USD',
  min_lead_minutes      INT NOT NULL DEFAULT 60,
  max_advance_days      INT NOT NULL DEFAULT 90,
  cancellation_policy   JSON,
  stripe_account_id     VARCHAR(255),
  stripe_onboarded      TINYINT(1) NOT NULL DEFAULT 0,
  subscription_plan     VARCHAR(50) NOT NULL DEFAULT 'free',
  commission_rate       DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  status                ENUM('pending','active','suspended','closed') NOT NULL DEFAULT 'pending',
  rating_avg            DECIMAL(3,2) NOT NULL DEFAULT 0,
  rating_count          INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_businesses_slug (slug),
  KEY idx_businesses_category (category, status),
  KEY idx_businesses_owner (owner_id),
  CONSTRAINT fk_businesses_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- STAFF
-- ============================================================
CREATE TABLE staff (
  id            CHAR(36) PRIMARY KEY,
  business_id   CHAR(36) NOT NULL,
  user_id       CHAR(36) NULL,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(20),
  avatar_url    TEXT,
  bio           TEXT,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_staff_business (business_id, is_active),
  CONSTRAINT fk_staff_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE services (
  id                CHAR(36) PRIMARY KEY,
  business_id       CHAR(36) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  duration_minutes  INT NOT NULL,
  buffer_before     INT NOT NULL DEFAULT 0,
  buffer_after      INT NOT NULL DEFAULT 0,
  price             DECIMAL(10,2) NOT NULL,
  deposit_required  TINYINT(1) NOT NULL DEFAULT 0,
  deposit_amount    DECIMAL(10,2),
  max_per_slot      INT NOT NULL DEFAULT 1,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  display_order     INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_services_business (business_id, is_active),
  CONSTRAINT fk_services_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT chk_services_duration CHECK (duration_minutes > 0)
) ENGINE=InnoDB;

CREATE TABLE staff_services (
  staff_id    CHAR(36) NOT NULL,
  service_id  CHAR(36) NOT NULL,
  PRIMARY KEY (staff_id, service_id),
  CONSTRAINT fk_ss_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  CONSTRAINT fk_ss_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- AVAILABILITY
-- ============================================================
CREATE TABLE availability_rules (
  id           CHAR(36) PRIMARY KEY,
  staff_id     CHAR(36) NOT NULL,
  day_of_week  TINYINT NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  valid_from   DATE,
  valid_until  DATE,
  KEY idx_avail_staff_day (staff_id, day_of_week),
  CONSTRAINT fk_avail_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  CONSTRAINT chk_avail_dow CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_avail_times CHECK (start_time < end_time)
) ENGINE=InnoDB;

CREATE TABLE time_off (
  id           CHAR(36) PRIMARY KEY,
  staff_id     CHAR(36) NOT NULL,
  start_time   DATETIME NOT NULL,   -- store UTC
  end_time     DATETIME NOT NULL,   -- store UTC
  reason       TEXT,
  is_recurring TINYINT(1) NOT NULL DEFAULT 0,
  rrule        TEXT,
  KEY idx_timeoff_staff_range (staff_id, start_time, end_time),
  CONSTRAINT fk_timeoff_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  CONSTRAINT chk_timeoff_times CHECK (start_time < end_time)
) ENGINE=InnoDB;

-- ============================================================
-- BOOKINGS  (the important part)
-- ============================================================
CREATE TABLE bookings (
  id                  CHAR(36) PRIMARY KEY,
  business_id         CHAR(36) NOT NULL,
  staff_id            CHAR(36) NOT NULL,
  service_id          CHAR(36) NOT NULL,
  customer_id         CHAR(36) NOT NULL,

  start_time          DATETIME NOT NULL,     -- UTC
  end_time            DATETIME NOT NULL,     -- UTC
  buffer_start        DATETIME NOT NULL,
  buffer_end          DATETIME NOT NULL,

  status              ENUM('pending','confirmed','cancelled','completed','no_show') NOT NULL DEFAULT 'pending',
  payment_status      ENUM('unpaid','deposit_paid','paid','refunded','partially_refunded') NOT NULL DEFAULT 'unpaid',

  total_amount        DECIMAL(10,2) NOT NULL,
  deposit_paid        DECIMAL(10,2) NOT NULL DEFAULT 0,
  platform_fee        DECIMAL(10,2) NOT NULL DEFAULT 0,

  customer_notes      TEXT,
  internal_notes      TEXT,
  cancellation_reason TEXT,

  confirmed_at        DATETIME NULL,
  cancelled_at        DATETIME NULL,
  completed_at        DATETIME NULL,

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- ⚠️ No EXCLUDE constraint — we enforce non-overlap via triggers + transaction locks
  KEY idx_bookings_business_start (business_id, start_time),
  KEY idx_bookings_staff_start (staff_id, start_time),
  KEY idx_bookings_customer (customer_id, start_time),
  KEY idx_bookings_active (staff_id, status, buffer_start, buffer_end),

  CONSTRAINT fk_bookings_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_bookings_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_bookings_service FOREIGN KEY (service_id) REFERENCES services(id),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT chk_bookings_times CHECK (start_time < end_time),
  CONSTRAINT chk_bookings_buffers CHECK (buffer_start <= start_time AND buffer_end >= end_time)
) ENGINE=InnoDB;

-- ============================================================
-- ⚠️ THE OVERLAP GUARD (MySQL's substitute for EXCLUDE)
-- ============================================================
-- BEFORE INSERT: reject if any active booking overlaps
-- BEFORE UPDATE: same, but exclude self
DELIMITER //

CREATE TRIGGER trg_bookings_no_overlap_insert
BEFORE INSERT ON bookings
FOR EACH ROW
BEGIN
  IF NEW.status IN ('pending','confirmed') THEN
    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE staff_id = NEW.staff_id
        AND status IN ('pending','confirmed')
        AND buffer_start < NEW.buffer_end
        AND buffer_end   > NEW.buffer_start
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Booking overlaps with an existing booking for this staff member';
    END IF;
  END IF;
END//

CREATE TRIGGER trg_bookings_no_overlap_update
BEFORE UPDATE ON bookings
FOR EACH ROW
BEGIN
  IF NEW.status IN ('pending','confirmed') THEN
    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE staff_id = NEW.staff_id
        AND id <> NEW.id
        AND status IN ('pending','confirmed')
        AND buffer_start < NEW.buffer_end
        AND buffer_end   > NEW.buffer_start
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Booking overlaps with an existing booking for this staff member';
    END IF;
  END IF;
END//

DELIMITER ;

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
  id                    CHAR(36) PRIMARY KEY,
  booking_id            CHAR(36) NULL,
  business_id           CHAR(36) NOT NULL,
  amount                DECIMAL(10,2) NOT NULL,
  platform_fee          DECIMAL(10,2) NOT NULL,
  currency              CHAR(3) NOT NULL,
  stripe_payment_intent VARCHAR(255) UNIQUE,
  stripe_charge_id      VARCHAR(255),
  status                VARCHAR(50),
  payment_method        VARCHAR(50),
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_payments_booking (booking_id),
  KEY idx_payments_business (business_id, created_at),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE refunds (
  id                CHAR(36) PRIMARY KEY,
  payment_id        CHAR(36) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  reason            TEXT,
  stripe_refund_id  VARCHAR(255) UNIQUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- SUBSCRIPTIONS / NOTIFICATIONS / REVIEWS / WAITLIST / AUDIT
-- ============================================================
CREATE TABLE subscriptions (
  id                      CHAR(36) PRIMARY KEY,
  business_id             CHAR(36) NOT NULL,
  plan                    VARCHAR(50) NOT NULL,
  stripe_subscription_id  VARCHAR(255) UNIQUE,
  status                  VARCHAR(50),
  current_period_start    DATETIME NULL,
  current_period_end      DATETIME NULL,
  cancel_at_period_end    TINYINT(1) NOT NULL DEFAULT 0,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_subs_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NULL,
  booking_id  CHAR(36) NULL,
  channel     VARCHAR(20),
  template    VARCHAR(50),
  payload     JSON,
  status      VARCHAR(20) NOT NULL DEFAULT 'queued',
  sent_at     DATETIME NULL,
  error       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_queue (status, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notif_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id           CHAR(36) PRIMARY KEY,
  booking_id   CHAR(36) NOT NULL,
  business_id  CHAR(36) NOT NULL,
  customer_id  CHAR(36) NOT NULL,
  rating       TINYINT NOT NULL,
  comment      TEXT,
  reply        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_booking (booking_id),
  KEY idx_reviews_business (business_id, created_at),
  CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE waitlist (
  id             CHAR(36) PRIMARY KEY,
  business_id    CHAR(36) NOT NULL,
  service_id     CHAR(36) NOT NULL,
  customer_id    CHAR(36) NOT NULL,
  desired_start  DATETIME NOT NULL,
  desired_end    DATETIME NOT NULL,
  notified_at    DATETIME NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_waitlist_lookup (business_id, service_id, desired_start),
  CONSTRAINT fk_waitlist_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_waitlist_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_waitlist_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id     CHAR(36) NULL,
  entity_type  VARCHAR(50),
  entity_id    CHAR(36),
  action       VARCHAR(50),
  changes      JSON,
  ip_address   VARCHAR(45),
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB;

-- ============================================================
-- TRIGGER: auto-refresh business rating
-- ============================================================
DELIMITER //

CREATE TRIGGER trg_review_rating_ai
AFTER INSERT ON reviews
FOR EACH ROW
BEGIN
  UPDATE businesses SET
    rating_avg = (SELECT AVG(rating) FROM reviews WHERE business_id = NEW.business_id),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE business_id = NEW.business_id)
  WHERE id = NEW.business_id;
END//

CREATE TRIGGER trg_review_rating_au
AFTER UPDATE ON reviews
FOR EACH ROW
BEGIN
  UPDATE businesses SET
    rating_avg = (SELECT AVG(rating) FROM reviews WHERE business_id = NEW.business_id),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE business_id = NEW.business_id)
  WHERE id = NEW.business_id;
END//

CREATE TRIGGER trg_review_rating_ad
AFTER DELETE ON reviews
FOR EACH ROW
BEGIN
  UPDATE businesses SET
    rating_avg = COALESCE((SELECT AVG(rating) FROM reviews WHERE business_id = OLD.business_id), 0),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE business_id = OLD.business_id)
  WHERE id = OLD.business_id;
END//

DELIMITER ;