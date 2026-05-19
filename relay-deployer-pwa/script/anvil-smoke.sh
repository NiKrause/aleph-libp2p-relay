#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
OWNER_ADDRESS="${OWNER_ADDRESS:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
INTENT_HASH="${INTENT_HASH:-0x1111111111111111111111111111111111111111111111111111111111111111}"
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-1000000000000000000000}"
RESERVE_AMOUNT="${RESERVE_AMOUNT:-400000000000000000000}"
ACTUAL_COST="${ACTUAL_COST:-250000000000000000000}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require forge
require cast

cd "${APP_DIR}"

TOKEN_ADDRESS="$(
  forge create test/mocks/MockERC20.sol:MockERC20 \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    --broadcast \
    --constructor-args "Mock Aleph" "mALEPH" 18 | sed -n 's/^Deployed to: //p' | tail -n 1
)"

VAULT_ADDRESS="$(
  forge create contracts/PrepaidBudgetVault.sol:PrepaidBudgetVault \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    --broadcast \
    --constructor-args "${TOKEN_ADDRESS}" | sed -n 's/^Deployed to: //p' | tail -n 1
)"

echo "TOKEN_ADDRESS=${TOKEN_ADDRESS}"
echo "VAULT_ADDRESS=${VAULT_ADDRESS}"

cast send "${TOKEN_ADDRESS}" "mint(address,uint256)" "${OWNER_ADDRESS}" "${DEPOSIT_AMOUNT}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" >/dev/null

cast send "${TOKEN_ADDRESS}" "approve(address,uint256)" "${VAULT_ADDRESS}" "${DEPOSIT_AMOUNT}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" >/dev/null

cast send "${VAULT_ADDRESS}" "deposit(uint256)" "${DEPOSIT_AMOUNT}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" >/dev/null

EXPIRY="$(( $(date +%s) + 900 ))"
cast send "${VAULT_ADDRESS}" "reserveForDeployment(bytes32,uint256,uint64)" "${INTENT_HASH}" "${RESERVE_AMOUNT}" "${EXPIRY}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" >/dev/null

cast send "${VAULT_ADDRESS}" "consumeReserved(bytes32,uint256)" "${INTENT_HASH}" "${ACTUAL_COST}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" >/dev/null

echo "totalDeposited=$(cast call "${VAULT_ADDRESS}" "totalDeposited(address)(uint256)" "${OWNER_ADDRESS}" --rpc-url "${RPC_URL}")"
echo "reservedBalance=$(cast call "${VAULT_ADDRESS}" "reservedBalance(address)(uint256)" "${OWNER_ADDRESS}" --rpc-url "${RPC_URL}")"
echo "availableBalance=$(cast call "${VAULT_ADDRESS}" "availableBalance(address)(uint256)" "${OWNER_ADDRESS}" --rpc-url "${RPC_URL}")"
