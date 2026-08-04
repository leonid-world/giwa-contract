# GIWA Receivable Contracts

Smart contracts for tokenized receivable financing MVP.

## Contracts

- `MockKRW.sol`: test-only KRW token with 0 decimals. One base unit equals one KRW in the MVP.
- `ReceivableFinance.sol`: receivable state machine and ERC-721 ownership/settlement contract.

## Local compile

```bash
npm ci
npm run compile
npm test
```

Use Node.js 20 or 22 LTS for the reproducible local toolchain.

Hardhat compile, tests, deployment, and verification all use the same pinned
settings:

- Solidity: `0.8.24+commit.e11b9ed9`
- optimizer: enabled, 200 runs
- viaIR: disabled
- EVM version: `paris`
- OpenZeppelin: `5.4.0`

The local `solc` package is used, so the compiler build does not depend on an
unpinned remote download. Hardhat writes `artifacts/` and `cache/`; both are
ignored. The tests execute the complete lifecycle and failure rollback paths on
a local in-memory EVM.

## GIWA Sepolia deployment and verification

The configured network is:

- Chain ID: `91342`
- RPC: `https://sepolia-rpc.giwa.io`
- Explorer: `https://sepolia-explorer.giwa.io`
- Blockscout API: `https://sepolia-explorer.giwa.io/api`

Current verified replacement deployment:

- MockKRW: `0x5cD8a99Dcf5Fa00fb4fD9873b41A15F9C13C9d3F`
- ReceivableFinance: `0x0f264334f98BA0d22f7Fc6Bb901a5Fa36158a315`

The public RPC is rate-limited. Override it for the current terminal when needed:

```bash
export GIWA_RPC_URL=https://your-giwa-rpc.example
```

Hardhat needs the owner signer for deployment and explicit MockKRW administration
only. Do not put a private key in a project file or command-line argument. Export
it temporarily in the current terminal:

```bash
read -s "DEPLOYER_PRIVATE_KEY?GIWA deployer private key: "
export DEPLOYER_PRIVATE_KEY

npm run deploy:giwa:verify

unset DEPLOYER_PRIVATE_KEY
```

The key may be entered with or without the `0x` prefix. The script validates its
format and never prints it.

The deployer must have GIWA Sepolia ETH for gas. The command:

1. checks chain ID `91342`;
2. deploys `MockKRW`;
3. deploys `ReceivableFinance` with the new MockKRW address;
4. confirms `paymentToken()` matches;
5. atomically records public addresses, transaction hashes, block numbers, and
   compiler settings in `deployment/giwa-testnet.json`;
6. verifies both contracts through the GIWA Blockscout API.

If explorer indexing is delayed, do not redeploy. Rerun verification only:

```bash
npm run verify:giwa
```

The scripts also retry live code and state reads when the public RPC briefly
returns empty data immediately after a successful deployment receipt.

Before submitting verification, the script rechecks the live chain ID, contract
code at both addresses, recorded compiler settings, and the Finance-to-MockKRW
`paymentToken()` link.

The deploy script blocks an accidental second deployment after a complete
metadata file exists. Only for an intentional replacement deployment:

```bash
export ALLOW_REDEPLOY=true
npm run deploy:giwa
unset ALLOW_REDEPLOY
```

After deployment, print the exact frontend and backend variables:

```bash
npm run deployment:env
```

Update both address pairs together:

- local/Vercel: `VITE_RECEIVABLE_FINANCE_ADDRESS`, `VITE_MOCK_KRW_ADDRESS`
- local/Railway: `GIWA_RECEIVABLE_FINANCE_ADDRESS`, `GIWA_MOCK_KRW_ADDRESS`

Vercel must be rebuilt, and the backend must be restarted/redeployed.

## MockKRW demo-wallet distribution

한국어 전체 사용법과 오류 대응은
[`MKRW_OPERATIONS.md`](./MKRW_OPERATIONS.md)를 참고한다.

The MockKRW constructor issues the initial `1,000,000,000 mKRW` supply to the
deployer/owner. Prefer transferring that existing test balance to a Funder or
Buyer. Use additional minting only when the MVP needs more test-token supply.

Export the current onchain MockKRW owner key only for the terminal session:

```bash
read -s "DEPLOYER_PRIVATE_KEY?GIWA MockKRW owner private key: "
export DEPLOYER_PRIVATE_KEY
```

Transfer existing owner balance without increasing total supply:

```bash
npm run mkrw:transfer -- 0xRECIPIENT_WALLET 8000000
```

Or issue additional test-only supply directly to a demo wallet:

```bash
npm run mkrw:mint -- 0xRECIPIENT_WALLET 8000000
```

Then remove the key from the shell:

```bash
unset DEPLOYER_PRIVATE_KEY
```

Amounts are positive integer mKRW values without commas or decimal points because
the token uses zero decimals. Both tasks read the MockKRW address from
`deployment/giwa-testnet.json`, require GIWA Sepolia chain ID `91342`, verify the
live contract, current onchain owner, owner gas balance, and resulting Transfer
event, and print the transaction explorer URL. They attach to the existing
deployment and do not deploy a new contract. Never automatically rerun a command
after a submitted hash; check its explorer status first. Post-transaction state
reads target the confirmed block and retry temporary public-RPC visibility lag.

## New deployment data boundary

A new ReceivableFinance contract has empty receivable/NFT storage, and a new
MockKRW contract has independent balances and allowances. Existing database
receivables, transaction hashes, NFTs, and mKRW remain valid historical data for
the old addresses but cannot continue on the new pair.

- Never update old receivable rows to the new address.
- Create a new demo receivable and run the lifecycle from CREATED.
- Transfer the new deployer's initial MockKRW balance to Buyer and Funder wallets,
  or mint additional test supply only when necessary.
- Import the new MockKRW address in MetaMask.
- Approve the new ReceivableFinance address again.
- Prefer a new empty demo database while preserving the completed database.

Never rerun the destructive `.codex/schema.sql` against a populated database.

## Security

This repository never stores deployer private keys or seed phrases.
`MockKRW` has no real-world monetary value.
