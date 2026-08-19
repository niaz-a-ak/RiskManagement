-- SQLite Database Schema for U.S. Bank Fraud Operations

CREATE TABLE IF NOT EXISTS customer_profiles (
    user_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    home_city TEXT NOT NULL,
    avg_monthly_spend REAL NOT NULL,
    avg_transaction_amt REAL NOT NULL,
    card_status TEXT DEFAULT 'ACTIVE',
    phone TEXT,
    email TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    merchant_name TEXT NOT NULL,
    location TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    card_present INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    ip_is_proxy INTEGER NOT NULL,
    ip_proxy_type TEXT,
    status TEXT DEFAULT 'PENDING_REVIEW',
    FOREIGN KEY(user_id) REFERENCES customer_profiles(user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    analyst_id TEXT DEFAULT 'ANALYST_901',
    details TEXT
);

-- Seed Data

INSERT OR REPLACE INTO customer_profiles (user_id, full_name, home_city, avg_monthly_spend, avg_transaction_amt, card_status, phone, email)
VALUES 
('USR_402', 'Alice Smith', 'Minneapolis, USA', 3200.00, 120.00, 'ACTIVE', '+1 (612) 555-0192', 'alice.smith@example.com'),
('USR_101', 'Bob Jones', 'Chicago, USA', 2100.00, 45.00, 'ACTIVE', '+1 (312) 555-0144', 'bob.jones@example.com'),
('USR_303', 'Charlie Brown', 'New York, USA', 5400.00, 250.00, 'ACTIVE', '+1 (212) 555-0188', 'charlie.brown@example.com');

INSERT OR REPLACE INTO transactions (transaction_id, user_id, amount, merchant_name, location, timestamp, card_present, ip_address, ip_is_proxy, ip_proxy_type, status)
VALUES
('TXN_99812', 'USR_402', 1450.00, 'Luxury Duty Free', 'London, UK', '2026-07-29 10:15 UTC', 0, '185.220.101.4', 1, 'Tor Exit Node', 'FLAGGED'),
('TXN_99811', 'USR_402', 42.50, 'Target Store', 'Minneapolis, USA', '2026-07-29 09:45 UTC', 1, '12.180.22.1', 0, NULL, 'CLEARED'),
('TXN_99813', 'USR_402', 1200.00, 'Apple Store', 'Minneapolis, USA', '2026-07-29 11:30 UTC', 1, '12.180.22.1', 0, NULL, 'CLEARED'),
('TXN_99814', 'USR_101', 85.00, 'Starbucks', 'Chicago, USA', '2026-07-29 08:00 UTC', 1, '98.210.33.5', 0, NULL, 'CLEARED'),
('TXN_99815', 'USR_303', 3500.00, 'Crypto Exchange', 'Bucharest, RO', '2026-07-29 14:20 UTC', 0, '194.26.29.112', 1, 'VPN Proxy', 'PENDING_REVIEW');
