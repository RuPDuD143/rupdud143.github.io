# WAX ORNG test contract

This is an isolated test contract for checking the WAX ORNG v3 notification flow.
It is not part of the FourLeaf website and does not change the live PESOLAR game.

## What it does

- `roll(player)` requires the player's wallet authorization.
- It stores a pending roll in the contract's `rolls` table.
- It sends an inline `orng.wax::requestrand` action.
- It receives the random value through `orng.wax::randnotify`.
- It stores the returned request ID, random value, and fulfillment time.

The contract does not transfer tokens or deploy itself.

## Build

A GitHub Actions workflow compiles the contract using the WAX development container.
Run it from the Actions tab with **Build WAX ORNG test contract**, or push a change
under this folder to the `orng-rngtest-build` branch.

The workflow uploads `rngtest.wasm` and `rngtest.abi` as an artifact named
`rngtest-wasm-abi`.

## Before deploying

1. Inspect the successful build and download its artifact.
2. Deploy only to the intended test account, not `pesolargame1`.
3. Add the contract's `eosio.code` permission so it can send the inline ORNG request.
4. Fund ORNG usage for this dApp. Current ORNG supports WAX staking credits and paid
   deposits; check the current ORNG documentation for the applicable terms.
5. Test notification delivery and recovery before using this pattern in a game.

## Important

This is a minimal integration test, not an audited production contract. It retains
completed rolls for inspection and does not yet include cleanup or user-facing
random-result interpretation.
