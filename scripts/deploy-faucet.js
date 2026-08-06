const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, config } = require("hardhat");

const GIWA_SEPOLIA_CHAIN_ID = 91342n;
const DEFAULT_CLAIM_AMOUNT = 10_000_000n;
const MAIN_DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet.json"
);
const FAUCET_DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet-faucet.json"
);
const RPC_READ_ATTEMPTS = 10;
const RPC_READ_DELAY_MS = 1_500;

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function loadJson(filePath, missingMessage) {
    if (!fs.existsSync(filePath)) throw new Error(missingMessage);

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Could not read ${filePath}: ${error.message}`);
    }
}

function writeJson(filePath, value) {
    const temporaryPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
        temporaryPath,
        `${JSON.stringify(value, null, 2)}\n`,
        { encoding: "utf8", mode: 0o644 }
    );
    fs.renameSync(temporaryPath, filePath);
}

function parseClaimAmount() {
    const value =
        process.env.MKRW_FAUCET_CLAIM_AMOUNT?.trim() ||
        DEFAULT_CLAIM_AMOUNT.toString();
    if (!/^[1-9][0-9]*$/.test(value)) {
        throw new Error(
            "MKRW_FAUCET_CLAIM_AMOUNT must be a positive integer without commas or decimals."
        );
    }
    return BigInt(value);
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

function loadMainDeployment() {
    const deployment = loadJson(
        MAIN_DEPLOYMENT_PATH,
        "Main deployment metadata is missing. Deploy MockKRW and ReceivableFinance first."
    );
    if (
        deployment.chainId !== Number(GIWA_SEPOLIA_CHAIN_ID) ||
        !ethers.isAddress(deployment.mockKRW) ||
        !ethers.isAddress(deployment.receivableFinance) ||
        !ethers.isAddress(deployment.deployer)
    ) {
        throw new Error(
            "Main deployment metadata is incomplete or is not GIWA Sepolia."
        );
    }
    return {
        ...deployment,
        mockKRW: ethers.getAddress(deployment.mockKRW),
        receivableFinance: ethers.getAddress(
            deployment.receivableFinance
        )
    };
}

async function readFaucetStateWithRetry(faucetAddress, signer) {
    let lastError;
    for (let attempt = 1; attempt <= RPC_READ_ATTEMPTS; attempt += 1) {
        try {
            const code = await ethers.provider.getCode(faucetAddress);
            if (code === "0x") {
                throw new Error(
                    `No contract code returned for ${faucetAddress}.`
                );
            }

            const faucet = await ethers.getContractAt(
                "MockKRWFaucet",
                faucetAddress,
                signer
            );
            const [paymentToken, claimAmount, owner] = await Promise.all([
                faucet.paymentToken(),
                faucet.claimAmount(),
                faucet.owner()
            ]);
            return { paymentToken, claimAmount, owner };
        } catch (error) {
            lastError = error;
        }

        if (attempt < RPC_READ_ATTEMPTS) {
            console.log(
                `Waiting for RPC Faucet visibility (${attempt}/${RPC_READ_ATTEMPTS})...`
            );
            await delay(RPC_READ_DELAY_MS);
        }
    }

    throw new Error(
        `GIWA RPC did not expose the Faucet state after ${RPC_READ_ATTEMPTS} attempts. ` +
            "Deployment metadata was preserved; rerun this same command to recover without redeploying. " +
            `Last RPC error: ${lastError?.message ?? "unknown"}`
    );
}

function validateFaucetState(state, expected) {
    if (
        state.paymentToken.toLowerCase() !==
        expected.paymentToken.toLowerCase()
    ) {
        throw new Error(
            "MockKRWFaucet paymentToken does not match the recorded MockKRW."
        );
    }
    if (state.claimAmount !== expected.claimAmount) {
        throw new Error(
            `MockKRWFaucet claimAmount is ${state.claimAmount}, expected ${expected.claimAmount}.`
        );
    }
    if (state.owner.toLowerCase() !== expected.owner.toLowerCase()) {
        throw new Error(
            "MockKRWFaucet owner does not match the deployment signer."
        );
    }
}

function printResult(deployment) {
    console.log(`MockKRWFaucet: ${deployment.mockKRWFaucet}`);
    console.log(`Claim amount: ${deployment.claimAmount} mKRW`);
    console.log(`Deployment metadata: ${FAUCET_DEPLOYMENT_PATH}`);
    console.log("");
    console.log("Frontend (local/Vercel, then rebuild):");
    console.log(
        `VITE_MOCK_KRW_FAUCET_ADDRESS=${deployment.mockKRWFaucet}`
    );
    console.log("");
    console.log("Pre-fund existing mKRW inventory separately, for example:");
    console.log(
        `npm run mkrw:transfer -- ${deployment.mockKRWFaucet} 200000000`
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

    const claimAmount = parseClaimAmount();
    const mainDeployment = loadMainDeployment();
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
    const deployerAddress = await deployer.getAddress();
    if (
        mainDeployment.deployer.toLowerCase() !==
        deployerAddress.toLowerCase()
    ) {
        throw new Error(
            `Configured signer ${deployerAddress} does not match the recorded deployer ${mainDeployment.deployer}.`
        );
    }
    const deployerBalance = await ethers.provider.getBalance(
        deployerAddress
    );
    if (deployerBalance === 0n) {
        throw new Error(
            `Deployer ${deployerAddress} has no GIWA Sepolia ETH for gas.`
        );
    }

    const mockCode = await ethers.provider.getCode(mainDeployment.mockKRW);
    if (mockCode === "0x") {
        throw new Error(
            `No contract code was found at recorded MockKRW ${mainDeployment.mockKRW}.`
        );
    }
    const mockKrw = await ethers.getContractAt(
        "MockKRW",
        mainDeployment.mockKRW,
        deployer
    );
    const [name, symbol, mockOwner, decimals] = await Promise.all([
        mockKrw.name(),
        mockKrw.symbol(),
        mockKrw.owner(),
        mockKrw.decimals()
    ]);
    if (name !== "Mock Korean Won" || symbol !== "mKRW") {
        throw new Error(
            "The recorded token does not match the MVP MockKRW contract."
        );
    }
    if (mockOwner.toLowerCase() !== deployerAddress.toLowerCase()) {
        throw new Error(
            `Configured signer ${deployerAddress} is not the MockKRW owner ${mockOwner}.`
        );
    }
    if (decimals !== 0n) {
        throw new Error("The recorded MockKRW does not use zero decimals.");
    }

    if (fs.existsSync(FAUCET_DEPLOYMENT_PATH)) {
        const existing = loadJson(
            FAUCET_DEPLOYMENT_PATH,
            "Faucet deployment metadata is missing."
        );
        if (
            existing.chainId !== Number(chain.chainId) ||
            !ethers.isAddress(existing.mockKRWFaucet) ||
            existing.mockKRW?.toLowerCase() !==
                mainDeployment.mockKRW.toLowerCase() ||
            existing.deployer?.toLowerCase() !==
                deployerAddress.toLowerCase() ||
            BigInt(existing.claimAmount) !== claimAmount
        ) {
            throw new Error(
                "Existing Faucet deployment metadata does not match the requested deployment. Refusing to overwrite it."
            );
        }

        const faucetAddress = ethers.getAddress(
            existing.mockKRWFaucet
        );
        const state = await readFaucetStateWithRetry(
            faucetAddress,
            deployer
        );
        validateFaucetState(state, {
            paymentToken: mainDeployment.mockKRW,
            claimAmount,
            owner: deployerAddress
        });
        console.log("Existing Faucet deployment recovered; no transaction submitted.");
        printResult({
            ...existing,
            mockKRWFaucet: faucetAddress
        });
        return;
    }

    console.log(`Network: GIWA Sepolia (${chain.chainId})`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Balance: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`MockKRW: ${mainDeployment.mockKRW}`);
    console.log(`Claim amount: ${claimAmount} mKRW`);
    console.log("Deploying MockKRWFaucet...");

    const factory = await ethers.getContractFactory(
        "MockKRWFaucet",
        deployer
    );
    const faucet = await factory.deploy(
        mainDeployment.mockKRW,
        claimAmount
    );
    const transaction = faucet.deploymentTransaction();
    if (!transaction) {
        throw new Error(
            "Faucet deployment transaction could not be determined."
        );
    }
    console.log(`Transaction submitted: ${transaction.hash}`);
    console.log(
        `https://sepolia-explorer.giwa.io/tx/${transaction.hash}`
    );

    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
        throw new Error(
            `Faucet deployment transaction ${transaction.hash} failed.`
        );
    }
    const faucetAddress = await faucet.getAddress();
    const deployment = {
        network: "GIWA Sepolia",
        chainId: Number(chain.chainId),
        mockKRWFaucet: faucetAddress,
        mockKRW: mainDeployment.mockKRW,
        receivableFinance: mainDeployment.receivableFinance,
        claimAmount: claimAmount.toString(),
        deployer: deployerAddress,
        deployedAt: new Date().toISOString(),
        compiler: compilerMetadata(),
        transactions: {
            mockKRWFaucet: transaction.hash
        },
        blocks: {
            mockKRWFaucet: receipt.blockNumber
        }
    };
    writeJson(FAUCET_DEPLOYMENT_PATH, deployment);

    const state = await readFaucetStateWithRetry(faucetAddress, deployer);
    validateFaucetState(state, {
        paymentToken: mainDeployment.mockKRW,
        claimAmount,
        owner: deployerAddress
    });

    printResult(deployment);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
