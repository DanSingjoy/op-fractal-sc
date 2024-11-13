import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers.js"
import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;
import { FractalRespect } from "../typechain-types/contracts/FractalRespect";
import { BigNumberish } from "ethers";
import { type TokenIdDataStruct, packTokenId, unpackTokenId, tokenIdDataEq, normTokenIdData } from "../utils/tokenId";
import { checkConsistencyOfBalance, checkConsistencyOfSupply } from "./consistencyChecks"

export type GroupRanksStruct = FractalRespect.GroupRanksStruct;

export async function deployImpl() {
  // Contracts are deployed using the first signer/account by default
  const signers = await ethers.getSigners();

  const implOwner = signers[0]!;
  const implExecutor = signers[1]!;

  const factory = await ethers.getContractFactory("FractalRespect", implOwner);

  const implAddr = await upgrades.deployImplementation(
    factory,
    {
      kind: 'uups',
      constructorArgs: ['ImplFractal', 'IF', implOwner.address, implExecutor.address, 518400]
    }
  );

  const addr = implAddr.toString();
  // FIXME: why do I have to do a typecast here?
  const impl = factory.attach(addr) as FractalRespect;

  expect(await impl.name()).to.equal('ImplFractal');

  await expect(impl.mint(signers[1]!, 5, 2, 0)).to.not.be.reverted;

  await checkConsistencyOfSupply(impl, 1, 5);
  await checkConsistencyOfBalance(impl, signers[1]!.address!, 1, 5);
  await checkConsistencyOfBalance(impl, signers[0]!.address!, 0, 0);

  return { implOwner, impl, factory, signers, implExecutor };
}

export async function deploy() {
  const { signers, implOwner, implExecutor } = await deployImpl();

  const proxyOwner = signers[1]!;
  const proxyExecutor = signers[2]!;
  const proxyOther = signers[5]!;

  const factory = await ethers.getContractFactory("FractalRespect", proxyOwner);
  const execFactory = await ethers.getContractFactory("FractalRespect", proxyExecutor);
  const otherFactory = await ethers.getContractFactory("FractalRespect", proxyOther);

  const ranksDelay = 518400; // 6 days

  // FIXME: why do I have to do a typecast here?
  const proxyFromOwner = (await upgrades.deployProxy(
    factory,
    ["TestFractal", "TF", proxyOwner.address, proxyExecutor.address, ranksDelay],
    {
      kind: 'uups',
      initializer: "initializeV2Whole(string,string,address,address,uint64)",
      constructorArgs: ['ImplFractal', 'IF', implOwner.address, implExecutor.address, 518400]
    }
  ) as unknown) as FractalRespect;

  const proxyFromExec = execFactory.attach(await proxyFromOwner.getAddress()) as FractalRespect;
  const proxyFromOther = otherFactory.attach(await proxyFromOwner.getAddress()) as FractalRespect;

  const submitRanksEx1: GroupRanksStruct[] = [
    {
      groupNum: 1,
      ranks: [
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        signers[0]!.address,
        signers[1]!.address,
        signers[2]!.address,
      ]
    },
    {
      groupNum: 2,
      ranks: [
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        signers[3]!.address,
        signers[4]!.address,
        signers[5]!.address,
        signers[6]!.address,
      ]
    },
    {
      groupNum: 3,
      ranks: [
        signers[7]!.address,
        signers[8]!.address,
        signers[9]!.address,
        signers[10]!.address,
        signers[11]!.address,
        signers[12]!.address,
      ]
    }
  ];

  const submitRanksEx2: GroupRanksStruct[] = [
    {
      groupNum: 1,
      ranks: [
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        signers[2]!.address,
        signers[1]!.address,
        signers[0]!.address,
      ]
    },
  ];

  return {
    proxyFromOwner,
    proxyFromExec,
    proxyFromOther,
    proxyOwner,
    proxyExecutor,
    proxyOther,
    factory,
    execFactory,
    otherFactory,
    signers,
    ranksDelay,
    submitRanksEx1, submitRanksEx2
  };
}


describe("FractalRespect", function () {
  describe("Deployment", function () {
    it("Should not fail and set specified parameters", async function () {
      const { proxyOwner, proxyExecutor, proxyFromOther, ranksDelay, proxyFromExec} = await loadFixture(deploy);

      expect(await proxyFromOther.ranksDelay()).to.equal(ranksDelay);
      expect(await proxyFromOther.executor()).to.equal(proxyExecutor.address);
      expect(await proxyFromOther.owner()).to.equal(proxyOwner.address);
      expect(await proxyFromOther.name()).to.equal("TestFractal");
      expect(await proxyFromOther.symbol()).to.equal("TF");
      expect(await proxyFromOther.lastRanksTime()).to.equal(0);
      expect(await proxyFromOther.periodNumber()).to.equal(0);
      expect(await proxyFromOther.totalSupply()).to.equal(0);
      expect(await proxyFromOther.tokenSupply()).to.equal(0);
    });
  });

  describe("submitRanks", function() {
    it('should revert if not called by issuer (owner) or executor', async function() {
      const { signers, proxyFromOther } = await loadFixture(deploy);

      const res: GroupRanksStruct[] = [
        {
          groupNum: 1,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[0]!.address,
            signers[1]!.address,
            signers[2]!.address,
            signers[3]!.address,
          ]
        }
      ];

      await expect(proxyFromOther.submitRanks(res)).to.be.revertedWith(
        "Only executor or issuer can do this"
      );
    });

    it('should revert if called with less than 3 addresses are ranked', async function() {
      const { signers, proxyFromExec } = await loadFixture(deploy);

      const res: GroupRanksStruct[] = [
        {
          groupNum: 1,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[2]!.address,
            signers[3]!.address,
          ]
        }
      ];

      await expect(proxyFromExec.submitRanks(res)).to.be.revertedWith(
        "At least 3 non-zero addresses have to be ranked"
      );
    });

    it('should revert if not enough time has passed since previous submitranks', async function() {
      const { signers, proxyFromExec } = await loadFixture(deploy);

      const res: GroupRanksStruct[] = [
        {
          groupNum: 1,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[4]!.address,
            signers[2]!.address,
            signers[3]!.address,
          ]
        },
        {
          groupNum: 2,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[5]!.address,
            signers[6]!.address,
            signers[1]!.address,
            signers[0]!.address,
          ]
        }
      ];

      await expect(proxyFromExec.submitRanks(res)).to.not.be.reverted;

      await expect(proxyFromExec.submitRanks(res)).to.be.revertedWith(
        "ranksDelay amount of time has to pass before next submitRanks"
      );
    });

    it('should allow a second submitranks after enough time have passed', async function() {
      const { submitRanksEx1, submitRanksEx2, proxyFromExec } = await loadFixture(deploy);

      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;

      await time.increase(604800); // 7 days

      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;
    });

    it('should increment periodNumber after submission', async function() {
      const { submitRanksEx1, submitRanksEx2, proxyFromExec } = await loadFixture(deploy);

      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;

      expect(await proxyFromExec.periodNumber()).to.equal(1);

      await time.increase(604800); // 7 days

      await expect(proxyFromExec.submitRanks(submitRanksEx2)).to.not.be.reverted;

      expect(await proxyFromExec.periodNumber()).to.equal(2);
    });

    it("should not allow the same account to be ranked twice in the same group", async function() {
      const { proxyFromExec, signers } = await loadFixture(deploy);

      const res: GroupRanksStruct[] = [
        {
          groupNum: 1,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[0]!.address,
            signers[2]!.address,
            signers[1]!.address,
            signers[0]!.address,
          ]
        },
      ];

      await expect(proxyFromExec.submitRanks(res)).to.be.revertedWith(
        "token id already minted"
      );
    });

    it("should not allow the same account to be ranked twice in different groups", async function() {
      const { proxyFromExec, signers } = await loadFixture(deploy);

      const res: GroupRanksStruct[] = [
        {
          groupNum: 0,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[3]!.address,
            signers[2]!.address,
            signers[1]!.address,
            signers[0]!.address,
          ]
        },
        {
          groupNum: 1,
          ranks: [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            signers[6]!.address,
            signers[5]!.address,
            signers[4]!.address,
            signers[0]!.address,

          ]
        }
      ];

      await expect(proxyFromExec.submitRanks(res)).to.be.revertedWith(
        "token id already minted"
      );
    });
    
    it('should issue respect based on rankings', async function() {
      const { submitRanksEx1, submitRanksEx2, proxyFromExec } = await loadFixture(deploy);

      console.log("OK1")

      // First period
      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;
      expect(await proxyFromExec.periodNumber()).to.equal(1);

      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[0]!.ranks[5]!.toString(),
        1,
        55
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[0]!.ranks[4]!.toString(),
        1,
        34
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[0]!.ranks[3]!.toString(),
        1,
        21
      );

      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[1]!.ranks[5]!.toString(),
        1,
        55
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[1]!.ranks[4]!.toString(),
        1,
        34
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[1]!.ranks[3]!.toString(),
        1,
        21
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[1]!.ranks[2]!.toString(),
        1,
        13
      );

      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[5]!.toString(),
        1,
        55
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[4]!.toString(),
        1,
        34
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[3]!.toString(),
        1,
        21
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[2]!.toString(),
        1,
        13
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[1]!.toString(),
        1,
        8
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[2]!.ranks[0]!.toString(),
        1,
        5
      );
      await checkConsistencyOfSupply(proxyFromExec, 13, 369);

      console.log("OK2")

      await time.increase(604800); // 7 days

      // Second period
      await expect(proxyFromExec.submitRanks(submitRanksEx2)).to.not.be.reverted;
      expect(await proxyFromExec.periodNumber()).to.equal(2);


      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx2[0]!.ranks[5]!.toString(),
        2,
        76
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[0]!.ranks[4]!.toString(),
        2,
        68
      );
      await checkConsistencyOfBalance(
        proxyFromExec,
        submitRanksEx1[0]!.ranks[3]!.toString(),
        2,
        76
      );
      await checkConsistencyOfSupply(proxyFromExec, 16, 479);
    });

    it("should set expected id for the minted respect", async function() {
      const { submitRanksEx1, submitRanksEx2, proxyFromExec, proxyFromOther } = await loadFixture(deploy);

      // First period
      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;
      expect(await proxyFromExec.periodNumber()).to.equal(1);

      const id6 = packTokenId({
        mintType: 0, periodNumber: 1, owner: submitRanksEx1[0]!.ranks[5]!
      });
      expect(await proxyFromOther.valueOfToken(id6)).to.equal(55);
      expect(await proxyFromOther.ownerOf(id6)).to.equal(submitRanksEx1[0]!.ranks[5]!);

      console.log("ok");

      const id5 = packTokenId({
        mintType: 0, periodNumber: 1, owner: submitRanksEx1[0]!.ranks[4]!
      });
      expect(await proxyFromOther.valueOfToken(id5)).to.equal(34);
      expect(await proxyFromOther.ownerOf(id5)).to.equal(submitRanksEx1[0]!.ranks[4]!);

      const id4 = packTokenId({
        mintType: 0, periodNumber: 1, owner: submitRanksEx1[0]!.ranks[3]!
      });
      expect(await proxyFromOther.valueOfToken(id4)).to.equal(21);
      expect(await proxyFromOther.ownerOf(id4)).to.equal(submitRanksEx1[0]!.ranks[3]!);

      await time.increase(604800); // 7 days

      // Second period
      await expect(proxyFromExec.submitRanks(submitRanksEx2)).to.not.be.reverted;
      expect(await proxyFromExec.periodNumber()).to.equal(2);

      const id26 = packTokenId({
        mintType: 0, periodNumber: 2, owner: submitRanksEx2[0]!.ranks[5]!
      });
      expect(await proxyFromOther.valueOfToken(id26)).to.equal(55);
      expect(await proxyFromOther.ownerOf(id26)).to.equal(submitRanksEx2[0]!.ranks[5]!);

      const id25 = packTokenId({
        mintType: 0, periodNumber: 2, owner: submitRanksEx2[0]!.ranks[4]!
      });
      expect(await proxyFromOther.valueOfToken(id25)).to.equal(34);
      expect(await proxyFromOther.ownerOf(id25)).to.equal(submitRanksEx2[0]!.ranks[4]!);

      const id24 = packTokenId({
        mintType: 0, periodNumber: 2, owner: submitRanksEx2[0]!.ranks[3]!
      });
      expect(await proxyFromOther.valueOfToken(id24)).to.equal(21);
      expect(await proxyFromOther.ownerOf(id24)).to.equal(submitRanksEx2[0]!.ranks[3]!);
    });
  });

  describe("setRanksDelay", function() {
    it("should revert if not the owner is calling", async function() {
      const { proxyFromExec } = await loadFixture(deploy);

      await expect(proxyFromExec.setRanksDelay(86400)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("should change the amount of time required between submitranks", async function() {
      const { submitRanksEx1, submitRanksEx2, proxyFromExec, proxyFromOwner } = await loadFixture(deploy);

      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;

      await time.increase(86400); // 1 day

      await expect(proxyFromExec.submitRanks(submitRanksEx2)).to.be.revertedWith(
        "ranksDelay amount of time has to pass before next submitRanks"
      );

      // Note that we are calling from owner
      await expect(proxyFromOwner.setRanksDelay(86400)).to.not.be.reverted;

      await expect(proxyFromExec.submitRanks(submitRanksEx2)).to.not.be.reverted;
    })
  });

  describe("setExecutor", function() {
    it("should revert if not issuer or executor is calling it", async function() {
      const { proxyOther, proxyFromExec, proxyFromOther, proxyFromOwner } = await loadFixture(deploy);

      await expect(proxyFromOther.setExecutor(proxyOther)).to.be.revertedWith(
        "Only executor or issuer can do this"
      );
    });

    it("should change who is allowed to call submitranks", async function() {
      const { submitRanksEx1, proxyOther, proxyExecutor, proxyFromExec, proxyFromOther, proxyFromOwner } = await loadFixture(deploy);

      await expect(proxyFromOwner.setExecutor(proxyOther)).to.not.be.reverted;

      // Submit from old exec does not work
      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.be.revertedWith(
        "Only executor or issuer can do this"
      );
      // Works from the new
      await expect(proxyFromOther.submitRanks(submitRanksEx1)).to.not.be.reverted;

      // Now calling to set new exec from the (current) executor
      await expect(proxyFromOther.setExecutor(proxyExecutor)).to.not.be.reverted;
      await time.increase(604800); // 7 days
      await expect(proxyFromExec.submitRanks(submitRanksEx1)).to.not.be.reverted;
    });
  });

  describe("setIntent", function() {
    it("should set intent storage variable when called by owner", async function() {
      const { proxyFromOwner } = await loadFixture(deploy);

      const intentLink = "ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly"

      await expect(proxyFromOwner.setIntent(intentLink)).to.not.be.reverted;

      expect(await proxyFromOwner.intent()).to.equal(intentLink);
    });

    it("should not allow setting intent by accounts other than owner", async function() {
      const { proxyFromExec, proxyFromOther } = await loadFixture(deploy);

      const intentLink = "ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly"

      await expect(proxyFromExec.setIntent(intentLink)).to.be.reverted;
      await expect(proxyFromOther.setIntent(intentLink)).to.be.reverted;
    });
  });

  describe("setAgreement", function() {
    it("should set agreement storage variable when called by owner", async function() {
      const { proxyFromOwner } = await loadFixture(deploy);

      const agreementLink = "ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly"

      await expect(proxyFromOwner.setAgreement(agreementLink)).to.not.be.reverted;

      expect(await proxyFromOwner.agreement()).to.equal(agreementLink);
    });

    it("should not allow setting intent by accounts other than owner", async function() {
      const { proxyFromExec, proxyFromOther } = await loadFixture(deploy);

      const agreementLink = "ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly"

      await expect(proxyFromExec.setAgreement(agreementLink)).to.be.reverted;
      await expect(proxyFromOther.setIntent(agreementLink)).to.be.reverted;
    });
  });

  describe("signAgreement", function() {
    it("should trigger an AgreementSigned event", async function() {
      const { proxyFromOwner, proxyFromOther, proxyOther } = await loadFixture(deploy);

      const agreementLink = "ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly"

      await expect(proxyFromOwner.setAgreement(agreementLink)).to.not.be.reverted;

      expect(await proxyFromOther.agreement()).to.equal(agreementLink);

      await expect(proxyFromOther.signAgreement(agreementLink))
        .to.emit(proxyFromOther, "AgreementSigned")
        .withArgs(proxyOther.address, agreementLink);
    });
  });
});