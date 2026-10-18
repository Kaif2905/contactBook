-- ---------------------------------------------------------------------------
-- Contact Book database (MySQL 8.0.16 or newer)
--
-- `npm run db:setup` runs this file for you. You can also paste it into
-- MySQL Workbench after running:  CREATE DATABASE contact_book;  USE contact_book;
-- ---------------------------------------------------------------------------

-- Main table. The UNIQUE and CHECK constraints are the last line of defence:
-- even if a bad row slipped past the API, MySQL itself refuses it.
CREATE TABLE IF NOT EXISTS contacts (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100)  NOT NULL,
  email       VARCHAR(254)  NOT NULL,
  phone       VARCHAR(16)   NOT NULL,   -- stored cleaned, e.g. +919876543210
  contact_group VARCHAR(50) NULL,     -- "group" is a reserved word in SQL
  company     VARCHAR(100)  NULL,
  address     VARCHAR(255)  NULL,
  notes       VARCHAR(1000) NULL,
  status      ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  version     INT UNSIGNED  NOT NULL DEFAULT 1,  -- goes up by 1 on every update
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- No two contacts may share an email or a phone number
  CONSTRAINT uq_contacts_email UNIQUE (email),
  CONSTRAINT uq_contacts_phone UNIQUE (phone),

  -- Basic format checks inside the database
  CONSTRAINT chk_contacts_name  CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT chk_contacts_email CHECK (email REGEXP '^[^@ ]+@[^@ ]+[.][^@ ]+$'),
  CONSTRAINT chk_contacts_phone CHECK (phone REGEXP '^[+]?[0-9]{7,15}$'),

  -- Indexes that make sorting and filtering fast
  INDEX idx_contacts_name (name),
  INDEX idx_contacts_group (contact_group),
  INDEX idx_contacts_company (company),
  INDEX idx_contacts_status (status),
  INDEX idx_contacts_created_at (created_at),
  INDEX idx_contacts_updated_at (updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Change tracking: one row per changed field per update.
CREATE TABLE IF NOT EXISTS contact_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contact_id  INT UNSIGNED    NOT NULL,
  version     INT UNSIGNED    NOT NULL,   -- the contact version this change created
  field_name  VARCHAR(50)     NOT NULL,
  old_value   VARCHAR(1000)   NULL,
  new_value   VARCHAR(1000)   NULL,
  changed_by  VARCHAR(100)    NOT NULL,
  changed_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_history_contact (contact_id, changed_at),
  CONSTRAINT fk_history_contact FOREIGN KEY (contact_id)
    REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Edit locks: who is editing which contact right now.
-- A lock simply expires if the browser stops sending heartbeats.
CREATE TABLE IF NOT EXISTS contact_edit_locks (
  contact_id  INT UNSIGNED NOT NULL,
  session_id  VARCHAR(64)  NOT NULL,   -- one browser tab = one session
  user_name   VARCHAR(100) NOT NULL,
  locked_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (contact_id),
  CONSTRAINT fk_lock_contact FOREIGN KEY (contact_id)
    REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
