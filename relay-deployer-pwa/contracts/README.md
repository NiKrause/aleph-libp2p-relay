# Contract Testing

`PrepaidBudgetVault.sol` now has a minimal local Foundry harness directly in
`relay-deployer-pwa/`.

## Layout

- `foundry.toml`
- `contracts/PrepaidBudgetVault.sol`
- `test/PrepaidBudgetVault.t.sol`
- `test/mocks/MockERC20.sol`
- `script/anvil-smoke.sh`

## Run Unit Tests

```bash
cd relay-deployer-pwa
forge test
```

## Local Anvil Smoke Test

Start Anvil in one terminal:

```bash
anvil
```

Then deploy and exercise the vault in another:

```bash
cd relay-deployer-pwa
./script/anvil-smoke.sh
```

The smoke script:

- deploys a mock ERC-20
- deploys `PrepaidBudgetVault`
- mints tokens to the default Anvil first account
- approves the vault
- deposits prepaid budget
- reserves budget for a deployment intent
- consumes part of that reservation

Override defaults with environment variables when needed:

- `RPC_URL`
- `PRIVATE_KEY`
- `OWNER_ADDRESS`
- `INTENT_HASH`
- `DEPOSIT_AMOUNT`
- `RESERVE_AMOUNT`
- `ACTUAL_COST`
