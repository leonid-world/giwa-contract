# GIWA Receivable Contracts

Smart contracts for tokenized receivable financing MVP.

## Contracts

- `MockKRW.sol`: test-only KRW token with 0 decimals. One base unit equals one KRW in the MVP.
- `ReceivableFinance.sol`: receivable state machine and ERC-721 ownership/settlement contract.

## Local compile

```bash
npm install
npm run compile
npm test
```

The compile output is written to `build/` and is not committed.
The Hardhat tests execute the complete lifecycle and failure rollback paths on a
local in-memory EVM. Hardhat is test tooling only and is not used for deployment.

## Deployment order

1. Deploy `MockKRW`.
2. Deploy `ReceivableFinance` with the `MockKRW` address as its constructor argument.
3. Record the chain ID and both addresses in `deployment/giwa-testnet.json`.
4. Copy the same values to the frontend variables in `giwa-ui/.env.local`.
5. Mint test mKRW to the Buyer and Funder demo wallets from the MockKRW owner.

Contracts may still be compiled and deployed through Remix IDE. Do not use the
placeholder deployment JSON as a real deployment.

## Network

GIWA Sepolia Testnet

## Security

This repository never stores deployer private keys or seed phrases.
`MockKRW` has no real-world monetary value.
