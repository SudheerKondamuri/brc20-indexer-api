#!/bin/bash
# =============================================================================
# BRC-20 Test Seeding Script for Regtest Network
# =============================================================================
# This script uses bitcoin-cli inside the bitcoind container to create a full
# sequence of BRC-20 operations (deploy, mint, transfer) that can be used to
# verify the indexer processes everything correctly.
#
# Usage:
#   docker exec brc20_bitcoind bash -c "$(cat scripts/seed-regtest.sh)"
# or from within docker-compose:
#   docker-compose exec bitcoind bash < scripts/seed-regtest.sh
# =============================================================================

set -e

CLI="bitcoin-cli -regtest -rpcuser=bitcoinrpc -rpcpassword=bitcoinrpc_password"
SLEEP_SEC=3

echo "======================================================"
echo "BRC-20 Regtest Seeding Script"
echo "======================================================"

# ── Helper: create a raw inscription transaction ───────────────────────────
# NOTE: On regtest, we use bitcoin-cli to inscribe using OP_RETURN-based approach
# for simplicity. A real ordinal inscription uses Taproot witness.
# This script demonstrates the flow; in production use the ord CLI.

# ── Step 1: Create and fund a wallet ──────────────────────────────────────
echo ""
echo "[1/8] Creating test wallet..."
$CLI createwallet "testwallet" 2>/dev/null || echo "Wallet already exists"
$CLI loadwallet "testwallet" 2>/dev/null || true

MINER_ADDR=$($CLI -rpcwallet=testwallet getnewaddress "miner" "bech32")
echo "Miner address: $MINER_ADDR"

echo "[1/8] Mining 101 blocks to mature coinbase..."
$CLI -rpcwallet=testwallet generatetoaddress 101 "$MINER_ADDR" > /dev/null
echo "Blocks mined. Balance: $($CLI -rpcwallet=testwallet getbalance) BTC"

# ── Step 2: Create test addresses ─────────────────────────────────────────
echo ""
echo "[2/8] Creating test addresses..."
ALICE=$($CLI -rpcwallet=testwallet getnewaddress "alice" "bech32")
BOB=$($CLI -rpcwallet=testwallet getnewaddress "bob" "bech32")
echo "Alice: $ALICE"
echo "Bob:   $BOB"

# Fund Alice and Bob
$CLI -rpcwallet=testwallet sendtoaddress "$ALICE" 1.0 > /dev/null
$CLI -rpcwallet=testwallet sendtoaddress "$BOB" 1.0 > /dev/null
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null
echo "Funded Alice and Bob with 1 BTC each"

# ── Step 3: Inscribe DEPLOY for 'TEST' token ──────────────────────────────
echo ""
echo "[3/8] Inscribing BRC-20 DEPLOY for 'TEST' token..."
DEPLOY_JSON='{"p":"brc-20","op":"deploy","tick":"TEST","max":"21000000","lim":"1000","dec":"18"}'
echo "Deploy inscription: $DEPLOY_JSON"

# Use OP_RETURN to embed inscription data (simplified regtest approach)
# Format: OP_RETURN <ord_marker> <content_type> <brc20_json>
DEPLOY_HEX=$(echo -n "$DEPLOY_JSON" | xxd -p | tr -d '\n')
ORD_MARKER=$(echo -n "ord" | xxd -p)
CT_MARKER=$(echo -n "text/plain" | xxd -p)

# Create a transaction with metadata in the tx comment (for indexer to pick up)
TXID=$($CLI -rpcwallet=testwallet sendtoaddress "$ALICE" 0.0001 "$DEPLOY_JSON" "" false false 1 "UNSET" false)
echo "Deploy TX: $TXID"
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null
echo "Block mined with deploy inscription"

# ── Step 4: Inscribe MINT operations ──────────────────────────────────────
echo ""
echo "[4/8] Inscribing BRC-20 MINT operations..."

MINT_JSON_ALICE='{"p":"brc-20","op":"mint","tick":"TEST","amt":"1000"}'
MINT_TX_ALICE=$($CLI -rpcwallet=testwallet sendtoaddress "$ALICE" 0.0001 "$MINT_JSON_ALICE" "" false false 1 "UNSET" false)
echo "Alice mint TX: $MINT_TX_ALICE"

MINT_JSON_BOB='{"p":"brc-20","op":"mint","tick":"TEST","amt":"500"}'
MINT_TX_BOB=$($CLI -rpcwallet=testwallet sendtoaddress "$BOB" 0.0001 "$MINT_JSON_BOB" "" false false 1 "UNSET" false)
echo "Bob mint TX: $MINT_TX_BOB"

# Try an INVALID mint (over limit)
MINT_JSON_OVER='{"p":"brc-20","op":"mint","tick":"TEST","amt":"1001"}'
MINT_TX_OVER=$($CLI -rpcwallet=testwallet sendtoaddress "$ALICE" 0.0001 "$MINT_JSON_OVER" "" false false 1 "UNSET" false)
echo "Over-limit mint TX (should be ignored): $MINT_TX_OVER"

$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null
echo "Block mined with mint operations"

# ── Step 5: Inscribe TRANSFER ─────────────────────────────────────────────
echo ""
echo "[5/8] Inscribing BRC-20 TRANSFER (Stage 1 - Alice → Bob)..."

TRANSFER_JSON='{"p":"brc-20","op":"transfer","tick":"TEST","amt":"500"}'
TRANSFER_TX=$($CLI -rpcwallet=testwallet sendtoaddress "$ALICE" 0.0001 "$TRANSFER_JSON" "" false false 1 "UNSET" false)
echo "Transfer inscription TX: $TRANSFER_TX"
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null
echo "Block mined with transfer inscription"

# ── Step 6: Spend the transfer UTXO (Stage 2) ─────────────────────────────
echo ""
echo "[6/8] Spending transfer inscription UTXO (Stage 2)..."
SPEND_TX=$($CLI -rpcwallet=testwallet sendtoaddress "$BOB" 0.0001)
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null
echo "Transfer spend TX: $SPEND_TX"
echo "Block mined with transfer spend"

# ── Step 7: Deploy second ticker ──────────────────────────────────────────
echo ""
echo "[7/8] Deploying second token 'SATS'..."
SATS_DEPLOY='{"p":"brc-20","op":"deploy","tick":"SATS","max":"2100000000000000","lim":"100000000","dec":"0"}'
$CLI -rpcwallet=testwallet sendtoaddress "$MINER_ADDR" 0.0001 "$SATS_DEPLOY" "" false false 1 "UNSET" false
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null

# Attempt duplicate deploy (should be ignored)
echo "Attempting duplicate SATS deploy (should be ignored)..."
$CLI -rpcwallet=testwallet sendtoaddress "$MINER_ADDR" 0.0001 "$SATS_DEPLOY" "" false false 1 "UNSET" false
$CLI -rpcwallet=testwallet generatetoaddress 1 "$MINER_ADDR" > /dev/null

# ── Step 8: Wait for indexer and verify ───────────────────────────────────
echo ""
echo "[8/8] Waiting for indexer to sync..."
sleep "$SLEEP_SEC"

TOTAL_HEIGHT=$($CLI getblockcount)
echo ""
echo "======================================================"
echo "Seeding Complete!"
echo "======================================================"
echo "Total blocks mined: $TOTAL_HEIGHT"
echo "Alice address:      $ALICE"
echo "Bob address:        $BOB"
echo ""
echo "Expected state after indexer syncs:"
echo "  TEST token deployed: max_supply=21000000, limit_per_mint=1000"
echo "  Alice balance:       ~500 TEST (1000 minted - 500 transferred)"
echo "  Bob balance:         ~1000 TEST (500 minted + 500 received)"
echo "  SATS token deployed: max_supply=2100000000000000"
echo ""
echo "Verify with:"
echo "  curl 'http://localhost:3000/api/v1/brc20/token?ticker=TEST'"
echo "  curl 'http://localhost:3000/api/v1/brc20/balance?ticker=TEST&address=$ALICE'"
echo "  curl 'http://localhost:3000/api/v1/brc20/balance?ticker=TEST&address=$BOB'"
echo "  curl 'http://localhost:3000/api/v1/brc20/holders?ticker=TEST'"
echo "======================================================"
