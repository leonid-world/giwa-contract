const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, run } = require("hardhat");

const GIWA_SEPOLIA_CHAIN_ID = 91342n;
const EXPECTED_COMPILER = {
    version: "0.8.24+commit.e11b9ed9",
    optimizer: {
        enabled: true,
        runs: 200
    },
    viaIR: false,
    evmVersion: "paris"
};
const RPC_READ_ATTEMPTS = 10;
const RPC_READ_DELAY_MS = 1_500;
const DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet.json"
);

function loadDeployment() {
    if (!fs.existsSync(DEPLOYMENT_PATH)) {
        throw new Error(
            "Deployment metadata is missing. Run `npm run deploy:giwa` first."
        );
    }

    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    if (
        deployment.chainId !== Number(GIWA_SEPOLIA_CHAIN_ID) ||
        !deployment.mockKRW ||
        !deployment.receivableFinance
    ) {
        throw new Error(
            "Deployment metadata is incomplete or is not GIWA Sepolia."
        );
    }
    return deployment;
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function readLiveDeploymentWithRetry(deployment) {
    let lastError;
    for (let attempt = 1; attempt <= RPC_READ_ATTEMPTS; attempt += 1) {
        try {
            const [mockCode, financeCode] = await Promise.all([
                ethers.provider.getCode(deployment.mockKRW),
                ethers.provider.getCode(deployment.receivableFinance)
            ]);
            if (mockCode === "0x" || financeCode === "0x") {
                throw new Error(
                    "One or more recorded deployment addresses have no contract code."
                );
            }

            const finance = await ethers.getContractAt(
                "ReceivableFinance",
                deployment.receivableFinance
            );
            return {
                mockCode,
                financeCode,
                paymentToken: await finance.paymentToken()
            };
        } catch (error) {
            lastError = error;
        }

        if (attempt < RPC_READ_ATTEMPTS) {
            console.log(
                `Waiting for RPC contract visibility (${attempt}/${RPC_READ_ATTEMPTS})...`
            );
            await delay(RPC_READ_DELAY_MS);
        }
    }

    throw new Error(
        `GIWA RPC did not expose the recorded contracts after ${RPC_READ_ATTEMPTS} attempts. ` +
            `Retry \`npm run verify:giwa\` without redeploying. ` +
            `Last RPC error: ${lastError?.message ?? "unknown"}`
    );
}

function hasExpectedCompilerMetadata(compiler) {
    return (
        compiler?.version === EXPECTED_COMPILER.version &&
        compiler?.optimizer?.enabled ===
            EXPECTED_COMPILER.optimizer.enabled &&
        compiler?.optimizer?.runs === EXPECTED_COMPILER.optimizer.runs &&
        compiler?.viaIR === EXPECTED_COMPILER.viaIR &&
        compiler?.evmVersion === EXPECTED_COMPILER.evmVersion
    );
}

async function validateDeployment(deployment) {
    const chain = await ethers.provider.getNetwork();
    if (chain.chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        throw new Error(
            `Expected GIWA Sepolia chain ${GIWA_SEPOLIA_CHAIN_ID}, received ${chain.chainId}.`
        );
    }
    if (
        !ethers.isAddress(deployment.mockKRW) ||
        !ethers.isAddress(deployment.receivableFinance)
    ) {
        throw new Error("Deployment metadata contains an invalid address.");
    }
    if (!hasExpectedCompilerMetadata(deployment.compiler)) {
        throw new Error(
            "Deployment compiler metadata does not match the current reproducible compiler settings."
        );
    }

    const { paymentToken } = await readLiveDeploymentWithRetry(deployment);
    if (
        paymentToken.toLowerCase() !==
        deployment.mockKRW.toLowerCase()
    ) {
        throw new Error(
            "Recorded ReceivableFinance does not reference the recorded MockKRW."
        );
    }
}

async function verifyContract(label, options) {
    console.log(`Verifying ${label} at ${options.address}...`);
    try {
        await run("verify:verify", options);
        console.log(`${label} verified.`);
    } catch (error) {
        const message = String(error?.message ?? error);
        if (/already verified|already been verified/i.test(message)) {
            console.log(`${label} is already verified.`);
            return;
        }
        throw error;
    }
}

async function main() {
    if (network.name !== "giwaSepolia") {
        throw new Error(
            "This script must run with --network giwaSepolia."
        );
    }

    const deployment = loadDeployment();
    await validateDeployment(deployment);
    await verifyContract("MockKRW", {
        address: deployment.mockKRW,
        constructorArguments: [],
        contract: "contracts/MockKRW.sol:MockKRW"
    });
    await verifyContract("ReceivableFinance", {
        address: deployment.receivableFinance,
        constructorArguments: [deployment.mockKRW],
        contract: "contracts/ReceivableFinance.sol:ReceivableFinance"
    });

    console.log(
        `Explorer: https://sepolia-explorer.giwa.io/address/${deployment.receivableFinance}?tab=contract`
    );
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
