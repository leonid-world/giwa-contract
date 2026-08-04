require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("./tasks/mkrw");

const { subtask } = require("hardhat/config");
const {
    TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD
} = require("hardhat/builtin-tasks/task-names");

const GIWA_SEPOLIA_CHAIN_ID = 91342;
const GIWA_SEPOLIA_RPC_URL =
    process.env.GIWA_RPC_URL?.trim() || "https://sepolia-rpc.giwa.io";
const GIWA_SEPOLIA_EXPLORER_URL = "https://sepolia-explorer.giwa.io";

function normalizePrivateKey(value) {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;

    const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error(
            "DEPLOYER_PRIVATE_KEY must contain exactly 32 bytes of hexadecimal data."
        );
    }
    return normalized;
}

const deployerPrivateKey = normalizePrivateKey(
    process.env.DEPLOYER_PRIVATE_KEY
);

subtask(
    TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
    async ({ solcVersion }, _hre, runSuper) => {
        if (solcVersion !== "0.8.24") {
            return runSuper();
        }

        const installedVersion = require("solc").version();
        const longVersion = "0.8.24+commit.e11b9ed9";
        if (!installedVersion.startsWith(longVersion)) {
            throw new Error(
                `Expected local solc ${longVersion}, received ${installedVersion}`
            );
        }

        return {
            compilerPath: require.resolve("solc/soljson.js"),
            isSolcJs: true,
            version: solcVersion,
            longVersion
        };
    }
);

module.exports = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: false,
            evmVersion: "paris"
        }
    },
    networks: {
        hardhat: {
            chainId: 31337
        },
        giwaSepolia: {
            url: GIWA_SEPOLIA_RPC_URL,
            chainId: GIWA_SEPOLIA_CHAIN_ID,
            accounts: deployerPrivateKey ? [deployerPrivateKey] : []
        }
    },
    etherscan: {
        apiKey: {
            giwaSepolia: "blockscout"
        },
        customChains: [
            {
                network: "giwaSepolia",
                chainId: GIWA_SEPOLIA_CHAIN_ID,
                urls: {
                    apiURL: `${GIWA_SEPOLIA_EXPLORER_URL}/api`,
                    browserURL: GIWA_SEPOLIA_EXPLORER_URL
                }
            }
        ]
    },
    sourcify: {
        enabled: false
    }
};
