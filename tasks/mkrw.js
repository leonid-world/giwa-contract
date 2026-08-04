const fs = require("node:fs");
const path = require("node:path");
const { task } = require("hardhat/config");

const GIWA_SEPOLIA_CHAIN_ID = 91342n;
const GIWA_EXPLORER_URL = "https://sepolia-explorer.giwa.io";
const DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet.json"
);
const MAX_UINT256 = (1n << 256n) - 1n;
const RPC_STATE_READ_ATTEMPTS = 10;
const RPC_STATE_READ_DELAY_MS = 1_500;

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function loadDeployment(ethers) {
    if (!fs.existsSync(DEPLOYMENT_PATH)) {
        throw new Error(
            "Deployment metadata is missing. Run `npm run deploy:giwa` first."
        );
    }

    let deployment;
    try {
        deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    } catch (error) {
        throw new Error(
            `Could not read ${DEPLOYMENT_PATH}: ${error.message}`
        );
    }

    if (
        deployment.chainId !== Number(GIWA_SEPOLIA_CHAIN_ID) ||
        !ethers.isAddress(deployment.mockKRW)
    ) {
        throw new Error(
            "Deployment metadata has no valid GIWA Sepolia MockKRW address."
        );
    }

    return {
        ...deployment,
        mockKRW: ethers.getAddress(deployment.mockKRW)
    };
}

function parseRecipient(ethers, value) {
    if (!ethers.isAddress(value)) {
        throw new Error("Recipient must be a valid EVM wallet address.");
    }

    const recipient = ethers.getAddress(value);
    if (recipient === ethers.ZeroAddress) {
        throw new Error("Recipient cannot be the zero address.");
    }
    return recipient;
}

function parseAmount(value) {
    if (!/^[1-9][0-9]*$/.test(value)) {
        throw new Error(
            "Amount must be a positive integer without commas or decimals. MockKRW uses 0 decimals."
        );
    }

    const amount = BigInt(value);
    if (amount > MAX_UINT256) {
        throw new Error("Amount exceeds the uint256 maximum.");
    }
    return amount;
}

function formatAmount(value) {
    return `${value.toLocaleString("en-US")} mKRW`;
}

function findMatchingTransfer(receipt, token, expected) {
    return receipt.logs.filter((log) => {
        if (log.address.toLowerCase() !== expected.token.toLowerCase()) {
            return false;
        }

        try {
            const event = token.interface.parseLog(log);
            return (
                event?.name === "Transfer" &&
                event.args.from.toLowerCase() === expected.from.toLowerCase() &&
                event.args.to.toLowerCase() === expected.to.toLowerCase() &&
                event.args.value === expected.amount
            );
        } catch {
            return false;
        }
    });
}

function matchesExpectedState(state, expected) {
    return (
        state.ownerBalance === expected.ownerBalance &&
        state.recipientBalance === expected.recipientBalance &&
        state.supply === expected.supply
    );
}

async function readConfirmedPostState(token, addresses, receipt, expected) {
    let lastState = null;
    let lastError = null;

    for (
        let attempt = 1;
        attempt <= RPC_STATE_READ_ATTEMPTS;
        attempt += 1
    ) {
        try {
            const callOverrides = { blockTag: receipt.blockNumber };
            const [ownerBalance, recipientBalance, supply] =
                await Promise.all([
                    token.balanceOf(addresses.owner, callOverrides),
                    token.balanceOf(addresses.recipient, callOverrides),
                    token.totalSupply(callOverrides)
                ]);
            lastState = { ownerBalance, recipientBalance, supply };
            lastError = null;

            if (matchesExpectedState(lastState, expected)) {
                return { state: lastState, verified: true };
            }
        } catch (error) {
            lastError = error;
        }

        if (attempt < RPC_STATE_READ_ATTEMPTS) {
            console.log(
                `Waiting for RPC state visibility at confirmed block ${receipt.blockNumber} (${attempt}/${RPC_STATE_READ_ATTEMPTS})...`
            );
            await delay(RPC_STATE_READ_DELAY_MS);
        }
    }

    return { state: lastState, verified: false, error: lastError };
}

async function executeMockKrwOperation(operation, taskArguments, hre) {
    if (hre.network.name !== "giwaSepolia") {
        throw new Error(
            "This task must run on the configured giwaSepolia network."
        );
    }
    if (!process.env.DEPLOYER_PRIVATE_KEY?.trim()) {
        throw new Error(
            "DEPLOYER_PRIVATE_KEY is missing. Export the MockKRW owner key only for this terminal session."
        );
    }

    const { ethers } = hre;
    const recipient = parseRecipient(ethers, taskArguments.to);
    const amount = parseAmount(taskArguments.amount);
    const deployment = loadDeployment(ethers);

    await hre.run("compile");

    const chain = await ethers.provider.getNetwork();
    if (chain.chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        throw new Error(
            `Expected GIWA Sepolia chain ${GIWA_SEPOLIA_CHAIN_ID}, received ${chain.chainId}.`
        );
    }

    const [signer] = await ethers.getSigners();
    if (!signer) {
        throw new Error("Hardhat could not create the configured owner signer.");
    }

    const signerAddress = await signer.getAddress();
    const nativeBalance = await ethers.provider.getBalance(signerAddress);
    if (nativeBalance === 0n) {
        throw new Error(
            `MockKRW owner ${signerAddress} has no GIWA Sepolia ETH for gas.`
        );
    }

    const code = await ethers.provider.getCode(deployment.mockKRW);
    if (code === "0x") {
        throw new Error(
            `No contract code was found at recorded MockKRW ${deployment.mockKRW} on chain ${chain.chainId}. Check the RPC and deployment metadata.`
        );
    }

    const token = await ethers.getContractAt(
        "MockKRW",
        deployment.mockKRW,
        signer
    );
    const [name, symbol, decimals, owner, ownerBalance, recipientBalance, supply] =
        await Promise.all([
            token.name(),
            token.symbol(),
            token.decimals(),
            token.owner(),
            token.balanceOf(signerAddress),
            token.balanceOf(recipient),
            token.totalSupply()
        ]);

    if (
        name !== "Mock Korean Won" ||
        symbol !== "mKRW" ||
        decimals !== 0n
    ) {
        throw new Error(
            "The recorded token does not match the MVP MockKRW contract."
        );
    }
    if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new Error(
            `Configured signer ${signerAddress} is not the onchain MockKRW owner ${owner}.`
        );
    }
    if (
        operation === "transfer" &&
        recipient.toLowerCase() === signerAddress.toLowerCase()
    ) {
        throw new Error("Transfer recipient cannot be the owner wallet itself.");
    }
    if (operation === "transfer" && ownerBalance < amount) {
        throw new Error(
            `Owner balance is ${formatAmount(ownerBalance)}, below the requested ${formatAmount(amount)}.`
        );
    }

    console.log(`Operation: MockKRW ${operation}`);
    console.log(`Network: GIWA Sepolia (${chain.chainId})`);
    console.log(`Token: ${deployment.mockKRW}`);
    console.log(`Owner: ${signerAddress}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Amount: ${formatAmount(amount)}`);
    console.log(`Owner balance before: ${formatAmount(ownerBalance)}`);
    console.log(
        `Recipient balance before: ${formatAmount(recipientBalance)}`
    );
    console.log(`Total supply before: ${formatAmount(supply)}`);

    const transaction =
        operation === "transfer"
            ? await token.transfer(recipient, amount)
            : await token.mint(recipient, amount);

    console.log(`Transaction submitted: ${transaction.hash}`);
    console.log(`${GIWA_EXPLORER_URL}/tx/${transaction.hash}`);

    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
        throw new Error(
            `Transaction ${transaction.hash} did not complete successfully. Do not retry until its explorer status is checked.`
        );
    }

    const expectedFrom =
        operation === "transfer" ? signerAddress : ethers.ZeroAddress;
    const matchingTransfers = findMatchingTransfer(receipt, token, {
        token: deployment.mockKRW,
        from: expectedFrom,
        to: recipient,
        amount
    });
    if (matchingTransfers.length !== 1) {
        throw new Error(
            `Transaction ${transaction.hash} was confirmed, but the expected MockKRW Transfer event was not unique. Do not submit it again; inspect the transaction in the explorer.`
        );
    }

    const expectedOwnerBalance =
        operation === "transfer"
            ? ownerBalance - amount
            : recipient.toLowerCase() === signerAddress.toLowerCase()
              ? ownerBalance + amount
              : ownerBalance;
    const expectedRecipientBalance = recipientBalance + amount;
    const expectedSupply =
        operation === "transfer" ? supply : supply + amount;
    const postStateResult = await readConfirmedPostState(
        token,
        { owner: signerAddress, recipient },
        receipt,
        {
            ownerBalance: expectedOwnerBalance,
            recipientBalance: expectedRecipientBalance,
            supply: expectedSupply
        }
    );

    console.log(`Confirmed in block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);
    if (postStateResult.state) {
        console.log(
            `Owner balance after: ${formatAmount(postStateResult.state.ownerBalance)}`
        );
        console.log(
            `Recipient balance after: ${formatAmount(postStateResult.state.recipientBalance)}`
        );
        console.log(
            `Total supply after: ${formatAmount(postStateResult.state.supply)}`
        );
    }
    if (!postStateResult.verified) {
        const detail = postStateResult.error
            ? ` Last RPC error: ${postStateResult.error.message}`
            : "";
        console.warn(
            `Warning: the receipt and exact Transfer event are confirmed, but the public RPC has not returned the matching state at block ${receipt.blockNumber}.${detail}`
        );
        console.warn(
            `The transaction succeeded. Do not submit it again; use the explorer link above to confirm the balances.`
        );
    }
    console.log(
        operation === "transfer"
            ? "MockKRW transfer completed. Total supply was not increased."
            : "MockKRW mint completed. New test-token supply was issued by the owner."
    );
}

task(
    "mkrw-transfer",
    "Transfers existing mKRW from the MockKRW owner to a demo wallet"
)
    .addPositionalParam("to", "Recipient wallet address")
    .addPositionalParam("amount", "Positive integer mKRW amount")
    .setAction((taskArguments, hre) =>
        executeMockKrwOperation("transfer", taskArguments, hre)
    );

task(
    "mkrw-mint",
    "Mints additional test-only mKRW from the MockKRW owner to a demo wallet"
)
    .addPositionalParam("to", "Recipient wallet address")
    .addPositionalParam("amount", "Positive integer mKRW amount")
    .setAction((taskArguments, hre) =>
        executeMockKrwOperation("mint", taskArguments, hre)
    );
