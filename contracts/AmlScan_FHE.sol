pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AmlScanFHE is ZamaEthereumConfig {
    struct Transaction {
        address sender;
        address receiver;
        uint256 amount;
        uint256 timestamp;
        euint32 encryptedRiskScore;
        uint32 decryptedRiskScore;
        bool isFlagged;
        bool isVerified;
    }

    struct RiskRule {
        string ruleId;
        euint32 encryptedThreshold;
        uint32 decryptedThreshold;
        bool isVerified;
    }

    mapping(string => Transaction) public transactions;
    mapping(string => RiskRule) public riskRules;
    string[] public transactionIds;
    string[] public ruleIds;

    event TransactionRecorded(
        string indexed transactionId,
        address indexed sender,
        address indexed receiver
    );
    event RiskRuleAdded(string indexed ruleId);
    event TransactionFlagged(string indexed transactionId, uint32 riskScore);
    event DecryptionVerified(string indexed id, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function recordTransaction(
        string calldata transactionId,
        address sender,
        address receiver,
        uint256 amount,
        externalEuint32 encryptedRiskScore,
        bytes calldata inputProof
    ) external {
        require(bytes(transactions[transactionId].sender).length == 0, "Transaction already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedRiskScore, inputProof)), "Invalid encrypted input");

        euint32 encryptedValue = FHE.fromExternal(encryptedRiskScore, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        transactions[transactionId] = Transaction({
            sender: sender,
            receiver: receiver,
            amount: amount,
            timestamp: block.timestamp,
            encryptedRiskScore: encryptedValue,
            decryptedRiskScore: 0,
            isFlagged: false,
            isVerified: false
        });

        transactionIds.push(transactionId);
        emit TransactionRecorded(transactionId, sender, receiver);
    }

    function addRiskRule(
        string calldata ruleId,
        externalEuint32 encryptedThreshold,
        bytes calldata inputProof
    ) external {
        require(bytes(riskRules[ruleId].ruleId).length == 0, "Rule already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedThreshold, inputProof)), "Invalid encrypted input");

        euint32 encryptedValue = FHE.fromExternal(encryptedThreshold, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        riskRules[ruleId] = RiskRule({
            ruleId: ruleId,
            encryptedThreshold: encryptedValue,
            decryptedThreshold: 0,
            isVerified: false
        });

        ruleIds.push(ruleId);
        emit RiskRuleAdded(ruleId);
    }

    function verifyDecryption(
        string calldata id,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof,
        bool isTransaction
    ) external {
        if (isTransaction) {
            require(bytes(transactions[id].sender).length > 0, "Transaction does not exist");
            require(!transactions[id].isVerified, "Transaction already verified");

            bytes32[] memory cts = new bytes32[](1);
            cts[0] = FHE.toBytes32(transactions[id].encryptedRiskScore);

            FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
            uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

            transactions[id].decryptedRiskScore = decodedValue;
            transactions[id].isVerified = true;
            emit DecryptionVerified(id, decodedValue);
        } else {
            require(bytes(riskRules[id].ruleId).length > 0, "Risk rule does not exist");
            require(!riskRules[id].isVerified, "Risk rule already verified");

            bytes32[] memory cts = new bytes32[](1);
            cts[0] = FHE.toBytes32(riskRules[id].encryptedThreshold);

            FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
            uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

            riskRules[id].decryptedThreshold = decodedValue;
            riskRules[id].isVerified = true;
            emit DecryptionVerified(id, decodedValue);
        }
    }

    function scanTransaction(
        string calldata transactionId,
        string calldata ruleId
    ) external {
        require(bytes(transactions[transactionId].sender).length > 0, "Transaction does not exist");
        require(bytes(riskRules[ruleId].ruleId).length > 0, "Risk rule does not exist");
        require(transactions[transactionId].isVerified, "Transaction not verified");
        require(riskRules[ruleId].isVerified, "Risk rule not verified");

        if (transactions[transactionId].decryptedRiskScore > riskRules[ruleId].decryptedThreshold) {
            transactions[transactionId].isFlagged = true;
            emit TransactionFlagged(transactionId, transactions[transactionId].decryptedRiskScore);
        }
    }

    function getTransaction(string calldata transactionId)
        external
        view
        returns (
            address sender,
            address receiver,
            uint256 amount,
            uint256 timestamp,
            uint32 decryptedRiskScore,
            bool isFlagged,
            bool isVerified
        )
    {
        require(bytes(transactions[transactionId].sender).length > 0, "Transaction does not exist");
        Transaction storage txn = transactions[transactionId];
        return (
            txn.sender,
            txn.receiver,
            txn.amount,
            txn.timestamp,
            txn.decryptedRiskScore,
            txn.isFlagged,
            txn.isVerified
        );
    }

    function getRiskRule(string calldata ruleId)
        external
        view
        returns (
            string memory ruleIdValue,
            uint32 decryptedThreshold,
            bool isVerified
        )
    {
        require(bytes(riskRules[ruleId].ruleId).length > 0, "Risk rule does not exist");
        RiskRule storage rule = riskRules[ruleId];
        return (rule.ruleId, rule.decryptedThreshold, rule.isVerified);
    }

    function getAllTransactionIds() external view returns (string[] memory) {
        return transactionIds;
    }

    function getAllRuleIds() external view returns (string[] memory) {
        return ruleIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


