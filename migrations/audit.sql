USE booking;

-- If the audit_log table doesn't exist, create it
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36) NULL,
  entity_type VARCHAR(50),
  entity_id CHAR(36),
  action VARCHAR(80),
  action_group VARCHAR(50) NULL,
  changes JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_actor_time (actor_id, created_at),
  KEY idx_audit_action_group (action_group, created_at)
) ENGINE=InnoDB;

-- If audit_log already exists but is missing action_group, add it:
ALTER TABLE audit_log ADD COLUMN action_group VARCHAR(50) NULL;

-- And add the index if it doesn't exist:
CREATE INDEX idx_audit_action_group ON audit_log(action_group, created_at);

-- Also add the support role to the ENUM
ALTER TABLE users
  MODIFY COLUMN role ENUM('customer','business_owner','staff','admin','support')
  NOT NULL DEFAULT 'customer';