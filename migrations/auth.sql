USE booking;

-- users table already has password_hash column from earlier schema.
-- Confirm it's there:
-- DESC users;

-- Refresh tokens (for logout + long-lived sessions)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL,             -- sha256 hex of the raw token
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  user_agent  VARCHAR(255),
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id, expires_at),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Make sure email column is unique (it should already be)
-- ALTER TABLE users ADD UNIQUE KEY uq_users_email (email);