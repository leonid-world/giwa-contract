// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ReceivableFinance is ERC721, Ownable {
    uint256 private _nextTokenId;

    constructor()
        ERC721("Receivable Finance", "RCV")
        Ownable(msg.sender)
    {}

    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
    }
}
