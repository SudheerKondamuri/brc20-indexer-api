# BRC-20 Indexer & API

A **production-grade** BRC-20 token indexer and REST API for the Bitcoin Ordinals ecosystem. It scans the Bitcoin blockchain (regtest/mainnet), parses Ordinal inscriptions, implements the full BRC-20 state machine, and exposes a clean REST API for querying token data.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Docker Compose                          │
│                                                         │
│  ┌──────────────┐   JSON-RPC   ┌──────────────────────┐ │
│  │  Bitcoin Core│ ◄──────────► │  Indexer & API       │ │
│  │  (regtest)   │              │  Node.js (Express)   │ │
│  │  Port: 18443 │              │  Port: 3000          │ │
│  └──────────────┘              └──────────┬───────────┘ │
│                                           │             │
│  ┌──────────────────────────────────────┐ │             │
│  │  PostgreSQL 15                       │◄┘             │
│  │  Port: 5432                          │               │
│  │  Volumes: postgres_data              │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Docker + Docker Compose
- `curl` (for testing)

### 1. Clone and Configure

```bash
cp .env.example .env
# Edit .env if you want to change credentials (defaults work out of the box)
```

### 2. Start All Services

```bash
docker-compose up --build -d
```

All three services will start. The `indexer` will wait for both `bitcoind` and `db` to be healthy before starting.

### 3. Verify Health

```bash
# Check overall health
curl http://localhost:3000/health

# Check indexer status
curl http://localhost:3000/api/v1/status
```

### 4. Seed the Regtest Network

```bash
# Run the seeding script inside the bitcoind container
docker exec brc20_bitcoind bash < scripts/seed-regtest.sh
```

### 5. Query the API

```bash
# Get token details
curl "http://localhost:3000/api/v1/brc20/token?ticker=TEST"

# Get address balance
curl "http://localhost:3000/api/v1/brc20/balance?ticker=TEST&address=<ADDRESS>"

# List holders with pagination
curl "http://localhost:3000/api/v1/brc20/holders?ticker=TEST&limit=5&offset=0"

# Get event history
curl "http://localhost:3000/api/v1/brc20/events?ticker=TEST"
```

## Running Tests

```bash
# Install dependencies
npm install

# Run all unit tests
npm test

# Run with coverage
npm run test:coverage
```

Tests do **not** require a running Bitcoin node or database — they mock all external dependencies.

## API Reference

### GET /api/v1/brc20/token

Get details about a specific BRC-20 token.

| Parameter | Type   | Required | Description     |
|-----------|--------|----------|-----------------|
| ticker    | string | ✓        | Token ticker    |

**200 Response:**
```json
{
  "ticker": "TEST",
  "max_supply": "21000000",
  "minted_supply": "10000000",
  "limit_per_mint": "1000",
  "decimal_places": 18,
  "deploy_timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /api/v1/brc20/balance

Get the token balance for a specific address.

| Parameter | Type   | Required | Description          |
|-----------|--------|----------|----------------------|
| ticker    | string | ✓        | Token ticker         |
| address   | string | ✓        | Bitcoin address      |

**200 Response:**
```json
{
  "ticker": "TEST",
  "address": "bc1q...",
  "balance": "1000",
  "available_balance": "800",
  "transferable_balance": "200"
}
```

### GET /api/v1/brc20/holders

List all holders of a given BRC-20 token (paginated).

| Parameter | Type    | Required | Default | Description              |
|-----------|---------|----------|---------|--------------------------|
| ticker    | string  | ✓        | —       | Token ticker             |
| limit     | integer | ✗        | 20      | Results per page (max 100) |
| offset    | integer | ✗        | 0       | Results to skip          |

**200 Response:**
```json
{
  "holders": [
    { "address": "bc1q...", "balance": "5000" }
  ],
  "total": 42
}
```

### GET /api/v1/brc20/events

Get event history for a token.

| Parameter | Type    | Required | Description              |
|-----------|---------|----------|--------------------------|
| ticker    | string  | ✓        | Token ticker             |
| address   | string  | ✗        | Filter by address        |
| limit     | integer | ✗        | Results per page         |
| offset    | integer | ✗        | Results to skip          |

### GET /health

Returns service health status.

### GET /api/v1/status

Returns indexer sync status.

## Error Responses

All error responses follow this schema:

```json
{ "error": "Descriptive error message" }
```

| Status | Condition                              |
|--------|----------------------------------------|
| 400    | Missing required query parameters      |
| 404    | Token or resource not found            |
| 500    | Internal server error                  |

## Database Schema

| Table              | Purpose                                      |
|--------------------|----------------------------------------------|
| `tokens`           | Deployed BRC-20 tokens and their properties  |
| `balances`         | Per-address token balances (available + transferable) |
| `events`           | Immutable log of all valid BRC-20 operations |
| `pending_transfers`| Stage-1 transfer inscriptions awaiting spend |
| `indexer_state`    | Tracks the last successfully indexed block   |

## BRC-20 State Machine

The indexer implements the full two-stage transfer mechanism:

1. **Deploy**: First-is-first rule — only the first deploy inscription for a ticker is valid.
2. **Mint**: Validates against `limit_per_mint` and `max_supply`. Updates minter's balance atomically.
3. **Transfer (Stage 1 — Inscribe)**: Moves tokens from `available_balance` → `transferable_balance`. Stores as a `pending_transfer`.
4. **Transfer (Stage 2 — Spend)**: When the UTXO containing the transfer inscription is spent, finalizes the transfer: debits sender's transferable balance, credits recipient's available balance.

## Project Structure

```
brc20-indexer-api/
├── docker-compose.yml          # Service orchestration
├── Dockerfile                  # Multi-stage Node.js build
├── .env.example                # Environment variable template
├── scripts/
│   ├── init-db.sql             # PostgreSQL schema
│   └── seed-regtest.sh         # Regtest seeding script
├── src/
│   ├── index.js                # Application entry point
│   ├── api/
│   │   ├── app.js              # Express app factory
│   │   ├── routes/
│   │   │   ├── brc20.js        # BRC-20 endpoint handlers
│   │   │   └── health.js       # Health & status endpoints
│   │   └── middleware/
│   │       └── validators.js   # Input validation & error handling
│   ├── bitcoin/
│   │   ├── rpc.js              # Bitcoin Core JSON-RPC client
│   │   └── inscription.js      # Ordinal inscription parser
│   ├── brc20/
│   │   └── statemachine.js     # BRC-20 validation & state logic
│   ├── db/
│   │   └── database.js         # PostgreSQL pool & helpers
│   ├── indexer/
│   │   └── indexer.js          # Main blockchain scanning loop
│   └── utils/
│       ├── config.js           # Environment config
│       └── logger.js           # Structured logging (pino)
└── tests/
    ├── statemachine.test.js    # BRC-20 validation unit tests
    ├── inscription.test.js     # Inscription parser tests
    └── api.test.js             # REST API integration tests
```

## Environment Variables

| Variable                  | Default               | Description                      |
|---------------------------|-----------------------|----------------------------------|
| `BITCOIN_RPC_HOST`        | `bitcoind`            | Bitcoin Core hostname            |
| `BITCOIN_RPC_PORT`        | `18443`               | Bitcoin Core RPC port (regtest)  |
| `BITCOIN_RPC_USER`        | `bitcoinrpc`          | RPC username                     |
| `BITCOIN_RPC_PASSWORD`    | `bitcoinrpc_password` | RPC password                     |
| `DB_HOST`                 | `db`                  | PostgreSQL hostname              |
| `DB_PORT`                 | `5432`                | PostgreSQL port                  |
| `DB_USER`                 | `brc20user`           | Database user                    |
| `DB_PASSWORD`             | `brc20password`       | Database password                |
| `DB_NAME`                 | `brc20indexer`        | Database name                    |
| `API_PORT`                | `3000`                | HTTP API port                    |
| `INDEXER_START_HEIGHT`    | `0`                   | Block height to start indexing   |
| `INDEXER_POLL_INTERVAL_MS`| `2000`                | Polling interval (ms)            |
| `LOG_LEVEL`               | `info`                | Logging level                    |

## Stopping Services

```bash
docker-compose down           # Stop containers
docker-compose down -v        # Stop and remove volumes (clean state)
```
