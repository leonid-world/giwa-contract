// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GIWA Receivable Finance
/// @notice Tokenizes a verified receivable and atomically exchanges it for MockKRW.
contract ReceivableFinance is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        CREATED,
        VERIFIED,
        TOKENIZED,
        FUNDED,
        REPAID,
        CANCELLED
    }

    struct Receivable {
        uint256 id;
        address seller;
        address buyer;
        address funder;
        uint256 faceValue;
        uint256 fundingAmount;
        uint256 issueDate;
        uint256 maturityDate;
        bytes32 documentHash;
        uint256 tokenId;
        Status status;
    }

    error InvalidPaymentToken();
    error InvalidBuyer();
    error InvalidAmount();
    error InvalidDateRange();
    error ReceivableNotFound(uint256 receivableId);
    error UnauthorizedCaller(address caller);
    error InvalidStatus(Status expected, Status actual);
    error RelatedPartyCannotFund();

    event ReceivableCreated(
        uint256 indexed receivableId,
        address indexed seller,
        address indexed buyer,
        uint256 faceValue,
        uint256 fundingAmount,
        uint256 issueDate,
        uint256 maturityDate,
        bytes32 documentHash
    );
    event ReceivableVerified(uint256 indexed receivableId, address indexed buyer);
    event ReceivableTokenized(
        uint256 indexed receivableId,
        uint256 indexed tokenId,
        address indexed custodian
    );
    event ReceivableFunded(
        uint256 indexed receivableId,
        uint256 indexed tokenId,
        address indexed funder,
        address seller,
        uint256 fundingAmount
    );
    event ReceivableRepaid(
        uint256 indexed receivableId,
        uint256 indexed tokenId,
        address indexed buyer,
        address recipient,
        uint256 faceValue
    );

    IERC20 public immutable paymentToken;

    uint256 private _nextReceivableId;
    uint256 private _nextTokenId;
    mapping(uint256 receivableId => Receivable receivable) private _receivables;

    constructor(address paymentTokenAddress)
        ERC721("GIWA Receivable", "GRCV")
    {
        if (paymentTokenAddress == address(0)) revert InvalidPaymentToken();
        paymentToken = IERC20(paymentTokenAddress);
    }

    function createReceivable(
        address buyer,
        uint256 faceValue,
        uint256 fundingAmount,
        uint256 issueDate,
        uint256 maturityDate,
        bytes32 documentHash
    ) external returns (uint256 receivableId) {
        if (buyer == address(0) || buyer == msg.sender) revert InvalidBuyer();
        if (
            faceValue == 0 ||
            fundingAmount == 0 ||
            fundingAmount > faceValue
        ) revert InvalidAmount();
        if (maturityDate <= issueDate) revert InvalidDateRange();

        receivableId = ++_nextReceivableId;
        _receivables[receivableId] = Receivable({
            id: receivableId,
            seller: msg.sender,
            buyer: buyer,
            funder: address(0),
            faceValue: faceValue,
            fundingAmount: fundingAmount,
            issueDate: issueDate,
            maturityDate: maturityDate,
            documentHash: documentHash,
            tokenId: 0,
            status: Status.CREATED
        });

        emit ReceivableCreated(
            receivableId,
            msg.sender,
            buyer,
            faceValue,
            fundingAmount,
            issueDate,
            maturityDate,
            documentHash
        );
    }

    function verifyReceivable(uint256 receivableId) external {
        Receivable storage receivable = _getReceivable(receivableId);
        if (msg.sender != receivable.buyer) revert UnauthorizedCaller(msg.sender);
        _requireStatus(receivable, Status.CREATED);

        receivable.status = Status.VERIFIED;

        emit ReceivableVerified(receivableId, msg.sender);
    }

    function tokenizeReceivable(uint256 receivableId)
        external
        returns (uint256 tokenId)
    {
        Receivable storage receivable = _getReceivable(receivableId);
        if (msg.sender != receivable.seller) revert UnauthorizedCaller(msg.sender);
        _requireStatus(receivable, Status.VERIFIED);

        tokenId = ++_nextTokenId;
        receivable.tokenId = tokenId;
        receivable.status = Status.TOKENIZED;

        // The contract intentionally escrows the NFT until funding.
        _mint(address(this), tokenId);

        emit ReceivableTokenized(receivableId, tokenId, address(this));
    }

    function fundReceivable(uint256 receivableId) external nonReentrant {
        Receivable storage receivable = _getReceivable(receivableId);
        _requireStatus(receivable, Status.TOKENIZED);
        if (msg.sender == receivable.seller || msg.sender == receivable.buyer) {
            revert RelatedPartyCannotFund();
        }

        receivable.funder = msg.sender;
        receivable.status = Status.FUNDED;

        paymentToken.safeTransferFrom(
            msg.sender,
            receivable.seller,
            receivable.fundingAmount
        );
        _safeTransfer(address(this), msg.sender, receivable.tokenId, "");

        emit ReceivableFunded(
            receivableId,
            receivable.tokenId,
            msg.sender,
            receivable.seller,
            receivable.fundingAmount
        );
    }

    function repayReceivable(uint256 receivableId) external nonReentrant {
        Receivable storage receivable = _getReceivable(receivableId);
        if (msg.sender != receivable.buyer) revert UnauthorizedCaller(msg.sender);
        _requireStatus(receivable, Status.FUNDED);

        address recipient = ownerOf(receivable.tokenId);
        receivable.status = Status.REPAID;

        paymentToken.safeTransferFrom(
            msg.sender,
            recipient,
            receivable.faceValue
        );

        emit ReceivableRepaid(
            receivableId,
            receivable.tokenId,
            msg.sender,
            recipient,
            receivable.faceValue
        );
    }

    function getReceivable(uint256 receivableId)
        external
        view
        returns (Receivable memory)
    {
        Receivable storage receivable = _getReceivable(receivableId);
        return receivable;
    }

    function _getReceivable(uint256 receivableId)
        private
        view
        returns (Receivable storage receivable)
    {
        receivable = _receivables[receivableId];
        if (receivable.id == 0) revert ReceivableNotFound(receivableId);
    }

    function _requireStatus(
        Receivable storage receivable,
        Status expected
    ) private view {
        if (receivable.status != expected) {
            revert InvalidStatus(expected, receivable.status);
        }
    }
}
