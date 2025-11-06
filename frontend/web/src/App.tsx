import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TransactionData {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  riskScore: number;
  encryptedRisk: string;
  isVerified: boolean;
  decryptedValue?: number;
  description: string;
  status: 'pending' | 'cleared' | 'suspicious';
}

interface RiskStats {
  totalTransactions: number;
  suspiciousCount: number;
  avgRiskScore: number;
  encryptedPercentage: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTransaction, setCreatingTransaction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newTransactionData, setNewTransactionData] = useState({ 
    from: "", 
    to: "", 
    amount: "", 
    description: "" 
  });
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const transactionsList: TransactionData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          transactionsList.push({
            id: businessId,
            from: businessData.name,
            to: businessData.description,
            amount: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            riskScore: calculateRiskScore(Number(businessData.publicValue1), Number(businessData.publicValue2)),
            encryptedRisk: businessId,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            description: businessData.description,
            status: getStatusFromRisk(Number(businessData.publicValue1))
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTransactions(transactionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateRiskScore = (amount: number, value2: number): number => {
    return Math.min(100, Math.round((amount * 0.7 + value2 * 0.3) * 0.1));
  };

  const getStatusFromRisk = (amount: number): 'pending' | 'cleared' | 'suspicious' => {
    if (amount > 5000) return 'suspicious';
    if (amount > 1000) return 'pending';
    return 'cleared';
  };

  const createTransaction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTransaction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating transaction with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newTransactionData.amount) || 0;
      const businessId = `tx-${Date.now()}`;
      const riskScore = calculateRiskScore(amountValue, 0);
      
      const encryptedResult = await encrypt(contractAddress, address, riskScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTransactionData.from,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        riskScore,
        newTransactionData.to
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created transaction: ${newTransactionData.from} → ${newTransactionData.to}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Transaction created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTransactionData({ from: "", to: "", amount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTransaction(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Risk score already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setUserHistory(prev => [...prev, `Decrypted risk score for transaction: ${businessId}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Risk score decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = tx.from.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         tx.to.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tx.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || tx.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const transactionsPerPage = 5;
  const totalPages = Math.ceil(filteredTransactions.length / transactionsPerPage);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * transactionsPerPage,
    currentPage * transactionsPerPage
  );

  const riskStats: RiskStats = {
    totalTransactions: transactions.length,
    suspiciousCount: transactions.filter(t => t.status === 'suspicious').length,
    avgRiskScore: transactions.length > 0 ? 
      transactions.reduce((sum, t) => sum + t.riskScore, 0) / transactions.length : 0,
    encryptedPercentage: transactions.length > 0 ? 
      (transactions.filter(t => t.isVerified).length / transactions.length) * 100 : 0
  };

  const renderRiskChart = (transaction: TransactionData) => {
    const riskValue = transaction.isVerified ? 
      (transaction.decryptedValue || transaction.riskScore) : transaction.riskScore;
    
    return (
      <div className="risk-chart">
        <div className="chart-row">
          <div className="chart-label">Risk Score</div>
          <div className="chart-bar">
            <div 
              className={`bar-fill ${riskValue > 70 ? 'high-risk' : riskValue > 30 ? 'medium-risk' : 'low-risk'}`}
              style={{ width: `${riskValue}%` }}
            >
              <span className="bar-value">{riskValue}</span>
            </div>
          </div>
        </div>
        <div className="risk-indicators">
          <div className="indicator low">Low (0-30)</div>
          <div className="indicator medium">Medium (31-70)</div>
          <div className="indicator high">High (71-100)</div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 AML Scan FHE</h1>
            <p>Privacy-Preserving Anti-Money Laundering</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Secure AML Compliance Platform</h2>
            <p>Connect your wallet to access encrypted transaction monitoring with FHE technology</p>
            <div className="feature-grid">
              <div className="feature">
                <span>🔒</span>
                <h4>Encrypted Analysis</h4>
                <p>Process AML rules without exposing private data</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <h4>Real-time Scanning</h4>
                <p>Instant risk assessment with homomorphic encryption</p>
              </div>
              <div className="feature">
                <span>🔄</span>
                <h4>Privacy First</h4>
                <p>Only flag suspicious activities, protect legitimate users</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing AML scanning environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading AML monitoring system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🛡️ AML Scan FHE</h1>
          <span>Privacy-Preserving Compliance</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            System Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Transaction
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>{riskStats.totalTransactions}</h3>
              <p>Total Transactions</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⚠️</div>
            <div className="stat-content">
              <h3>{riskStats.suspiciousCount}</h3>
              <p>Suspicious Activities</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🔐</div>
            <div className="stat-content">
              <h3>{riskStats.encryptedPercentage.toFixed(1)}%</h3>
              <p>FHE Encrypted</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⚡</div>
            <div className="stat-content">
              <h3>{riskStats.avgRiskScore.toFixed(1)}</h3>
              <p>Avg Risk Score</p>
            </div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Status</option>
              <option value="cleared">Cleared</option>
              <option value="pending">Pending</option>
              <option value="suspicious">Suspicious</option>
            </select>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="transactions-section">
          <h2>Transaction Monitoring</h2>
          <div className="transactions-list">
            {paginatedTransactions.length === 0 ? (
              <div className="no-transactions">
                <p>No transactions found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Add First Transaction
                </button>
              </div>
            ) : (
              paginatedTransactions.map((transaction, index) => (
                <div 
                  key={transaction.id}
                  className={`transaction-item ${transaction.status} ${selectedTransaction?.id === transaction.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTransaction(transaction)}
                >
                  <div className="transaction-header">
                    <span className="transaction-id">#{transaction.id}</span>
                    <span className={`status-badge ${transaction.status}`}>
                      {transaction.status}
                    </span>
                  </div>
                  <div className="transaction-details">
                    <span>{transaction.from} → {transaction.to}</span>
                    <span>Amount: {transaction.amount}</span>
                  </div>
                  <div className="transaction-footer">
                    <span>{new Date(transaction.timestamp * 1000).toLocaleDateString()}</span>
                    <span>Risk: {transaction.riskScore}</span>
                    {transaction.isVerified && <span className="verified-badge">✅ Verified</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="history-section">
          <h3>User Activity History</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((item, index) => (
              <div key={index} className="history-item">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateTransaction 
          onSubmit={createTransaction}
          onClose={() => setShowCreateModal(false)}
          creating={creatingTransaction}
          transactionData={newTransactionData}
          setTransactionData={setNewTransactionData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedTransaction && (
        <TransactionDetailModal
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedTransaction.id)}
          renderRiskChart={renderRiskChart}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTransaction: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  transactionData: any;
  setTransactionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, transactionData, setTransactionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTransactionData({ ...transactionData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-transaction-modal">
        <div className="modal-header">
          <h2>New Transaction Scan</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE Risk Assessment</strong>
            <p>Risk scores are encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>From Address *</label>
            <input 
              type="text" 
              name="from" 
              value={transactionData.from} 
              onChange={handleChange} 
              placeholder="Sender address..." 
            />
          </div>
          
          <div className="form-group">
            <label>To Address *</label>
            <input 
              type="text" 
              name="to" 
              value={transactionData.to} 
              onChange={handleChange} 
              placeholder="Receiver address..." 
            />
          </div>
          
          <div className="form-group">
            <label>Amount (Integer) *</label>
            <input 
              type="number" 
              name="amount" 
              value={transactionData.amount} 
              onChange={handleChange} 
              placeholder="Transaction amount..." 
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Risk Calculation</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={transactionData.description} 
              onChange={handleChange} 
              placeholder="Transaction purpose..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !transactionData.from || !transactionData.to || !transactionData.amount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Scanning..." : "Scan Transaction"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TransactionDetailModal: React.FC<{
  transaction: TransactionData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderRiskChart: (transaction: TransactionData) => JSX.Element;
}> = ({ transaction, onClose, isDecrypting, decryptData, renderRiskChart }) => {
  return (
    <div className="modal-overlay">
      <div className="transaction-detail-modal">
        <div className="modal-header">
          <h2>Transaction Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="transaction-info">
            <div className="info-row">
              <span>Transaction ID:</span>
              <strong>{transaction.id}</strong>
            </div>
            <div className="info-row">
              <span>From:</span>
              <strong>{transaction.from}</strong>
            </div>
            <div className="info-row">
              <span>To:</span>
              <strong>{transaction.to}</strong>
            </div>
            <div className="info-row">
              <span>Amount:</span>
              <strong>{transaction.amount}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={`status-text ${transaction.status}`}>{transaction.status}</strong>
            </div>
          </div>
          
          <div className="risk-section">
            <h3>AML Risk Assessment</h3>
            {renderRiskChart(transaction)}
            
            <div className="decryption-section">
              <button 
                className={`decrypt-btn ${transaction.isVerified ? 'verified' : ''}`}
                onClick={decryptData}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 transaction.isVerified ? "✅ Risk Score Verified" : 
                 "🔓 Verify Risk Score"}
              </button>
              <p className="decryption-note">
                {transaction.isVerified ? 
                  "Risk score has been verified on-chain using FHE technology" :
                  "Click to decrypt and verify the risk score on-chain"
                }
              </p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


