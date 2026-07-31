const fs = require("node:fs");
const path = require("node:path");

const DEPLOYMENT_PATH = path.join(
    __dirname,
    "..",
    "deployment",
    "giwa-testnet.json"
);

function main() {
    if (!fs.existsSync(DEPLOYMENT_PATH)) {
        throw new Error(
            "Deployment metadata is missing. Run `npm run deploy:giwa` first."
        );
    }

    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    if (
        deployment.chainId !== 91342 ||
        !deployment.mockKRW ||
        !deployment.receivableFinance
    ) {
        throw new Error(
            "Deployment metadata is incomplete or is not GIWA Sepolia."
        );
    }

    console.log("Frontend (local/Vercel, then rebuild):");
    console.log("VITE_GIWA_CHAIN_ID=91342");
    console.log("VITE_GIWA_CHAIN_ID_HEX=0x164ce");
    console.log("VITE_GIWA_RPC_URL=https://sepolia-rpc.giwa.io");
    console.log("VITE_GIWA_EXPLORER_URL=https://sepolia-explorer.giwa.io");
    console.log(
        `VITE_RECEIVABLE_FINANCE_ADDRESS=${deployment.receivableFinance}`
    );
    console.log(`VITE_MOCK_KRW_ADDRESS=${deployment.mockKRW}`);
    console.log("");
    console.log("Backend (local/Railway, then restart/redeploy):");
    console.log("GIWA_CHAIN_ID=91342");
    console.log("GIWA_RPC_URL=https://sepolia-rpc.giwa.io");
    console.log(
        `GIWA_RECEIVABLE_FINANCE_ADDRESS=${deployment.receivableFinance}`
    );
    console.log(`GIWA_MOCK_KRW_ADDRESS=${deployment.mockKRW}`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
