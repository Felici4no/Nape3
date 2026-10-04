-- UPAY3FOOD.agent runtime schema (Postgres / Supabase compatible).
--
-- Truth is agent_events (append-only). agent_runs holds identity, auth hashes
-- and a derived cache (state, version, pending command) for lookups.
--
-- Never stored: seed phrases, wallet private keys, Cloak notes or viewing
-- keys, cookies, session tokens, delivery addresses, raw Pix payloads
-- (only their SHA-256 digest), raw run/executor tokens (only SHA-256 hashes).

create table if not exists browser_executors (
  id            text primary key,
  secret_hash   text not null,            -- sha256 hex of the executor secret
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table if not exists agent_runs (
  id              text primary key,
  user_id         text,
  executor_id     text not null references browser_executors (id),
  run_token_hash  text not null,          -- sha256 hex of the run capability token
  execution_mode  text not null check (execution_mode in ('simulated', 'real')),
  intent          jsonb not null,
  -- derived cache, rewritten on every append (the event log is authoritative)
  state           text not null,
  version         integer not null check (version >= 1),
  pending_command jsonb,
  snapshot        jsonb not null,
  created_at      timestamptz not null,
  updated_at      timestamptz not null
);

create index if not exists agent_runs_executor_active
  on agent_runs (executor_id)
  where state not in ('ORDER_CONFIRMED', 'NO_VALID_OPTION', 'CANCELLED', 'SETTLEMENT_FAILED', 'FAILED');

create table if not exists agent_events (
  run_id   text not null references agent_runs (id),
  seq      integer not null check (seq >= 1),
  type     text not null,
  actor    text not null check (actor in ('user', 'agent', 'browser', 'wallet', 'chain', 'system')),
  payload  jsonb not null,
  at       timestamptz not null,
  primary key (run_id, seq)
);

-- Observations a run's market search used (observer id stripped).
create table if not exists market_observations (
  run_id       text not null references agent_runs (id),
  id           text not null,
  source       text not null,
  observed_at  timestamptz not null,
  synthetic    boolean not null,
  observation  jsonb not null,
  primary key (run_id, id)
);

-- Quotes read by the browser executor in the user's session.
create table if not exists cart_quotes (
  run_id        text not null references agent_runs (id),
  command_id    text not null,
  kind          text not null check (kind in ('revalidation', 'checkout')),
  candidate_id  text,
  total_cents   integer not null check (total_cents >= 0),
  reconciled    boolean not null,
  accepted      boolean not null,
  reasons       jsonb not null default '[]'::jsonb,
  quote         jsonb not null,
  captured_at   timestamptz not null,
  primary key (run_id, command_id)
);

create table if not exists payment_attempts (
  run_id               text primary key references agent_runs (id),
  amount_cents         integer not null check (amount_cents >= 0),
  gross_usdc           numeric(30, 0) not null,
  wallet_address       text not null,
  execution_mode       text not null,
  signature            text,
  status               text not null check (status in ('authorized', 'submitted', 'settled', 'failed')),
  settlement_reference text,
  failure_reason       text,
  updated_at           timestamptz not null
);

-- Append-only in practice: in Supabase, grant the service role INSERT/SELECT on
-- agent_events and revoke UPDATE/DELETE from every role.
