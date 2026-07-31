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

function revertData(error) {
    const candidates = [
        error?.data,
        error?.error?.data,
        error?.info?.error?.data,
        error?.cause?.data
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string") return candidate;
        if (typeof candidate?.data === "string") return candidate.data;
    }

    return null;
}

async function assertCustomError(
    action,
    contract,
    expectedName,
    expectedArgs = []
) {
    await assert.rejects(action, (error) => {
        const data = revertData(error);
        assert.ok(data, `Missing revert data for ${expectedName}: ${error}`);

        const parsed = contract.interface.parseError(data);
        assert.ok(parsed, `Could not decode revert data for ${expectedName}`);
        assert.equal(parsed.name, expectedName);
        assert.deepEqual(Array.from(parsed.args), expectedArgs);
        return true;
    });
}

describe("ReceivableFinance", function () {
    let owner;
    let seller;
    let buyer;
    let funder;
    let investor;
    let mockKrw;
    let finance;

    const faceValue = 1_000_000n;
    const fundingAmount = 900_000n;
    const issueDate = 1_800_000_000n;
    const maturityDate = issueDate + 2_592_000n;
    const documentHash = ethers.keccak256(
        ethers.toUtf8Bytes("invoice-2026-001")
    );

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

    async function createReceivable(overrides = {}) {
        const terms = {
            buyer: buyer.address,
            faceValue,
            fundingAmount,
            issueDate,
            maturityDate,
            documentHash,
            ...overrides
        };
        const transaction = await finance.connect(seller).createReceivable(
            terms.buyer,
            terms.faceValue,
            terms.fundingAmount,
            terms.issueDate,
            terms.maturityDate,
            terms.documentHash
        );
        const receipt = await transaction.wait();
        const event = parsedEvent(finance, receipt, "ReceivableCreated");
        assert.ok(event);

        return {
            receivableId: event.args.receivableId,
            event,
            terms
        };
    }

    async function createTokenizedReceivable() {
        const created = await createReceivable();
        await (
            await finance
                .connect(buyer)
                .verifyReceivable(created.receivableId)
        ).wait();

        const transaction = await finance
            .connect(seller)
            .tokenizeReceivable(created.receivableId);
        const receipt = await transaction.wait();
        const event = parsedEvent(finance, receipt, "ReceivableTokenized");
        assert.ok(event);

        return {
            receivableId: created.receivableId,
            tokenId: event.args.tokenId
        };
    }

    async function createFundedReceivable() {
        const tokenized = await createTokenizedReceivable();
        await (await mockKrw.mint(funder.address, fundingAmount)).wait();
        await (
            await mockKrw
                .connect(funder)
                .approve(await finance.getAddress(), fundingAmount)
        ).wait();
        await (
            await finance
                .connect(funder)
                .fundReceivable(tokenized.receivableId)
        ).wait();
        return tokenized;
    }

    it("executes the complete lifecycle, emits exact events, and pays the current NFT owner", async function () {
        assert.equal(await mockKrw.decimals(), 0n);
        await (await mockKrw.mint(buyer.address, faceValue)).wait();
        await (await mockKrw.mint(funder.address, fundingAmount)).wait();

        const createdResult = await createReceivable();
        const receivableId = createdResult.receivableId;
        assert.equal(receivableId, 1n);
        assert.deepEqual(Array.from(createdResult.event.args), [
            receivableId,
            seller.address,
            buyer.address,
            faceValue,
            fundingAmount,
            issueDate,
            maturityDate,
            documentHash
        ]);
        assert.equal((await finance.getReceivable(receivableId)).status, 0n);

        const verifyTransaction = await finance
            .connect(buyer)
            .verifyReceivable(receivableId);
        const verifyReceipt = await verifyTransaction.wait();
        const verified = parsedEvent(
            finance,
            verifyReceipt,
            "ReceivableVerified"
        );
        assert.ok(verified);
        assert.deepEqual(Array.from(verified.args), [
            receivableId,
            buyer.address
        ]);
        assert.equal((await finance.getReceivable(receivableId)).status, 1n);

        const tokenizeTransaction = await finance
            .connect(seller)
            .tokenizeReceivable(receivableId);
        const tokenizeReceipt = await tokenizeTransaction.wait();
        const tokenized = parsedEvent(
            finance,
            tokenizeReceipt,
            "ReceivableTokenized"
        );
        assert.ok(tokenized);
        const tokenId = tokenized.args.tokenId;
        assert.equal(tokenId, 1n);
        assert.deepEqual(Array.from(tokenized.args), [
            receivableId,
            tokenId,
            await finance.getAddress()
        ]);
        assert.equal((await finance.getReceivable(receivableId)).status, 2n);
        assert.equal(await finance.ownerOf(tokenId), await finance.getAddress());

        const sellerBalanceBefore = await mockKrw.balanceOf(seller.address);
        await (
            await mockKrw
                .connect(funder)
                .approve(await finance.getAddress(), fundingAmount)
        ).wait();
        const fundTransaction = await finance
            .connect(funder)
            .fundReceivable(receivableId);
        const fundReceipt = await fundTransaction.wait();
        const funded = parsedEvent(
            finance,
            fundReceipt,
            "ReceivableFunded"
        );
        assert.ok(funded);
        assert.deepEqual(Array.from(funded.args), [
            receivableId,
            tokenId,
            funder.address,
            seller.address,
            fundingAmount
        ]);
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
        const repayTransaction = await finance
            .connect(buyer)
            .repayReceivable(receivableId);
        const repayReceipt = await repayTransaction.wait();
        const repaid = parsedEvent(
            finance,
            repayReceipt,
            "ReceivableRepaid"
        );
        assert.ok(repaid);
        assert.deepEqual(Array.from(repaid.args), [
            receivableId,
            tokenId,
            buyer.address,
            investor.address,
            faceValue
        ]);
        assert.equal(
            await mockKrw.balanceOf(investor.address),
            investorBalanceBefore + faceValue
        );
        assert.equal(await finance.ownerOf(tokenId), investor.address);
        assert.equal((await finance.getReceivable(receivableId)).status, 4n);
    });

    it("enforces the buyer, seller, funder, and repayment roles with exact errors", async function () {
        const { receivableId } = await createReceivable();

        await assertCustomError(
            () => finance.connect(seller).verifyReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [seller.address]
        );
        await assertCustomError(
            () => finance.connect(funder).verifyReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [funder.address]
        );
        await (
            await finance.connect(buyer).verifyReceivable(receivableId)
        ).wait();

        await assertCustomError(
            () => finance.connect(buyer).tokenizeReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [buyer.address]
        );
        await assertCustomError(
            () => finance.connect(funder).tokenizeReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [funder.address]
        );
        await (
            await finance.connect(seller).tokenizeReceivable(receivableId)
        ).wait();

        await assertCustomError(
            () => finance.connect(seller).fundReceivable(receivableId),
            finance,
            "RelatedPartyCannotFund"
        );
        await assertCustomError(
            () => finance.connect(buyer).fundReceivable(receivableId),
            finance,
            "RelatedPartyCannotFund"
        );

        await (await mockKrw.mint(funder.address, fundingAmount)).wait();
        await (
            await mockKrw
                .connect(funder)
                .approve(await finance.getAddress(), fundingAmount)
        ).wait();
        await (
            await finance.connect(funder).fundReceivable(receivableId)
        ).wait();

        await assertCustomError(
            () => finance.connect(seller).repayReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [seller.address]
        );
        await assertCustomError(
            () => finance.connect(funder).repayReceivable(receivableId),
            finance,
            "UnauthorizedCaller",
            [funder.address]
        );

        await (await mockKrw.mint(buyer.address, faceValue)).wait();
        await (
            await mockKrw
                .connect(buyer)
                .approve(await finance.getAddress(), faceValue)
        ).wait();
        await (
            await finance.connect(buyer).repayReceivable(receivableId)
        ).wait();
        assert.equal((await finance.getReceivable(receivableId)).status, 4n);
    });

    it("rejects every lifecycle operation when its required status is not met", async function () {
        const { receivableId } = await createReceivable();

        await assertCustomError(
            () => finance.connect(seller).tokenizeReceivable(receivableId),
            finance,
            "InvalidStatus",
            [1n, 0n]
        );
        await assertCustomError(
            () => finance.connect(funder).fundReceivable(receivableId),
            finance,
            "InvalidStatus",
            [2n, 0n]
        );
        await assertCustomError(
            () => finance.connect(buyer).repayReceivable(receivableId),
            finance,
            "InvalidStatus",
            [3n, 0n]
        );

        await (
            await finance.connect(buyer).verifyReceivable(receivableId)
        ).wait();
        await assertCustomError(
            () => finance.connect(buyer).verifyReceivable(receivableId),
            finance,
            "InvalidStatus",
            [0n, 1n]
        );
    });

    it("uses ReceivableNotFound with the missing ID for every ID-based operation", async function () {
        const missingReceivableId = 999n;
        const actions = [
            () => finance.getReceivable(missingReceivableId),
            () =>
                finance
                    .connect(buyer)
                    .verifyReceivable(missingReceivableId),
            () =>
                finance
                    .connect(seller)
                    .tokenizeReceivable(missingReceivableId),
            () =>
                finance
                    .connect(funder)
                    .fundReceivable(missingReceivableId),
            () =>
                finance
                    .connect(buyer)
                    .repayReceivable(missingReceivableId)
        ];

        for (const action of actions) {
            await assertCustomError(
                action,
                finance,
                "ReceivableNotFound",
                [missingReceivableId]
            );
        }
    });

    it("rolls funding back when the funder balance is insufficient", async function () {
        const { receivableId, tokenId } =
            await createTokenizedReceivable();
        const financeAddress = await finance.getAddress();
        const sellerBalanceBefore = await mockKrw.balanceOf(seller.address);

        await (
            await mockKrw
                .connect(funder)
                .approve(financeAddress, fundingAmount)
        ).wait();

        await assertCustomError(
            () => finance.connect(funder).fundReceivable(receivableId),
            mockKrw,
            "ERC20InsufficientBalance",
            [funder.address, 0n, fundingAmount]
        );

        const receivable = await finance.getReceivable(receivableId);
        assert.equal(receivable.status, 2n);
        assert.equal(receivable.funder, ethers.ZeroAddress);
        assert.equal(await finance.ownerOf(tokenId), financeAddress);
        assert.equal(
            await mockKrw.balanceOf(seller.address),
            sellerBalanceBefore
        );
    });

    it("rolls funding back when the funder allowance is insufficient", async function () {
        const { receivableId, tokenId } =
            await createTokenizedReceivable();
        const financeAddress = await finance.getAddress();
        const insufficientAllowance = fundingAmount - 1n;

        await (await mockKrw.mint(funder.address, fundingAmount)).wait();
        await (
            await mockKrw
                .connect(funder)
                .approve(financeAddress, insufficientAllowance)
        ).wait();

        await assertCustomError(
            () => finance.connect(funder).fundReceivable(receivableId),
            mockKrw,
            "ERC20InsufficientAllowance",
            [financeAddress, insufficientAllowance, fundingAmount]
        );

        const receivable = await finance.getReceivable(receivableId);
        assert.equal(receivable.status, 2n);
        assert.equal(receivable.funder, ethers.ZeroAddress);
        assert.equal(await finance.ownerOf(tokenId), financeAddress);
        assert.equal(
            await mockKrw.balanceOf(funder.address),
            fundingAmount
        );
        assert.equal(await mockKrw.balanceOf(seller.address), 0n);
    });

    it("rolls repayment back when the buyer balance is insufficient", async function () {
        const { receivableId, tokenId } = await createFundedReceivable();
        const financeAddress = await finance.getAddress();
        const recipientBalanceBefore = await mockKrw.balanceOf(funder.address);

        await (
            await mockKrw.connect(buyer).approve(financeAddress, faceValue)
        ).wait();

        await assertCustomError(
            () => finance.connect(buyer).repayReceivable(receivableId),
            mockKrw,
            "ERC20InsufficientBalance",
            [buyer.address, 0n, faceValue]
        );

        assert.equal((await finance.getReceivable(receivableId)).status, 3n);
        assert.equal(await finance.ownerOf(tokenId), funder.address);
        assert.equal(
            await mockKrw.balanceOf(funder.address),
            recipientBalanceBefore
        );
    });

    it("rolls repayment back when the buyer allowance is insufficient", async function () {
        const { receivableId, tokenId } = await createFundedReceivable();
        const financeAddress = await finance.getAddress();
        const insufficientAllowance = faceValue - 1n;
        const recipientBalanceBefore = await mockKrw.balanceOf(funder.address);

        await (await mockKrw.mint(buyer.address, faceValue)).wait();
        await (
            await mockKrw
                .connect(buyer)
                .approve(financeAddress, insufficientAllowance)
        ).wait();

        await assertCustomError(
            () => finance.connect(buyer).repayReceivable(receivableId),
            mockKrw,
            "ERC20InsufficientAllowance",
            [financeAddress, insufficientAllowance, faceValue]
        );

        assert.equal((await finance.getReceivable(receivableId)).status, 3n);
        assert.equal(await finance.ownerOf(tokenId), funder.address);
        assert.equal(await mockKrw.balanceOf(buyer.address), faceValue);
        assert.equal(
            await mockKrw.balanceOf(funder.address),
            recipientBalanceBefore
        );
    });

    it("rejects zero and self buyers with InvalidBuyer", async function () {
        await assertCustomError(
            () =>
                finance.connect(seller).createReceivable(
                    ethers.ZeroAddress,
                    faceValue,
                    fundingAmount,
                    issueDate,
                    maturityDate,
                    documentHash
                ),
            finance,
            "InvalidBuyer"
        );
        await assertCustomError(
            () =>
                finance.connect(seller).createReceivable(
                    seller.address,
                    faceValue,
                    fundingAmount,
                    issueDate,
                    maturityDate,
                    documentHash
                ),
            finance,
            "InvalidBuyer"
        );
    });

    it("rejects zero and inverted receivable amounts with InvalidAmount", async function () {
        const invalidAmounts = [
            [0n, fundingAmount],
            [faceValue, 0n],
            [faceValue, faceValue + 1n]
        ];

        for (const [invalidFaceValue, invalidFundingAmount] of invalidAmounts) {
            await assertCustomError(
                () =>
                    finance.connect(seller).createReceivable(
                        buyer.address,
                        invalidFaceValue,
                        invalidFundingAmount,
                        issueDate,
                        maturityDate,
                        documentHash
                    ),
                finance,
                "InvalidAmount"
            );
        }
    });

    it("requires maturity to be strictly greater than the issue date", async function () {
        for (const invalidMaturityDate of [issueDate, issueDate - 1n]) {
            await assertCustomError(
                () =>
                    finance.connect(seller).createReceivable(
                        buyer.address,
                        faceValue,
                        fundingAmount,
                        issueDate,
                        invalidMaturityDate,
                        documentHash
                    ),
                finance,
                "InvalidDateRange"
            );
        }

        const valid = await createReceivable({
            maturityDate: issueDate + 1n
        });
        assert.equal(valid.receivableId, 1n);
    });
});
