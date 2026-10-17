-- BRC-20 Indexer Database Schema
-- ==========================================

-- Indexer state tracking
CREATE TABLE IF NOT EXISTS indexer_state (
    id          SERIAL PRIMARY KEY,
    key         VARCHAR(100) UNIQUE NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO indexer_state (key, value)
VALUES ('last_indexed_height', '-1')
ON CONFLICT (key) DO NOTHING;

-- BRC-20 Deployed Tokens
CREATE TABLE IF NOT EXISTS tokens (
    id                  SERIAL PRIMARY KEY,
    ticker              VARCHAR(10) UNIQUE NOT NULL,
    max_supply          NUMERIC(38, 8) NOT NULL,
    minted_supply       NUMERIC(38, 8) NOT NULL DEFAULT 0,
    limit_per_mint      NUMERIC(38, 8),
    decimal_places      INTEGER NOT NULL DEFAULT 18,
    deployer_address    VARCHAR(100),
    deploy_tx_id        VARCHAR(64) NOT NULL,
    deploy_block_height INTEGER NOT NULL,
    deploy_timestamp    TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens (LOWER(ticker));

-- Address Balances per token
CREATE TABLE IF NOT EXISTS balances (
    id                  SERIAL PRIMARY KEY,
    ticker              VARCHAR(10) NOT NULL,
    address             VARCHAR(100) NOT NULL,
    available_balance   NUMERIC(38, 8) NOT NULL DEFAULT 0,
    transferable_balance NUMERIC(38, 8) NOT NULL DEFAULT 0,
    total_balance       NUMERIC(38, 8) GENERATED ALWAYS AS (available_balance + transferable_balance) STORED,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (ticker, address),
    FOREIGN KEY (ticker) REFERENCES tokens (ticker) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_balances_ticker ON balances (LOWER(ticker));
CREATE INDEX IF NOT EXISTS idx_balances_address ON balances (address);
CREATE INDEX IF NOT EXISTS idx_balances_ticker_address ON balances (LOWER(ticker), address);

-- All valid BRC-20 events
CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(20) NOT NULL CHECK (event_type IN ('deploy', 'mint', 'transfer_inscribe', 'transfer_spend')),
    ticker          VARCHAR(10) NOT NULL,
    amount          NUMERIC(38, 8),
    from_address    VARCHAR(100),
    to_address      VARCHAR(100),
    tx_id           VARCHAR(64) NOT NULL,
    block_height    INTEGER NOT NULL,
    block_timestamp TIMESTAMP WITH TIME ZONE,
    inscription_id  VARCHAR(80),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_ticker ON events (LOWER(ticker));
CREATE INDEX IF NOT EXISTS idx_events_block_height ON events (block_height);
CREATE INDEX IF NOT EXISTS idx_events_tx_id ON events (tx_id);
CREATE INDEX IF NOT EXISTS idx_events_from_address ON events (from_address);
CREATE INDEX IF NOT EXISTS idx_events_to_address ON events (to_address);

-- Pending (inscribed but not yet spent) transfer inscriptions
CREATE TABLE IF NOT EXISTS pending_transfers (
    id              BIGSERIAL PRIMARY KEY,
    inscription_id  VARCHAR(80) UNIQUE NOT NULL,
    ticker          VARCHAR(10) NOT NULL,
    amount          NUMERIC(38, 8) NOT NULL,
    owner_address   VARCHAR(100) NOT NULL,
    utxo_txid       VARCHAR(64) NOT NULL,
    utxo_vout       INTEGER NOT NULL,
    inscribe_block  INTEGER NOT NULL,
    inscribe_tx_id  VARCHAR(64) NOT NULL,
    spent           BOOLEAN NOT NULL DEFAULT FALSE,
    spend_tx_id     VARCHAR(64),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (utxo_txid, utxo_vout)
);

CREATE INDEX IF NOT EXISTS idx_pending_transfers_owner ON pending_transfers (owner_address);
CREATE INDEX IF NOT EXISTS idx_pending_transfers_utxo ON pending_transfers (utxo_txid, utxo_vout);
CREATE INDEX IF NOT EXISTS idx_pending_transfers_spent ON pending_transfers (spent);
