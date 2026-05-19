// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Prepaid budget vault for Aleph deployment intents.
/// @dev This contract intentionally focuses on deposits and reservations only.
/// It does not prove that Aleph will accept contract-based signatures for offchain
/// INSTANCE messages. Treat it as the budget and reservation layer that an AA
/// wallet or policy module can enforce once the upstream signature path is valid.
contract PrepaidBudgetVault {
    struct Reservation {
        uint256 reservedAmount;
        uint64 expiresAt;
        bool consumed;
        address owner;
    }

    IERC20Minimal public immutable token;

    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public reservedBalance;
    mapping(address => mapping(bytes32 => Reservation)) private reservations;

    event Deposited(address indexed owner, uint256 amount);
    event Reserved(address indexed owner, bytes32 indexed intentHash, uint256 amount, uint64 expiresAt);
    event Consumed(address indexed owner, bytes32 indexed intentHash, uint256 actualCost);
    event Refunded(address indexed owner, bytes32 indexed intentHash, uint256 amount);

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "token required");
        token = IERC20Minimal(tokenAddress);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amount required");
        totalDeposited[msg.sender] += amount;
        require(token.transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit Deposited(msg.sender, amount);
    }

    function availableBalance(address owner) public view returns (uint256) {
        return totalDeposited[owner] - reservedBalance[owner];
    }

    function reserveForDeployment(bytes32 intentHash, uint256 amount, uint64 expiresAt) external {
        require(intentHash != bytes32(0), "intent required");
        require(amount > 0, "amount required");
        require(expiresAt > block.timestamp, "expiry required");
        require(availableBalance(msg.sender) >= amount, "insufficient prepaid");

        Reservation storage current = reservations[msg.sender][intentHash];
        require(current.owner == address(0) || _isClosed(current), "intent already active");

        reservations[msg.sender][intentHash] = Reservation({
            reservedAmount: amount,
            expiresAt: expiresAt,
            consumed: false,
            owner: msg.sender
        });
        reservedBalance[msg.sender] += amount;

        emit Reserved(msg.sender, intentHash, amount, expiresAt);
    }

    function consumeReserved(bytes32 intentHash, uint256 actualCost) external {
        Reservation storage current = reservations[msg.sender][intentHash];
        require(current.owner == msg.sender, "reservation missing");
        require(!_isClosed(current), "reservation inactive");
        require(actualCost > 0 && actualCost <= current.reservedAmount, "invalid cost");

        uint256 reservedAmount = current.reservedAmount;
        current.consumed = true;
        current.reservedAmount = 0;
        reservedBalance[msg.sender] -= reservedAmount;
        totalDeposited[msg.sender] -= actualCost;

        emit Consumed(msg.sender, intentHash, actualCost);
    }

    function refundExpired(bytes32 intentHash) external {
        Reservation storage current = reservations[msg.sender][intentHash];
        require(current.owner == msg.sender, "reservation missing");
        require(!current.consumed, "reservation inactive");
        require(current.expiresAt <= block.timestamp, "reservation active");

        uint256 reservedAmount = current.reservedAmount;
        current.reservedAmount = 0;
        current.consumed = true;
        reservedBalance[msg.sender] -= reservedAmount;

        emit Refunded(msg.sender, intentHash, reservedAmount);
    }

    function reservationOf(address owner, bytes32 intentHash) external view returns (Reservation memory) {
        return reservations[owner][intentHash];
    }

    function _isClosed(Reservation memory reservation) private view returns (bool) {
        return reservation.consumed || reservation.expiresAt <= block.timestamp;
    }
}
