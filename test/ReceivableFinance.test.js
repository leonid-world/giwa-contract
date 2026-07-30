const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

function compiledArtifact(contractName) {
    const prefix = path.join(
        __dirname,
        "..",
        "build",
        `contracts_${contractName}_sol_${contractName}`
    );
    return {
        abi: JSON.parse(fs.readFileSync(`${prefix}.abi`, "utf8")),
        bytecode: `0x${fs.readFileSync(`${prefix}.bin`, "utf8").trim()}`
    };
}

function parsedEvent(contract, receipt, eventName) {
    for (const log of receipt.logs) {
        try {
            const event = contract.interface.parseLog(log);
            if (event?.name === eventName) return event;
        } catch {
            // Ignore events emitted by another contract.
        }
    }
    return null;
}

describe("ReceivableFinance", function () {
    let owner;
    let seller;
    let buyer;
    let funder;
    let investor;
    let mockKrw;
    let finance;

    beforeEach(async function () {
        [owner, seller, buyer, funder, investor] = await ethers.getSigners();

        const mockArtifact = compiledArtifact("MockKRW");
        mockKrw = await new ethers.ContractFactory(
            mockArtifact.abi,
            mockArtifact.bytecode,
            owner
        ).deploy();
        await mockKrw.waitForDeployment();

        const financeArtifact = compiledArtifact("ReceivableFinance");
        finance = await new ethers.ContractFactory(
            financeArtifact.abi,
            financeArtifact.bytecode,
            owner
        ).deploy(await mockKrw.getAddress());
        await finance.waitForDeployment();
    });

    it("executes CREATED through REPAID and pays the current NFT owner", async function () {
        const faceValue = 1_000_000n;
        const fundingAmount = 900_000n;
        const issueDate = 1_800_000_000n;
        const maturityDate = issueDate + 2_592_000n;

        assert.equal(await mockKrw.decimals(), 0n);
        await (await mockKrw.mint(buyer.address, faceValue)).wait();
        await (await mockKrw.mint(funder.address, fundingAmount)).wait();

        const createTx = await finance.connect(seller).createReceivable(
            buyer.address,
            faceValue,
            fundingAmount,
            issueDate,
            maturityDate,
            ethers.ZeroHash
        );
        const createReceipt = await createTx.wait();
        const created = parsedEvent(finance, createReceipt, "ReceivableCreated");
        assert.ok(created);
        const receivableId = created.args.receivableId;
        assert.equal((await finance.getReceivable(receivableId)).status, 0n);

        await (await finance.connect(buyer).verifyReceivable(receivableId)).wait();
        assert.equal((await finance.getReceivable(receivableId)).status, 1n);

        const tokenizeTx = await finance
            .connect(seller)
            .tokenizeReceivable(receivableId);
        const tokenizeReceipt = await tokenizeTx.wait();
        const tokenized = parsedEvent(
            finance,
            tokenizeReceipt,
            "ReceivableTokenized"
        );
        assert.ok(tokenized);
        const tokenId = tokenized.args.tokenId;
        assert.equal(await finance.ownerOf(tokenId), await finance.getAddress());

        const sellerBalanceBefore = await mockKrw.balanceOf(seller.address);
        await (
            await mockKrw
                .connect(funder)
                .approve(await finance.getAddress(), fundingAmount)
        ).wait();
        await (await finance.connect(funder).fundReceivable(receivableId)).wait();

        assert.equal(
            await mockKrw.balanceOf(seller.address),
            sellerBalanceBefore + fundingAmount
        );
        assert.equal(await finance.ownerOf(tokenId), funder.address);
        assert.equal((await finance.getReceivable(receivableId)).status, 3n);

        await (
            await finance
                .connect(funder)
                .transferFrom(funder.address, investor.address, tokenId)
        ).wait();
        const investorBalanceBefore = await mockKrw.balanceOf(investor.address);
        await (
            await mockKrw
                .connect(buyer)
                .approve(await finance.getAddress(), faceValue)
        ).wait();
        await (await finance.connect(buyer).repayReceivable(receivableId)).wait();

        assert.equal(
            await mockKrw.balanceOf(investor.address),
            investorBalanceBefore + faceValue
        );
        assert.equal(await finance.ownerOf(tokenId), investor.address);
        assert.equal((await finance.getReceivable(receivableId)).status, 4n);
    });

    it("enforces roles and rolls state back when token transfers fail", async function () {
        const faceValue = 500_000n;
        const fundingAmount = 450_000n;
        const issueDate = 1_800_000_000n;
        const maturityDate = issueDate + 86_400n;

        await assert.rejects(
            finance.connect(seller).createReceivable(
                seller.address,
                faceValue,
                fundingAmount,
                issueDate,
                maturityDate,
                ethers.ZeroHash
            )
        );

        await (
            await finance.connect(seller).createReceivable(
                buyer.address,
                faceValue,
                fundingAmount,
                issueDate,
                maturityDate,
                ethers.ZeroHash
            )
        ).wait();
        const receivableId = 1n;

        await assert.rejects(
            finance.connect(seller).verifyReceivable(receivableId)
        );
        await (await finance.connect(buyer).verifyReceivable(receivableId)).wait();
        await assert.rejects(
            finance.connect(buyer).verifyReceivable(receivableId)
        );
        await assert.rejects(
            finance.connect(buyer).tokenizeReceivable(receivableId)
        );
        await (
            await finance.connect(seller).tokenizeReceivable(receivableId)
        ).wait();

        const tokenId = (await finance.getReceivable(receivableId)).tokenId;
        await assert.rejects(
            finance.connect(seller).fundReceivable(receivableId)
        );
        await assert.rejects(
            finance.connect(buyer).fundReceivable(receivableId)
        );

        await (await mockKrw.mint(funder.address, fundingAmount)).wait();
        await assert.rejects(
            finance.connect(funder).fundReceivable(receivableId)
        );
        assert.equal((await finance.getReceivable(receivableId)).status, 2n);
        assert.equal(await finance.ownerOf(tokenId), await finance.getAddress());

        await (
            await mockKrw
                .connect(funder)
                .approve(await finance.getAddress(), fundingAmount)
        ).wait();
        await (await finance.connect(funder).fundReceivable(receivableId)).wait();
        await (await mockKrw.mint(buyer.address, faceValue)).wait();
        await assert.rejects(
            finance.connect(buyer).repayReceivable(receivableId)
        );
        assert.equal((await finance.getReceivable(receivableId)).status, 3n);
        assert.equal(await finance.ownerOf(tokenId), funder.address);

        await assert.rejects(finance.getReceivable(999n));
    });
});
