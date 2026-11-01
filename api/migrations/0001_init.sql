CREATE TABLE homes (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL
);

CREATE TABLE members (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  home_id INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT uq_members_home_name UNIQUE (home_id, name)
);

CREATE TABLE bills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  home_id     INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT chk_bills_total CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id         INTEGER NOT NULL,
  member_id       INTEGER NOT NULL,
  amount_cents    INTEGER NOT NULL,
  paid_at         TEXT    DEFAULT NULL,
  idempotency_key TEXT    DEFAULT NULL,
  CONSTRAINT fk_shares_bill   FOREIGN KEY (bill_id)   REFERENCES bills(id),
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id),
  CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id)
);