const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

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
    contractOrFactory,
    expectedName,
    expectedArgs = []
) {
    await assert.rejects(action, (error) => {
        const data = revertData(error);
        assert.ok(data, `Missing revert data for ${expectedName}: ${error}`);

        const parsed = contractOrFactory.interface.parseError(data);
        assert.ok(parsed, `Could not decode revert data for ${expectedName}`);
        assert.equal(parsed.name, expectedName);
        assert.deepEqual(Array.from(parsed.args), expectedArgs);
        return true;
    });
}

describe("MockKRWFaucet", function () {
    let owner;
    let firstFunder;
    let secondFunder;
    let outsider;
    let mockKrw;
    let faucet;

    const claimAmount = 10_000_000n;
    const initialInventory = claimAmount * 2n;

    beforeEach(async function () {
        [owner, firstFunder, secondFunder, outsider] =
            await ethers.getSigners();

        const tokenFactory = await ethers.getContractFactory(
            "MockKRW",
            owner
        );
        mockKrw = await tokenFactory.deploy();
        await mockKrw.waitForDeployment();

        const faucetFactory = await ethers.getContractFactory(
            "MockKRWFaucet",
            owner
        );
        faucet = await faucetFactory.deploy(
            await mockKrw.getAddress(),
            claimAmount
        );
        await faucet.waitForDeployment();
    });

    it("rejects invalid payment tokens and a zero claim amount", async function () {
        const faucetFactory = await ethers.getContractFactory(
            "MockKRWFaucet",
            owner
        );
        const paymentTokenAddress = await mockKrw.getAddress();

        await assertCustomError(
            () => faucetFactory.deploy(ethers.ZeroAddress, claimAmount),
            faucetFactory,
            "InvalidPaymentToken"
        );
        await assertCustomError(
            () => faucetFactory.deploy(outsider.address, claimAmount),
            faucetFactory,
            "InvalidPaymentToken"
        );
        await assertCustomError(
            () => faucetFactory.deploy(paymentTokenAddress, 0n),
            faucetFactory,
            "InvalidClaimAmount"
        );
    });

    it("transfers one fixed claim from pre-funded inventory without minting", async function () {
        const faucetAddress = await faucet.getAddress();
        const totalSupplyBefore = await mockKrw.totalSupply();
        await (await mockKrw.transfer(faucetAddress, initialInventory)).wait();

        const transaction = await faucet.connect(firstFunder).claim();
        const receipt = await transaction.wait();
        const claimed = parsedEvent(faucet, receipt, "Claimed");
        const transferred = parsedEvent(mockKrw, receipt, "Transfer");

        assert.ok(claimed);
        assert.ok(transferred);
        assert.deepEqual(Array.from(claimed.args), [
            firstFunder.address,
            claimAmount
        ]);
        assert.deepEqual(Array.from(transferred.args), [
            faucetAddress,
            firstFunder.address,
            claimAmount
        ]);
        assert.equal(await faucet.hasClaimed(firstFunder.address), true);
        assert.equal(
            await mockKrw.balanceOf(firstFunder.address),
            claimAmount
        );
        assert.equal(
            await mockKrw.balanceOf(faucetAddress),
            initialInventory - claimAmount
        );
        assert.equal(await mockKrw.totalSupply(), totalSupplyBefore);
    });

    it("rejects a second claim from the same wallet", async function () {
        await (
            await mockKrw.transfer(await faucet.getAddress(), initialInventory)
        ).wait();
        await (await faucet.connect(firstFunder).claim()).wait();

        await assertCustomError(
            () => faucet.connect(firstFunder).claim(),
            faucet,
            "AlreadyClaimed",
            [firstFunder.address]
        );
        assert.equal(
            await mockKrw.balanceOf(firstFunder.address),
            claimAmount
        );
    });

    it("allows different wallets to claim independently", async function () {
        await (
            await mockKrw.transfer(await faucet.getAddress(), initialInventory)
        ).wait();

        await (await faucet.connect(firstFunder).claim()).wait();
        await (await faucet.connect(secondFunder).claim()).wait();

        assert.equal(
            await mockKrw.balanceOf(firstFunder.address),
            claimAmount
        );
        assert.equal(
            await mockKrw.balanceOf(secondFunder.address),
            claimAmount
        );
        assert.equal(
            await mockKrw.balanceOf(await faucet.getAddress()),
            0n
        );
    });

    it("preserves eligibility after depletion and succeeds after refill", async function () {
        await assertCustomError(
            () => faucet.connect(firstFunder).claim(),
            faucet,
            "FaucetDepleted",
            [0n, claimAmount]
        );
        assert.equal(await faucet.hasClaimed(firstFunder.address), false);

        await (
            await mockKrw.transfer(await faucet.getAddress(), claimAmount)
        ).wait();
        await (await faucet.connect(firstFunder).claim()).wait();

        assert.equal(await faucet.hasClaimed(firstFunder.address), true);
        assert.equal(
            await mockKrw.balanceOf(firstFunder.address),
            claimAmount
        );
    });

    it("allows only the owner to recover remaining inventory", async function () {
        const faucetAddress = await faucet.getAddress();
        await (await mockKrw.transfer(faucetAddress, initialInventory)).wait();

        await assert.rejects(
            () => faucet.connect(outsider).withdrawAll(),
            /OwnableUnauthorizedAccount/
        );

        const ownerBalanceBefore = await mockKrw.balanceOf(owner.address);
        const transaction = await faucet.withdrawAll();
        const receipt = await transaction.wait();
        const withdrawn = parsedEvent(faucet, receipt, "Withdrawn");

        assert.ok(withdrawn);
        assert.deepEqual(Array.from(withdrawn.args), [
            owner.address,
            initialInventory
        ]);
        assert.equal(await mockKrw.balanceOf(faucetAddress), 0n);
        assert.equal(
            await mockKrw.balanceOf(owner.address),
            ownerBalanceBefore + initialInventory
        );

        await assertCustomError(
            () => faucet.withdrawAll(),
            faucet,
            "NothingToWithdraw"
        );
    });
});
