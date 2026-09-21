USE booking;

-- Track failed login attempts per email
CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  ip_address  VARCHAR(45),
  user_agent  VARCHAR(255),
  success     TINYINT(1) NOT NULL DEFAULT 0,
  reason      VARCHAR(80),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_email_time (email, created_at),
  KEY idx_ip_time (ip_address, created_at)
) ENGINE=InnoDB;

-- Add security fields to users
ALTER TABLE users ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME NULL;
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;
ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(45) NULL;

-- Audit friendly index
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address, created_at);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at);