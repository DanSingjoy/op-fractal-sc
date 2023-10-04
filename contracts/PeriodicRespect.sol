// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.9;

import "./Respect.sol";
import "./FractalInputsLogger.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract PeriodicRespect is Respect, UUPSUpgradeable, OwnableUpgradeable {
    string private _baseURIVal;
    uint64 public periodNumber;

    struct TokenIdData {
        uint64 periodNumber;
        address owner;
        uint8 mintType;
    }

    enum MintTypes { RespectGame }

    /**
     * 256 bits (32 bytes):
     * First least-significant 20 bytes is address (owner of an NTT).
     * next 8 bytes is MeetingNumber (when NTT was issued)
     * next 1 byte is for identifying type of mint
     *  * mint issued from submitranks should have 0;
     *  * other types of mints should have something else;
     * remaining 3 bytes are reserved;
     */
    function packTokenId(TokenIdData memory value) public pure returns (TokenId) {
        return TokenId.wrap(
            (uint256(value.mintType) << 224)
            | (uint256(value.periodNumber) << 160)
            | uint256(uint160(value.owner))
        );
    }

    function unpackTokenId(TokenId packed) public pure returns (TokenIdData memory) {
        TokenIdData memory r;
        r.owner = ownerFromTokenId(packed);
        uint256 i = uint256(TokenId.unwrap(packed));
        r.periodNumber = uint64(i >> 160);
        r.mintType = uint8(i >> 224);
        return r;
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        address issuer_
    ) public virtual initializer {
        __PeriodicRespect_init(name_, symbol_, issuer_);
    }

    function __PeriodicRespect_init(
        string memory name_,
        string memory symbol_,
        address issuer_
    ) internal onlyInitializing {
        __Respect_init(name_, symbol_);

        _transferOwnership(issuer_);
    }

    function setBaseURI(string calldata baseURI) public virtual onlyOwner {
        _baseURIVal = baseURI;
    }

    function mint(address to, uint64 value, uint8 mintType, uint64 periodNumber_) public virtual onlyOwner {
        TokenIdData memory tokenIdData = TokenIdData({
            periodNumber: periodNumber_,
            owner: to,
            mintType: mintType
        });
        TokenId tokenId = packTokenId(tokenIdData);

         _mint(tokenId, value);
    }

    function burn(TokenId tokenId) public virtual onlyOwner {
        _burn(tokenId);
    }

    function respectEarnedPerLastPeriods(address addr, uint64 periodCount) public view returns (uint256) {
        uint256 remTokens = tokenSupplyOfOwner(addr);

        uint256 respectSum = 0;

        uint64 periodsEnd = periodNumber - periodCount;
        while (remTokens > 0) { // We also break the loop inside
            TokenId tokenId = TokenId.wrap(tokenOfOwnerByIndex(addr, remTokens - 1));
            TokenIdData memory tIdData = unpackTokenId(tokenId);

            if (tIdData.periodNumber <= periodsEnd) {
                break;
            }

            // Should never happen (this would mean that tokens were issued for future period)
            assert(tIdData.periodNumber > periodNumber);

            uint64 value = _valueOf(tokenId);
            respectSum += value;

            remTokens -= 1;
        }

        return respectSum;
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseURIVal;
    }

}