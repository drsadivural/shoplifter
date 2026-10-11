-- When/where the enrolled subject was last observed (entered by the enrolling user).
ALTER TABLE profiles ADD COLUMN last_seen_at timestamptz;
