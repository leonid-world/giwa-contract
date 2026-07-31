const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, config } = require("hardhat");

const GIWA_SEPOLIA_CHAIN_ID = 91342n;
const DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet.json"
);
const DEPLOYMENT_HISTORY_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "history"
);
const RPC_READ_ATTEMPTS = 10;
const RPC_READ_DELAY_MS = 1_500;

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function readExistingDeployment() {
    if (!fs.existsSync(DEPLOYMENT_PATH)) return null;

    try {
        return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    } catch (error) {
        throw new Error(
            `Could not read ${DEPLOYMENT_PATH}: ${error.message}`
        );
    }
}

function writeDeployment(deployment) {
    const temporaryPath = `${DEPLOYMENT_PATH}.tmp`;
    fs.mkdirSync(path.dirname(DEPLOYMENT_PATH), { recursive: true });
    fs.writeFileSync(
        temporaryPath,
        `${JSON.stringify(deployment, null, 2)}\n`,
        {
            encoding: "utf8",
            mode: 0o644
        }
    );
    fs.renameSync(temporaryPath, DEPLOYMENT_PATH);
}

function archiveDeployment(deployment) {
    const timestamp = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replaceAll(".", "-");
    const archivePath = path.join(
        DEPLOYMENT_HISTORY_PATH,
        `giwa-testnet-${timestamp}.json`
    );
    fs.mkdirSync(DEPLOYMENT_HISTORY_PATH, { recursive: true });
    fs.writeFileSync(
        archivePath,
        `${JSON.stringify(deployment, null, 2)}\n`,
        {
            encoding: "utf8",
            mode: 0o644
        }
    );
    console.log(`Previous deployment archived: ${archivePath}`);
}

function compilerMetadata() {
    const compiler = config.solidity.compilers.find(
        (candidate) => candidate.version === "0.8.24"
    );
    if (!compiler) {
        throw new Error("Hardhat compiler 0.8.24 is not configured.");
    }

    return {
        version: "0.8.24+commit.e11b9ed9",
        optimizer: {
            enabled: compiler.settings.optimizer.enabled,
            runs: compiler.settings.optimizer.runs
        },
        viaIR: compiler.settings.viaIR,
        evmVersion: compiler.settings.evmVersion
    };
}

async function deployedTransaction(contract) {
    const transaction = contract.deploymentTransaction();
    if (!transaction) {
        throw new Error("Deployment transaction could not be determined.");
    }
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
        throw new Error(`Deployment transaction ${transaction.hash} failed.`);
    }
    return {
        hash: transaction.hash,
        blockNumber: receipt.blockNumber
    };
}

async function readPaymentTokenWithRetry(finance, financeAddress) {
    let lastError;
    for (let attempt = 1; attempt <= RPC_READ_ATTEMPTS; attempt += 1) {
        try {
            const code = await ethers.provider.getCode(financeAddress);
            if (code !== "0x") {
                return await finance.paymentToken();
            }
            lastError = new Error(
                `No contract code returned for ${financeAddress}.`
            );
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
        `GIWA RPC did not expose the deployed ReceivableFinance state after ${RPC_READ_ATTEMPTS} attempts. ` +
            `The deployment metadata was preserved; retry only \`npm run verify:giwa\`. ` +
            `Last RPC error: ${lastError?.message ?? "unknown"}`
    );
}

async function main() {
    if (network.name !== "giwaSepolia") {
        throw new Error(
            "This script must run with --network giwaSepolia."
        );
    }
    if (!process.env.DEPLOYER_PRIVATE_KEY?.trim()) {
        throw new Error(
            "DEPLOYER_PRIVATE_KEY is missing. Export it only for this terminal session."
        );
    }

    const chain = await ethers.provider.getNetwork();
    if (chain.chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        throw new Error(
            `Expected GIWA Sepolia chain ${GIWA_SEPOLIA_CHAIN_ID}, received ${chain.chainId}.`
        );
    }

    const [deployer] = await ethers.getSigners();
    if (!deployer) {
        throw new Error(
            "Hardhat could not create the configured deployer signer."
        );
    }

    const existing = readExistingDeployment();
    if (existing?.receivableFinance && !existing?.mockKRW) {
        throw new Error(
            "Deployment metadata is invalid: ReceivableFinance is recorded without MockKRW."
        );
    }
    if (
        existing?.mockKRW &&
        existing?.receivableFinance &&
        process.env.ALLOW_REDEPLOY !== "true"
    ) {
        throw new Error(
            "A complete deployment is already recorded. Set ALLOW_REDEPLOY=true only when an intentional replacement deployment is required."
        );
    }
    if (existing?.mockKRW && existing?.receivableFinance) {
        archiveDeployment(existing);
    }

    const deployerAddress = await deployer.getAddress();
    const balance = await ethers.provider.getBalance(deployerAddress);
    if (balance === 0n) {
        throw new Error(
            `Deployer ${deployerAddress} has no GIWA Sepolia ETH for gas.`
        );
    }

    const startedAt = new Date().toISOString();
    console.log(`Network: GIWA Sepolia (${chain.chainId})`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
    let mockKrwAddress;
    let partialDeployment;
    if (existing?.mockKRW && !existing?.receivableFinance) {
        if (
            existing.chainId !== Number(chain.chainId) ||
            existing.deployer?.toLowerCase() !==
                deployerAddress.toLowerCase()
        ) {
            throw new Error(
                "The partial deployment belongs to a different chain or deployer."
            );
        }
        const code = await ethers.provider.getCode(existing.mockKRW);
        if (code === "0x") {
            throw new Error(
                "The partial deployment MockKRW address has no contract code."
            );
        }
        mockKrwAddress = ethers.getAddress(existing.mockKRW);
        const recordedMockKrw = await ethers.getContractAt(
            "MockKRW",
            mockKrwAddress,
            deployer
        );
        const [owner, decimals] = await Promise.all([
            recordedMockKrw.owner(),
            recordedMockKrw.decimals()
        ]);
        if (owner.toLowerCase() !== deployerAddress.toLowerCase()) {
            throw new Error(
                "The partial deployment MockKRW owner does not match the deployer."
            );
        }
        if (decimals !== 0n) {
            throw new Error(
                "The partial deployment MockKRW does not use zero decimals."
            );
        }
        partialDeployment = existing;
        console.log(`Resuming with recorded MockKRW: ${mockKrwAddress}`);
    } else {
        console.log("Deploying MockKRW...");
        const mockKrwFactory = await ethers.getContractFactory(
            "MockKRW",
            deployer
        );
        const mockKrw = await mockKrwFactory.deploy();
        await mockKrw.waitForDeployment();
        mockKrwAddress = await mockKrw.getAddress();
        const mockDeployment = await deployedTransaction(mockKrw);

        partialDeployment = {
            network: "GIWA Sepolia",
            chainId: Number(chain.chainId),
            mockKRW: mockKrwAddress,
            receivableFinance: null,
            deployer: deployerAddress,
            deployedAt: startedAt,
            compiler: compilerMetadata(),
            transactions: {
                mockKRW: mockDeployment.hash,
                receivableFinance: null
            },
            blocks: {
                mockKRW: mockDeployment.blockNumber,
                receivableFinance: null
            }
        };
        writeDeployment(partialDeployment);
        console.log(`MockKRW: ${mockKrwAddress}`);
    }

    console.log("Deploying ReceivableFinance...");
    const financeFactory = await ethers.getContractFactory(
        "ReceivableFinance",
        deployer
    );
    const finance = await financeFactory.deploy(mockKrwAddress);
    await finance.waitForDeployment();
    const financeAddress = await finance.getAddress();
    const financeDeployment = await deployedTransaction(finance);

    const completedDeployment = {
        ...partialDeployment,
        receivableFinance: financeAddress,
        deployedAt: new Date().toISOString(),
        transactions: {
            ...partialDeployment.transactions,
            receivableFinance: financeDeployment.hash
        },
        blocks: {
            ...partialDeployment.blocks,
            receivableFinance: financeDeployment.blockNumber
        }
    };
    writeDeployment(completedDeployment);

    const configuredPaymentToken = await readPaymentTokenWithRetry(
        finance,
        financeAddress
    );
    if (
        configuredPaymentToken.toLowerCase() !==
        mockKrwAddress.toLowerCase()
    ) {
        throw new Error(
            "ReceivableFinance paymentToken does not match the deployed MockKRW."
        );
    }

    console.log(`ReceivableFinance: ${financeAddress}`);
    console.log(`Deployment metadata: ${DEPLOYMENT_PATH}`);
    console.log("Run `npm run verify:giwa` to verify both contracts.");
    console.log("Run `npm run deployment:env` to print app environment values.");
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
