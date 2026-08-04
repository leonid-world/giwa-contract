const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("MockKRW", function () {
    it("distinguishes owner transfers from owner-only additional issuance", async function () {
        const [owner, funder, buyer] = await ethers.getSigners();
        const factory = await ethers.getContractFactory("MockKRW", owner);
        const token = await factory.deploy();
        await token.waitForDeployment();

        const initialSupply = 1_000_000_000n;
        const transferAmount = 8_000_000n;
        const mintAmount = 10_000_000n;

        assert.equal(await token.decimals(), 0n);
        assert.equal(await token.owner(), owner.address);
        assert.equal(await token.totalSupply(), initialSupply);
        assert.equal(await token.balanceOf(owner.address), initialSupply);

        await (await token.transfer(funder.address, transferAmount)).wait();

        assert.equal(await token.balanceOf(funder.address), transferAmount);
        assert.equal(
            await token.balanceOf(owner.address),
            initialSupply - transferAmount
        );
        assert.equal(await token.totalSupply(), initialSupply);

        await (await token.mint(buyer.address, mintAmount)).wait();

        assert.equal(await token.balanceOf(buyer.address), mintAmount);
        assert.equal(await token.totalSupply(), initialSupply + mintAmount);

        await assert.rejects(
            () => token.connect(funder).mint(funder.address, 1n),
            /OwnableUnauthorizedAccount/
        );
    });
});
