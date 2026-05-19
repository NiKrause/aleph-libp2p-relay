// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/PrepaidBudgetVault.sol";
import "./mocks/MockERC20.sol";
import "./utils/TestBase.sol";

contract PrepaidBudgetVaultTest is TestBase {
    MockERC20 internal token;
    PrepaidBudgetVault internal vault;

    address internal owner = address(0xA11CE);
    address internal other = address(0xB0B);
    bytes32 internal constant INTENT_HASH = keccak256("deployment-intent");
    uint256 internal constant DEPOSIT_AMOUNT = 1_000 ether;

    function setUp() public {
        token = new MockERC20("Mock Aleph", "mALEPH", 18);
        vault = new PrepaidBudgetVault(address(token));

        token.mint(owner, 10_000 ether);
        token.mint(other, 10_000 ether);

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(other);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function testConstructorRejectsZeroTokenAddress() public {
        vm.expectRevert(bytes("token required"));
        new PrepaidBudgetVault(address(0));
    }

    function testDepositIncreasesDepositedAndAvailableBalance() public {
        vm.prank(owner);
        vault.deposit(DEPOSIT_AMOUNT);

        assertEq(vault.totalDeposited(owner), DEPOSIT_AMOUNT, "deposit should increase totalDeposited");
        assertEq(vault.availableBalance(owner), DEPOSIT_AMOUNT, "deposit should be fully available");
        assertEq(token.balanceOf(address(vault)), DEPOSIT_AMOUNT, "vault should receive tokens");
    }

    function testAvailableBalanceReflectsReservedAmount() public {
        _deposit(owner, DEPOSIT_AMOUNT);
        uint256 reserveAmount = 400 ether;

        vm.prank(owner);
        vault.reserveForDeployment(INTENT_HASH, reserveAmount, uint64(block.timestamp + 1 days));

        assertEq(vault.reservedBalance(owner), reserveAmount, "reserved balance should increase");
        assertEq(
            vault.availableBalance(owner),
            DEPOSIT_AMOUNT - reserveAmount,
            "available balance should exclude reserved amount"
        );
    }

    function testReserveRequiresSufficientBalanceAndFutureExpiry() public {
        _deposit(owner, DEPOSIT_AMOUNT);

        vm.prank(owner);
        vm.expectRevert(bytes("expiry required"));
        vault.reserveForDeployment(INTENT_HASH, 100 ether, uint64(block.timestamp));

        vm.prank(owner);
        vm.expectRevert(bytes("insufficient prepaid"));
        vault.reserveForDeployment(INTENT_HASH, DEPOSIT_AMOUNT + 1, uint64(block.timestamp + 1 days));
    }

    function testDuplicateActiveReservationRejected() public {
        _deposit(owner, DEPOSIT_AMOUNT);

        vm.prank(owner);
        vault.reserveForDeployment(INTENT_HASH, 250 ether, uint64(block.timestamp + 1 days));

        vm.prank(owner);
        vm.expectRevert(bytes("intent already active"));
        vault.reserveForDeployment(INTENT_HASH, 100 ether, uint64(block.timestamp + 2 days));
    }

    function testConsumeReservedEnforcesOwnerActiveReservationAndCostBounds() public {
        _deposit(owner, DEPOSIT_AMOUNT);

        vm.prank(other);
        vm.expectRevert(bytes("reservation missing"));
        vault.consumeReserved(INTENT_HASH, 1 ether);

        vm.prank(owner);
        vault.reserveForDeployment(INTENT_HASH, 300 ether, uint64(block.timestamp + 1 days));

        vm.prank(owner);
        vm.expectRevert(bytes("invalid cost"));
        vault.consumeReserved(INTENT_HASH, 0);

        vm.prank(owner);
        vm.expectRevert(bytes("invalid cost"));
        vault.consumeReserved(INTENT_HASH, 301 ether);

        vm.prank(owner);
        vault.consumeReserved(INTENT_HASH, 180 ether);

        assertEq(vault.totalDeposited(owner), DEPOSIT_AMOUNT - 180 ether, "consume should charge actual cost");
        assertEq(vault.reservedBalance(owner), 0, "consume should clear reserved balance");

        PrepaidBudgetVault.Reservation memory reservation = vault.reservationOf(owner, INTENT_HASH);
        assertEq(reservation.consumed, true, "consume should mark reservation consumed");
        assertEq(reservation.reservedAmount, 0, "consume should zero reserved amount");

        vm.prank(owner);
        vm.expectRevert(bytes("reservation inactive"));
        vault.consumeReserved(INTENT_HASH, 1 ether);
    }

    function testRefundExpiredOnlyWorksAfterExpiryAndReleasesReservedBalance() public {
        _deposit(owner, DEPOSIT_AMOUNT);

        vm.prank(owner);
        vault.reserveForDeployment(INTENT_HASH, 220 ether, uint64(block.timestamp + 1 days));

        vm.prank(owner);
        vm.expectRevert(bytes("reservation active"));
        vault.refundExpired(INTENT_HASH);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(owner);
        vault.refundExpired(INTENT_HASH);

        assertEq(vault.reservedBalance(owner), 0, "refund should release reserved balance");
        assertEq(vault.availableBalance(owner), DEPOSIT_AMOUNT, "refund should restore availability");

        PrepaidBudgetVault.Reservation memory reservation = vault.reservationOf(owner, INTENT_HASH);
        assertEq(reservation.consumed, true, "refund should mark reservation inactive");
        assertEq(reservation.reservedAmount, 0, "refund should zero reserved amount");
    }

    function testReservationOfReturnsExpectedReservationState() public {
        _deposit(owner, DEPOSIT_AMOUNT);
        uint64 expiresAt = uint64(block.timestamp + 3 days);

        vm.prank(owner);
        vault.reserveForDeployment(INTENT_HASH, 125 ether, expiresAt);

        PrepaidBudgetVault.Reservation memory reservation = vault.reservationOf(owner, INTENT_HASH);
        assertEq(reservation.owner, owner, "reservation owner should match caller");
        assertEq(reservation.reservedAmount, 125 ether, "reservation amount should be stored");
        assertEq(reservation.expiresAt, expiresAt, "reservation expiry should be stored");
        assertEq(reservation.consumed, false, "fresh reservation should not be consumed");
    }

    function _deposit(address depositor, uint256 amount) internal {
        vm.prank(depositor);
        vault.deposit(amount);
    }
}
