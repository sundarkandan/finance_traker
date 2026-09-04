import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Wallet, TrendingUp, TrendingDown, Plus, Minus, CreditCard, Filter, PieChart, Receipt, DollarSign, Menu, Sparkles, X, Trash2, Loader2, AlertTriangle, QrCode, Camera, Wifi, WifiOff, RefreshCw, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, isSameMonth, isSameYear, isSameDay } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

const API_BASE_URL = `http://${window.location.hostname}:5000/api`;

// --- QR SYNC CONSTANTS ---
const PENDING_KEY = 'xtracker_pending_sync';   
const ACCOUNTS_CACHE_KEY = 'xtracker_accounts_cache'; 
const SNAPSHOT_KEY = 'xtracker_offline_snapshot'; 
const QR_CHUNK_SIZE = 1;                       
const SNAPSHOT_CHUNK_SIZE = 1;                 
const HEALTH_CHECK_INTERVAL_MS = 15000;        
const QR_SCANNER_ELEMENT_ID = 'xtracker-qr-reader';

const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const loadPending = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const loadCachedAccounts = () => {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const GlassCard = ({ children, className = '' }) => (
  <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 md:p-6 ${className}`}>
    {children}
  </div>
);

const InputStyle = "w-full p-3.5 bg-slate-800/50 border border-slate-600/50 rounded-xl outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-slate-100 transition-all text-sm md:text-base";

export default function App() {
  const [activeTab, setActiveTab] = useState('result');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [accounts, setAccounts] = useState(loadCachedAccounts);
  const [transactions, setTransactions] = useState([]); // DB Data / Snapshot
  const [pendingSync, setPendingSync] = useState(loadPending); // Local Offline Data

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [newAccBal, setNewAccBal] = useState('');

  // Sync States
  const [chunkIndex, setChunkIndex] = useState(0);
  const [snapshotChunkIndex, setSnapshotChunkIndex] = useState(0);
  const [receivedSnapshotChunks, setReceivedSnapshotChunks] = useState({});
  const [receivedSnapshotAccounts, setReceivedSnapshotAccounts] = useState([]);
  const [expectedSnapshotChunkTotal, setExpectedSnapshotChunkTotal] = useState(null);
  const [lastSnapshotSyncedAt, setLastSnapshotSyncedAt] = useState(() => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      return raw ? JSON.parse(raw).syncedAt : null;
    } catch { return null; }
  });

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [receivedChunks, setReceivedChunks] = useState({});
  const [expectedChunkTotal, setExpectedChunkTotal] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const scannerRef = useRef(null);

  /* ------------------------------------------------------------------ */
  /* COMBINED TRANSACTIONS (Fix for Instant Mobile Update)              */
  /* ------------------------------------------------------------------ */
  // Ithu thaa main fix. DB la iruka data + local pending data va serthu UI ku anuppudhu
  const displayTransactions = useMemo(() => {
    const pendingWithFlags = pendingSync.map(t => ({ ...t, id: t.clientId || genId(), isPending: true }));
    return [...transactions, ...pendingWithFlags];
  }, [transactions, pendingSync]);


  const showError = (msg) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(''), 4000);
  };

  const fetchAccounts = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/accounts`);
    if (!res.ok) throw new Error('Failed to load accounts');
    const data = await res.json();
    const names = data.map((a) => a.name);
    setAccounts(names);
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(names));
  }, []);

  const fetchTransactions = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/transactions`);
    if (!res.ok) throw new Error('Failed to load transactions');
    const data = await res.json();
    setTransactions(data.map((t) => ({ ...t, id: t._id })));
  }, []);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([fetchAccounts(), fetchTransactions()]);
      setIsOnline(true);
    } catch (err) {
      setIsOnline(false);
      const cachedSnapshot = localStorage.getItem(SNAPSHOT_KEY);
      if (cachedSnapshot) {
        try {
          const snap = JSON.parse(cachedSnapshot);
          setAccounts(snap.accounts || []);
          setTransactions(snap.transactions || []);
          setLastSnapshotSyncedAt(snap.syncedAt);
          showError(`Backend offline — showing data from ${new Date(snap.syncedAt).toLocaleString()}.`);
        } catch {}
      } else {
        const cached = localStorage.getItem(ACCOUNTS_CACHE_KEY);
        if (cached) {
          try { setAccounts(JSON.parse(cached)); } catch {}
        }
        showError('Backend offline — using cached accounts. Entries will save locally.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [fetchAccounts, fetchTransactions]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!cancelled) setIsOnline(res.ok);
      } catch {
        if (!cancelled) setIsOnline(false);
      }
    };
    const interval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const savePendingSync = (list) => {
    setPendingSync(list);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  };

  const addPendingEntry = (entry) => {
    const next = [...pendingSync, entry];
    savePendingSync(next);
  };

  const clearAllPendingSync = () => {
    if (!window.confirm('Clear all entries waiting to sync? Only do this after confirming the laptop already imported them.')) return;
    savePendingSync([]);
    setChunkIndex(0);
  };

  /* ------------------------------------------------------------------ */
  /* DERIVED TOTALS (Uses combined displayTransactions)                 */
  /* ------------------------------------------------------------------ */

  const totalRevenue = useMemo(() => displayTransactions.filter(t => t.type === 'revenue').reduce((acc, curr) => acc + curr.amount, 0), [displayTransactions]);
  const totalExpense = useMemo(() => displayTransactions.filter(t => t.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0), [displayTransactions]);
  const availableBalance = totalRevenue - totalExpense;

  // --- RESULT TAB LOGIC ---
  const [filterType, setFilterType] = useState('all');
  const [filterValue, setFilterValue] = useState('');

  const datewiseStatementData = useMemo(() => {
    const sortedTxns = [...displayTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const groupedByDate = {};
    let runningBalance = 0;

    sortedTxns.forEach(t => {
      if (!groupedByDate[t.date]) {
        groupedByDate[t.date] = { date: t.date, revenue: 0, expense: 0 };
      }
      if (t.type === 'revenue') groupedByDate[t.date].revenue += t.amount;
      if (t.type === 'expense') groupedByDate[t.date].expense += t.amount;
    });

    const allDatesProcessed = Object.values(groupedByDate).sort((a, b) => new Date(a.date) - new Date(b.date)).map(dayData => {
      const beforeExpenses = runningBalance + dayData.revenue;
      const afterExpenses = beforeExpenses - dayData.expense;
      runningBalance = afterExpenses; 

      return {
        ...dayData,
        beforeExpenses,
        afterExpenses,
        status: afterExpenses >= 0 ? 'POSITIVE' : 'NEGATIVE'
      };
    });

    let filteredResult = allDatesProcessed;
    if (filterType !== 'all' && filterValue) {
      const filterDateObj = new Date(filterValue);
      filteredResult = filteredResult.filter(d => {
        const tDate = new Date(d.date);
        if (filterType === 'date') return isSameDay(tDate, filterDateObj);
        if (filterType === 'month') return isSameMonth(tDate, filterDateObj);
        if (filterType === 'year') return isSameYear(tDate, filterDateObj);
        return true;
      });
    }

    return filteredResult.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [displayTransactions, filterType, filterValue]);

  // --- EXPENSE TAB LOGIC ---
  const [expName, setExpName] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState('');
  const [expDateFilter, setExpDateFilter] = useState('');

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!expName || !expAmount || !expMethod) return;

    const payload = {
      type: 'expense',
      category: expName,
      amount: parseFloat(expAmount),
      method: expMethod,
      date: new Date().toISOString().split('T')[0],
      clientId: genId(), // Needed for offline tracking
    };

    if (!isOnline) {
      addPendingEntry(payload);
      setExpName('');
      setExpAmount('');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add expense');
      await fetchTransactions();
      setExpName('');
      setExpAmount('');
    } catch (err) {
      addPendingEntry(payload);
      setIsOnline(false);
      showError('Backend unreachable — saved locally. Sync later via QR.');
      setExpName('');
      setExpAmount('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredExpenses = displayTransactions.filter(t => t.type === 'expense' && (expDateFilter ? t.date === expDateFilter : true)).sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleDeleteTransaction = async (id, isPendingItem = false) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    
    // Offline / Pending data delete pannum pothu
    if (isPendingItem) {
      const newPending = pendingSync.filter(t => t.clientId !== id && t.id !== id);
      savePendingSync(newPending);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete transaction');
      await fetchTransactions();
    } catch (err) {
      showError(err.message);
    }
  };

  // --- REVENUE TAB LOGIC ---
  const [revAmount, setRevAmount] = useState('');
  const [revMethod, setRevMethod] = useState('');
  const [revFilterType, setRevFilterType] = useState('all');
  const [revFilterValue, setRevFilterValue] = useState('');

  const handleAddRevenue = async (e) => {
    e.preventDefault();
    if (!revAmount || !revMethod) return;

    const payload = {
      type: 'revenue',
      amount: parseFloat(revAmount),
      method: revMethod,
      note: 'Added Funds',
      date: new Date().toISOString().split('T')[0],
      clientId: genId(),
    };

    if (!isOnline) {
      addPendingEntry(payload);
      setRevAmount('');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add revenue');
      await fetchTransactions();
      setRevAmount('');
    } catch (err) {
      addPendingEntry(payload);
      setIsOnline(false);
      showError('Backend unreachable — saved locally. Sync later via QR.');
      setRevAmount('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredRevenues = useMemo(() => {
    let revs = displayTransactions.filter(t => t.type === 'revenue').sort((a, b) => new Date(b.date) - new Date(a.date));
    if (revFilterType !== 'all' && revFilterValue) {
      const filterDate = new Date(revFilterValue);
      revs = revs.filter(t => {
        const tDate = new Date(t.date);
        if (revFilterType === 'month') return isSameMonth(tDate, filterDate);
        if (revFilterType === 'year') return isSameYear(tDate, filterDate);
        return true;
      });
    }
    return revs;
  }, [displayTransactions, revFilterType, revFilterValue]);

  const filteredRevenueTotal = filteredRevenues.reduce((acc, curr) => acc + curr.amount, 0);

  // --- ACCOUNT MANAGEMENT LOGIC ---
  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!newAccName) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAccName,
          initialBalance: newAccBal ? Number(newAccBal) : 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create account');
      await Promise.all([fetchAccounts(), fetchTransactions()]);
      setIsModalOpen(false);
      setNewAccName('');
      setNewAccBal('');
    } catch (err) {
      showError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async (accountToDelete) => {
    if (!window.confirm(`Are you sure you want to delete ${accountToDelete}?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/accounts/${encodeURIComponent(accountToDelete)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete account');
      await fetchAccounts();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleAdjustBalance = async (e) => {
    e.preventDefault();
    if (!adjustAmount || !adjustModal) return;
    
    const isIncrease = adjustModal.mode === 'increase';
    const payload = {
      type: isIncrease ? 'revenue' : 'expense',
      amount: parseFloat(adjustAmount),
      method: adjustModal.account,
      note: isIncrease ? 'Balance Adjustment' : undefined,
      category: !isIncrease ? 'Balance Adjustment' : undefined,
      date: new Date().toISOString().split('T')[0],
      clientId: genId(),
    };

    if (!isOnline) {
      addPendingEntry(payload);
      setAdjustModal(null);
      setAdjustAmount('');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to adjust balance');
      await fetchTransactions();
      setAdjustModal(null);
      setAdjustAmount('');
    } catch (err) {
      addPendingEntry(payload);
      setIsOnline(false);
      showError('Backend unreachable — saved locally. Sync later via QR.');
      setAdjustModal(null);
      setAdjustAmount('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const methodBalances = useMemo(() => {
    const balances = {};
    accounts.forEach(type => balances[type] = 0);
    displayTransactions.forEach(t => {
      if (accounts.includes(t.method)) {
        if (!balances[t.method]) balances[t.method] = 0;
        if (t.type === 'revenue') balances[t.method] += t.amount;
        if (t.type === 'expense') balances[t.method] -= t.amount;
      }
    });
    return balances;
  }, [displayTransactions, accounts]);

  /* ------------------------------------------------------------------ */
  /* QR SYNC LOGIC                                                      */
  /* ------------------------------------------------------------------ */

  const qrChunks = useMemo(() => {
    if (pendingSync.length === 0) return [];
    const chunks = [];
    for (let i = 0; i < pendingSync.length; i += QR_CHUNK_SIZE) {
      chunks.push(pendingSync.slice(i, i + QR_CHUNK_SIZE));
    }
    return chunks.map((items, idx) => ({
      app: 'xtracker-sync',
      chunkIndex: idx,
      totalChunks: chunks.length,
      items,
    }));
  }, [pendingSync]);

  useEffect(() => {
    if (chunkIndex >= qrChunks.length) setChunkIndex(0);
  }, [qrChunks, chunkIndex]);

  const currentQrPayload = qrChunks[chunkIndex] ? JSON.stringify(qrChunks[chunkIndex]) : '';

  const snapshotChunks = useMemo(() => {
    // We only send DB transactions via snapshot, NOT pending local items
    if (transactions.length === 0) return [];
    const chunks = [];
    for (let i = 0; i < transactions.length; i += SNAPSHOT_CHUNK_SIZE) {
      chunks.push(transactions.slice(i, i + SNAPSHOT_CHUNK_SIZE));
    }
    return chunks.map((items, idx) => ({
      app: 'xtracker-snapshot',
      chunkIndex: idx,
      totalChunks: chunks.length,
      accounts, 
      items,
    }));
  }, [transactions, accounts]);

  useEffect(() => {
    if (snapshotChunkIndex >= snapshotChunks.length) setSnapshotChunkIndex(0);
  }, [snapshotChunks, snapshotChunkIndex]);

  const currentSnapshotQrPayload = snapshotChunks[snapshotChunkIndex]
    ? JSON.stringify(snapshotChunks[snapshotChunkIndex])
    : '';

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setIsScannerOpen(false);
  }, []);

  const handleDecodedText = useCallback((decodedText) => {
    let payload;
    try { payload = JSON.parse(decodedText); } 
    catch { setScanMessage('⚠️ That QR code is not an X-Tracker code.'); return; }

    if (!payload || !Array.isArray(payload.items)) {
      setScanMessage('⚠️ That QR code is not an X-Tracker code.');
      return;
    }

    if (payload.app === 'xtracker-sync') {
      setExpectedChunkTotal(payload.totalChunks);
      setReceivedChunks((prev) => (prev[payload.chunkIndex] ? prev : { ...prev, [payload.chunkIndex]: payload.items }));
      setScanMessage(`✅ Pending entries page ${payload.chunkIndex + 1} of ${payload.totalChunks} scanned`);
      return;
    }

    if (payload.app === 'xtracker-snapshot') {
      setExpectedSnapshotChunkTotal(payload.totalChunks);
      if (payload.accounts) setReceivedSnapshotAccounts(payload.accounts);
      setReceivedSnapshotChunks((prev) => (prev[payload.chunkIndex] ? prev : { ...prev, [payload.chunkIndex]: payload.items }));
      setScanMessage(`✅ Data snapshot page ${payload.chunkIndex + 1} of ${payload.totalChunks} scanned`);
      return;
    }

    setScanMessage('⚠️ That QR code is not an X-Tracker code.');
  }, []);

  const startScanner = useCallback(async () => {
    setScanMessage('');
    setIsScannerOpen(true);
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(QR_SCANNER_ELEMENT_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' }, 
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (decodedText) => handleDecodedText(decodedText),
          () => {} 
        );
      } catch (err) {
        showError('Could not access camera: ' + err.message);
        setIsScannerOpen(false);
      }
    }, 500); 
  }, [handleDecodedText]);

  useEffect(() => {
    if (activeTab !== 'sync' && scannerRef.current) stopScanner();
    return () => { if (scannerRef.current) stopScanner(); };
  }, [activeTab, stopScanner]);

  const handleImportReceived = async () => {
    const items = Object.values(receivedChunks).flat();
    if (items.length === 0) return;
    setIsImporting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/transactions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to import scanned entries');
      const result = await res.json();
      await fetchTransactions();
      setReceivedChunks({});
      setExpectedChunkTotal(null);
      setScanMessage(`🎉 Imported ${result.insertedCount} entries${result.skippedCount ? `, skipped ${result.skippedCount} duplicate(s)` : ''}.`);
      await stopScanner();
    } catch (err) {
      showError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSaveSnapshotLocally = () => {
    const items = Object.values(receivedSnapshotChunks).flat();
    const snapshot = { accounts: receivedSnapshotAccounts, transactions: items, syncedAt: new Date().toISOString() };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    setAccounts(receivedSnapshotAccounts);
    setTransactions(items);
    setLastSnapshotSyncedAt(snapshot.syncedAt);
    setReceivedSnapshotChunks({});
    setExpectedSnapshotChunkTotal(null);
    setReceivedSnapshotAccounts([]);
    setScanMessage(`🎉 Saved ${items.length} entries for offline viewing on this device.`);
  };

  const receivedChunkCount = Object.keys(receivedChunks).length;
  const receivedItemCount = Object.values(receivedChunks).reduce((sum, arr) => sum + arr.length, 0);
  const receivedSnapshotChunkCount = Object.keys(receivedSnapshotChunks).length;
  const receivedSnapshotItemCount = Object.values(receivedSnapshotChunks).reduce((sum, arr) => sum + arr.length, 0);
  const isSnapshotComplete = expectedSnapshotChunkTotal !== null && receivedSnapshotChunkCount === expectedSnapshotChunkTotal;


  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b1120] text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-cyan-400" size={40} />
          <p className="text-slate-400 font-medium">Connecting to server…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0b1120] text-slate-200 overflow-hidden selection:bg-cyan-500/30 font-sans relative">

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .table-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .table-scroll::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.4); border-radius: 0 0 16px 0; }
        .expense-scroll::-webkit-scrollbar-thumb { background: rgba(244, 63, 94, 0.3); border-radius: 10px; }
        .expense-scroll::-webkit-scrollbar-thumb:hover { background: rgba(244, 63, 94, 0.7); }
        .revenue-scroll::-webkit-scrollbar-thumb { background: rgba(6, 182, 212, 0.3); border-radius: 10px; }
        .revenue-scroll::-webkit-scrollbar-thumb:hover { background: rgba(6, 182, 212, 0.7); }
        #${QR_SCANNER_ELEMENT_ID} video { border-radius: 1rem; width: 100% !important; }
      `}</style>

      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

      {errorMsg && (
        <div className="fixed top-6 right-4 left-4 md:left-auto md:right-6 z-[100] bg-rose-500/10 border border-rose-500/30 backdrop-blur-xl text-rose-300 px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {/* DESKTOP SIDEBAR */}
      <aside className={`hidden md:flex ${isSidebarOpen ? 'w-72' : 'w-20'} transition-all duration-300 bg-slate-900/40 backdrop-blur-3xl border-r border-white/10 flex-col z-20`}>
        <div className="h-20 flex items-center justify-between px-5 border-b border-white/10 shrink-0">
          {isSidebarOpen && (
            <div className="flex items-center gap-2">
              <Sparkles className="text-cyan-400" size={24} />
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">X-Tracker</span>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white">
            <Menu size={20} />
          </button>
        </div>

        <nav className="flex-1 py-8 space-y-3 px-4 overflow-y-auto custom-scrollbar">
          <button onClick={() => setActiveTab('result')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ease-out active:scale-95 ${activeTab === 'result' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] scale-[1.02]' : 'text-slate-400 hover:bg-white/5 hover:text-white hover:translate-x-1'}`}>
            <PieChart size={20} className={`transition-transform duration-300 ${activeTab === 'result' ? 'scale-110' : ''}`} /> {isSidebarOpen && <span className="font-semibold tracking-wide">Overview</span>}
          </button>
          <button onClick={() => setActiveTab('expenses')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ease-out active:scale-95 ${activeTab === 'expenses' ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.3)] scale-[1.02]' : 'text-slate-400 hover:bg-white/5 hover:text-white hover:translate-x-1'}`}>
            <Receipt size={20} className={`transition-transform duration-300 ${activeTab === 'expenses' ? 'scale-110' : ''}`} /> {isSidebarOpen && <span className="font-semibold tracking-wide">Expenses</span>}
          </button>
          <button onClick={() => setActiveTab('revenue')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ease-out active:scale-95 ${activeTab === 'revenue' ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] scale-[1.02]' : 'text-slate-400 hover:bg-white/5 hover:text-white hover:translate-x-1'}`}>
            <DollarSign size={20} className={`transition-transform duration-300 ${activeTab === 'revenue' ? 'scale-110' : ''}`} /> {isSidebarOpen && <span className="font-semibold tracking-wide">Revenue</span>}
          </button>
          <button onClick={() => setActiveTab('sync')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ease-out active:scale-95 relative ${activeTab === 'sync' ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)] scale-[1.02]' : 'text-slate-400 hover:bg-white/5 hover:text-white hover:translate-x-1'}`}>
            <QrCode size={20} className={`transition-transform duration-300 ${activeTab === 'sync' ? 'scale-110' : ''}`} /> {isSidebarOpen && <span className="font-semibold tracking-wide">QR Sync</span>}
            {pendingSync.length > 0 && (
              <span className={`${isSidebarOpen ? 'ml-auto' : 'absolute -top-1 -right-1'} min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-[10px] font-black text-slate-900 flex items-center justify-center`}>
                {pendingSync.length}
              </span>
            )}
          </button>
        </nav>

        <div className="p-4 border-t border-white/10 space-y-2 shrink-0">
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            {isSidebarOpen && <span className="text-xs font-bold uppercase tracking-wider">{isOnline ? 'Backend Online' : 'Backend Offline'}</span>}
          </div>
          {!isOnline && isSidebarOpen && lastSnapshotSyncedAt && (
            <p className="px-1 text-[10px] text-slate-500 font-medium">
              Offline data from {new Date(lastSnapshotSyncedAt).toLocaleString()}
            </p>
          )}
        </div>
      </aside>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-around pb-safe shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <button onClick={() => setActiveTab('result')} className={`flex flex-col items-center p-3 w-1/4 transition-colors ${activeTab === 'result' ? 'text-cyan-400' : 'text-slate-500'}`}>
          <PieChart size={20} />
          <span className="text-[10px] font-bold mt-1">Overview</span>
        </button>
        <button onClick={() => setActiveTab('expenses')} className={`flex flex-col items-center p-3 w-1/4 transition-colors ${activeTab === 'expenses' ? 'text-rose-400' : 'text-slate-500'}`}>
          <Receipt size={20} />
          <span className="text-[10px] font-bold mt-1">Expenses</span>
        </button>
        <button onClick={() => setActiveTab('revenue')} className={`flex flex-col items-center p-3 w-1/4 transition-colors ${activeTab === 'revenue' ? 'text-emerald-400' : 'text-slate-500'}`}>
          <DollarSign size={20} />
          <span className="text-[10px] font-bold mt-1">Revenue</span>
        </button>
        <button onClick={() => setActiveTab('sync')} className={`flex flex-col items-center p-3 w-1/4 relative transition-colors ${activeTab === 'sync' ? 'text-violet-400' : 'text-slate-500'}`}>
          <QrCode size={20} />
          <span className="text-[10px] font-bold mt-1">Sync</span>
          {pendingSync.length > 0 && <span className="absolute top-2 right-4 w-2 h-2 bg-amber-400 rounded-full animate-pulse"/>}
        </button>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden z-10">
        <header className="h-16 md:h-20 bg-slate-900/20 backdrop-blur-md border-b border-white/5 flex items-center px-4 md:px-10 justify-between shrink-0">
          <h2 className="text-xl md:text-2xl font-bold text-white capitalize tracking-wide">{activeTab === 'sync' ? 'QR Sync' : activeTab}</h2>
          <div className="flex items-center gap-2 md:gap-4 bg-slate-800/50 px-3 md:px-5 py-1.5 md:py-2.5 rounded-full border border-white/10 shadow-lg">
            <Wallet size={16} className="text-cyan-400 md:w-[18px] md:h-[18px]" />
            <span className="hidden md:inline text-sm text-slate-400 font-medium uppercase tracking-wider">Net Balance</span>
            <span className="text-lg md:text-xl font-black text-white">₹{availableBalance.toLocaleString()}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 md:pb-10 custom-scrollbar">

          {/* --- RESULT TAB --- */}
          {activeTab === 'result' && (
            <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                <GlassCard className="hover:-translate-y-1 transition-transform duration-300 border-t-4 border-t-emerald-500">
                  <p className="text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider mb-2 flex items-center gap-2"><TrendingUp size={16} className="text-emerald-400"/> Total Revenue</p>
                  <h3 className="text-2xl md:text-3xl font-black text-white">₹{totalRevenue.toLocaleString()}</h3>
                </GlassCard>
                <GlassCard className="hover:-translate-y-1 transition-transform duration-300 border-t-4 border-t-rose-500">
                  <p className="text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider mb-2 flex items-center gap-2"><TrendingDown size={16} className="text-rose-400"/> Total Expenses</p>
                  <h3 className="text-2xl md:text-3xl font-black text-white">₹{totalExpense.toLocaleString()}</h3>
                </GlassCard>
                <GlassCard className="hover:-translate-y-1 transition-transform duration-300 border-t-4 border-t-cyan-500">
                  <p className="text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider mb-2 flex items-center gap-2"><Wallet size={16} className="text-cyan-400"/> Available Balance</p>
                  <h3 className="text-2xl md:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">₹{availableBalance.toLocaleString()}</h3>
                </GlassCard>
              </div>

              <GlassCard>
                <div className="flex flex-col sm:flex-row items-end gap-4 md:gap-6">
                  <div className="w-full sm:w-1/3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Filter Data</label>
                    <select className={InputStyle} value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterValue(''); }}>
                      <option value="all">All Time History</option>
                      <option value="date">Specific Date</option>
                      <option value="month">Specific Month</option>
                      <option value="year">Specific Year</option>
                    </select>
                  </div>
                  {filterType !== 'all' && (
                    <div className="w-full sm:w-1/3 animate-in fade-in slide-in-from-left-4">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select {filterType}</label>
                      <input style={{colorScheme: 'dark'}} type={filterType === 'month' ? 'month' : filterType === 'year' ? 'number' : 'date'} className={InputStyle} value={filterValue} onChange={(e) => setFilterValue(e.target.value)}/>
                    </div>
                  )}
                </div>
              </GlassCard>

              <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
                <div className="p-4 md:p-6 border-b border-white/5"><h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><Sparkles size={20} className="text-cyan-400"/> Daily Statement</h3></div>
                <div className="overflow-x-auto w-full custom-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-white/5 text-slate-300 text-[10px] md:text-xs uppercase tracking-widest font-bold">
                        <th className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">Date</th>
                        <th className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">Before Expenses</th>
                        <th className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">Day's Expenses</th>
                        <th className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">After Expenses</th>
                        <th className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {datewiseStatementData.map((data, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors group">
                          <td className="px-4 md:px-6 py-4 md:py-5 font-semibold text-white whitespace-nowrap">{format(new Date(data.date), 'dd MMM yyyy')}</td>
                          <td className="px-4 md:px-6 py-4 md:py-5 text-emerald-400 font-medium whitespace-nowrap">₹{data.beforeExpenses.toLocaleString()}</td>
                          <td className="px-4 md:px-6 py-4 md:py-5 text-rose-400 font-medium whitespace-nowrap">₹{data.expense.toLocaleString()}</td>
                          <td className="px-4 md:px-6 py-4 md:py-5 text-cyan-400 font-bold group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.5)] transition-all whitespace-nowrap">₹{data.afterExpenses.toLocaleString()}</td>
                          <td className="px-4 md:px-6 py-4 md:py-5 whitespace-nowrap">
                            <span className={`px-3 md:px-4 py-1.5 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider border ${data.afterExpenses >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                              {data.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {datewiseStatementData.length === 0 && (
                        <tr><td colSpan="5" className="p-10 text-center text-slate-500 font-medium">No records found for this filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* --- EXPENSES TAB --- */}
          {activeTab === 'expenses' && (
            <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8 items-start">

                <div className="xl:col-span-1">
                  <GlassCard className="sticky top-0 border-t-4 border-t-rose-500">
                    <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6 flex items-center gap-2"><TrendingDown size={22} className="text-rose-400"/> Record Expense</h3>
                    {!isOnline && (
                      <div className="mb-4 md:mb-5 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs font-semibold flex items-center gap-2">
                        <WifiOff size={14} className="shrink-0" /> Offline entry (Will sync later)
                      </div>
                    )}
                    <form onSubmit={handleAddExpense} className="space-y-4 md:space-y-5">
                      <div>
                        <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Expense Name</label>
                        <input type="text" required placeholder="e.g. EB Bill, Netflix" className={InputStyle} value={expName} onChange={e => setExpName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Amount (₹)</label>
                        <input type="number" required placeholder="0.00" className={InputStyle} value={expAmount} onChange={e => setExpAmount(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Paid Via</label>
                        <select required className={InputStyle} value={expMethod} onChange={e => setExpMethod(e.target.value)}>
                          <option value="" disabled>Select Source</option>
                          {accounts.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </div>
                      <button type="submit" disabled={isSubmitting} className="w-full py-3.5 md:py-4 mt-2 md:mt-4 bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 text-white rounded-xl font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(244,63,94,0.4)] flex justify-center items-center gap-2 disabled:opacity-50 text-sm md:text-base">
                        {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Add Expense
                      </button>
                    </form>
                  </GlassCard>
                </div>

                <div className="xl:col-span-2">
                  <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col h-[400px] md:h-[460px]">
                    <div className="p-4 md:p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 md:gap-4 shrink-0">
                      <h3 className="text-lg md:text-xl font-bold text-white">Expense History</h3>
                      <div className="flex items-center gap-2 bg-slate-800/80 p-1 md:p-1.5 rounded-xl border border-white/10 w-full sm:w-auto">
                        <Filter size={16} className="text-slate-400 ml-2 md:ml-3 hidden sm:block" />
                        <input style={{colorScheme: 'dark'}} type="date" className="p-1.5 md:p-2 bg-transparent text-xs md:text-sm text-slate-200 outline-none w-full" value={expDateFilter} onChange={e => setExpDateFilter(e.target.value)} />
                        {expDateFilter && <button onClick={() => setExpDateFilter('')} className="text-[10px] md:text-xs text-rose-400 pr-2 md:pr-3 font-bold uppercase tracking-wider hover:text-rose-300 shrink-0">Clear</button>}
                      </div>
                    </div>

                    <div className="overflow-x-auto overflow-y-auto table-scroll expense-scroll flex-1 relative w-full">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead className="sticky top-0 bg-[#0d1526] z-10 border-b border-white/5 shadow-sm">
                          <tr className="text-slate-300 text-[10px] md:text-xs uppercase tracking-widest font-bold">
                            <th className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap">Date</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap">Expense Details</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap">Payment Method</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">Amount</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredExpenses.map(t => (
                            <tr key={t.id} className="hover:bg-white/5 transition-colors group">
                              <td className="px-4 md:px-6 py-3 md:py-5 text-slate-400 text-xs md:text-sm font-medium whitespace-nowrap">
                                {t.date}
                                {t.isPending && <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase font-bold tracking-widest">Offline</span>}
                              </td>
                              <td className="px-4 md:px-6 py-3 md:py-5 font-semibold text-white text-sm md:text-base whitespace-nowrap">{t.category}</td>
                              <td className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap"><span className="px-2 md:px-3 py-1 bg-slate-800 text-slate-300 text-[10px] md:text-xs font-bold rounded-lg border border-white/10 shadow-sm">{t.method}</span></td>
                              <td className="px-4 md:px-6 py-3 md:py-5 text-right font-black text-rose-400 text-sm md:text-base whitespace-nowrap">-₹{t.amount.toLocaleString()}</td>
                              <td className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">
                                <button onClick={() => handleDeleteTransaction(t.id, t.isPending)} className="p-1.5 md:p-2 text-slate-500 hover:text-rose-400 hover:bg-white/5 rounded-lg transition-all opacity-80 md:opacity-60 md:group-hover:opacity-100" title="Delete Expense">
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filteredExpenses.length === 0 && (
                            <tr><td colSpan="5" className="p-8 text-center text-slate-500 font-medium">No records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- REVENUE TAB --- */}
          {activeTab === 'revenue' && (
            <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-4">

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/50 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl shadow-xl">
                <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2"><CreditCard size={20} className="text-cyan-400"/> Your Accounts & Sources</h3>
                <button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto px-4 md:px-5 py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 rounded-xl font-bold tracking-wide transition-all text-xs md:text-sm flex justify-center items-center gap-2">
                  <Plus size={16}/> Add New Source
                </button>
              </div>

              {/* Dynamic Balances */}
              {accounts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
                  {accounts.map((method, idx) => {
                    const balance = methodBalances[method] || 0;
                    return (
                      <div
                        key={method}
                        className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
                        style={{ animationDelay: `${idx * 80}ms` }}
                      >
                        <GlassCard className="relative overflow-hidden group border-t-4 border-t-emerald-500 hover:-translate-y-1 md:hover:-translate-y-1.5 hover:border-t-cyan-400 transition-all duration-300 ease-out hover:shadow-[0_12px_45px_-12px_rgba(6,182,212,0.35)]">
                          <div className="absolute -right-6 -bottom-6 opacity-[0.04] group-hover:opacity-[0.08] group-hover:scale-110 group-hover:-rotate-6 transition-all duration-500 pointer-events-none">
                            <CreditCard size={110} />
                          </div>
                          <div className="relative z-10 flex items-center gap-3 mb-4 md:mb-5">
                            <div className="p-2 md:p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl group-hover:bg-cyan-500/10 group-hover:border-cyan-500/20 transition-colors duration-300">
                              <Wallet size={16} className="text-emerald-400 group-hover:text-cyan-400 transition-colors duration-300 md:w-[18px] md:h-[18px]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-white text-xs md:text-sm font-bold truncate">{method}</p>
                              <p className="text-slate-500 text-[9px] md:text-[10px] uppercase tracking-widest font-bold">Account Balance</p>
                            </div>
                          </div>
                          <h3 className="relative z-10 text-2xl md:text-3xl font-black text-white mb-5 md:mb-6 tracking-tight">
                            ₹{balance.toLocaleString()}
                          </h3>
                          <div className="relative z-10 flex items-center gap-0.5 bg-slate-950/50 border border-white/10 rounded-xl p-1 w-fit">
                            <button onClick={() => setAdjustModal({ account: method, mode: 'increase' })} className="p-1.5 md:p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 active:scale-90 transition-all duration-200" title="Increase Balance"><Plus size={15} /></button>
                            <div className="w-px h-3 md:h-4 bg-white/10" />
                            <button onClick={() => setAdjustModal({ account: method, mode: 'decrease' })} className="p-1.5 md:p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 active:scale-90 transition-all duration-200" title="Decrease Balance"><Minus size={15} /></button>
                            <div className="w-px h-3 md:h-4 bg-white/10" />
                            <button onClick={() => handleDeleteAccount(method)} className="p-1.5 md:p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 active:scale-90 transition-all duration-200" title="Delete Account"><Trash2 size={15} /></button>
                          </div>
                        </GlassCard>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center p-8 md:p-10 bg-white/5 border border-white/10 rounded-2xl">
                  <p className="text-slate-400 font-medium text-sm md:text-base">No accounts found. Create one to start tracking!</p>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8 items-start">
                <div className="xl:col-span-1">
                  <GlassCard className="sticky top-0 border-t-4 border-t-cyan-500">
                    <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6 flex items-center gap-2"><TrendingUp size={22} className="text-cyan-400"/> Add Funds</h3>
                    {!isOnline && (
                      <div className="mb-4 md:mb-5 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs font-semibold flex items-center gap-2">
                        <WifiOff size={14} className="shrink-0" /> Offline entry (Will sync later)
                      </div>
                    )}
                    <form onSubmit={handleAddRevenue} className="space-y-4 md:space-y-5">
                      <div>
                        <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Amount (₹)</label>
                        <input type="number" required placeholder="0.00" className={InputStyle} value={revAmount} onChange={e => setRevAmount(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Account</label>
                        <select required className={InputStyle} value={revMethod} onChange={e => setRevMethod(e.target.value)}>
                          <option value="" disabled>Select Source</option>
                          {accounts.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </div>
                      <button type="submit" disabled={isSubmitting} className="w-full py-3.5 md:py-4 mt-2 md:mt-4 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-white rounded-xl font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex justify-center items-center gap-2 disabled:opacity-50 text-sm md:text-base">
                        {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Add Funds
                      </button>
                    </form>
                  </GlassCard>
                </div>

                <div className="xl:col-span-2">
                  <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col h-[400px] md:h-[460px]">
                    <div className="p-4 md:p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 md:gap-4 shrink-0">
                      <div>
                        <h3 className="text-lg md:text-xl font-bold text-white">Revenue History</h3>
                        {revFilterType !== 'all' && (
                          <p className="text-xs md:text-sm font-medium text-cyan-400 mt-1">Filtered Total: ₹{filteredRevenueTotal.toLocaleString()}</p>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2 bg-slate-800/80 p-1 md:p-1.5 rounded-xl border border-white/10 w-full sm:w-auto">
                        <Filter size={16} className="text-slate-400 ml-3 hidden sm:block" />
                        <select className="bg-transparent text-xs md:text-sm text-slate-200 outline-none p-2 w-full sm:w-auto cursor-pointer" value={revFilterType} onChange={(e) => { setRevFilterType(e.target.value); setRevFilterValue(''); }}>
                          <option value="all" className="bg-slate-800">All Time</option>
                          <option value="month" className="bg-slate-800">By Month</option>
                          <option value="year" className="bg-slate-800">By Year</option>
                        </select>
                        {revFilterType !== 'all' && (
                          <input style={{colorScheme: 'dark'}} type={revFilterType === 'month' ? 'month' : 'number'} placeholder={revFilterType === 'year' ? 'YYYY' : ''} className="p-1.5 md:p-2 bg-slate-900/50 rounded-lg text-xs md:text-sm text-slate-200 outline-none w-full sm:w-32 border border-white/5" value={revFilterValue} onChange={e => setRevFilterValue(e.target.value)} />
                        )}
                        {revFilterValue && (
                          <button onClick={() => {setRevFilterType('all'); setRevFilterValue('');}} className="text-[10px] md:text-xs text-cyan-400 pr-2 md:pr-3 font-bold uppercase tracking-wider hover:text-cyan-300">Clear</button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto overflow-y-auto table-scroll revenue-scroll flex-1 relative w-full">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead className="sticky top-0 bg-[#0d1526] z-10 border-b border-white/5 shadow-sm">
                          <tr className="text-slate-300 text-[10px] md:text-xs uppercase tracking-widest font-bold">
                            <th className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap">Date</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 whitespace-nowrap">Account / Source</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">Amount Added</th>
                            <th className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredRevenues.map(t => (
                            <tr key={t.id} className="hover:bg-white/5 transition-colors group">
                              <td className="px-4 md:px-6 py-3 md:py-5 text-slate-400 text-xs md:text-sm font-medium whitespace-nowrap">
                                {t.date}
                                {t.isPending && <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase font-bold tracking-widest">Offline</span>}
                              </td>
                              <td className="px-4 md:px-6 py-3 md:py-5 font-semibold text-white flex items-center gap-3 text-sm md:text-base whitespace-nowrap">
                                <div className="p-1.5 md:p-2 bg-slate-800 rounded-lg border border-white/10"><CreditCard size={14} className="text-cyan-400"/></div>
                                {t.method}
                              </td>
                              <td className="px-4 md:px-6 py-3 md:py-5 text-right font-black text-emerald-400 text-sm md:text-base whitespace-nowrap">+₹{t.amount.toLocaleString()}</td>
                              <td className="px-4 md:px-6 py-3 md:py-5 text-right whitespace-nowrap">
                                <button onClick={() => handleDeleteTransaction(t.id, t.isPending)} className="p-1.5 md:p-2 text-slate-500 hover:text-rose-400 hover:bg-white/5 rounded-lg transition-all opacity-80 md:opacity-60 md:group-hover:opacity-100" title="Delete Revenue">
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filteredRevenues.length === 0 && (
                            <tr><td colSpan="4" className="p-8 text-center text-slate-500 font-medium">No records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- QR SYNC TAB --- */}
          {activeTab === 'sync' && (
            <div className="max-w-6xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-4">

              <GlassCard className="border-t-4 border-t-violet-500">
                <p className="text-slate-300 text-xs md:text-sm leading-relaxed">
                  Two things happen here. Use <span className="text-white font-bold">Generate QR (Phone)</span> on your phone to hand over
                  offline-added expenses/revenue to the laptop. Use <span className="text-white font-bold">Send Latest Data to Phone</span> on
                  the laptop to push the current DB data to your phone so it can be viewed offline. Both sides scan with
                  the same <span className="text-white font-bold">Scan &amp; Import</span> camera.
                </p>
              </GlassCard>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 items-start">

                {/* --- GENERATE PENDING ENTRIES --- */}
                <GlassCard className="border-t-4 border-t-amber-500">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 gap-3">
                    <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><QrCode size={22} className="text-amber-400"/> Generate QR (Phone)</h3>
                    {pendingSync.length > 0 && (
                      <span className="px-2 md:px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] md:text-xs font-bold whitespace-nowrap">
                        {pendingSync.length} entr{pendingSync.length === 1 ? 'y' : 'ies'} waiting
                      </span>
                    )}
                  </div>

                  {pendingSync.length === 0 ? (
                    <div className="text-center py-8 md:py-10">
                      <CheckCircle2 className="mx-auto text-emerald-400 mb-3" size={36} />
                      <p className="text-slate-400 font-medium text-xs md:text-sm">Nothing pending. Entries added while offline will appear here automatically.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 md:space-y-5">
                      <div className="flex justify-center bg-white p-4 md:p-5 rounded-2xl w-full">
                        <QRCodeSVG value={currentQrPayload} size={250} style={{ width: "100%", height: "auto", maxWidth: "300px" }} level="L" includeMargin={true} />
                      </div>

                      {qrChunks.length > 1 && (
                        <div className="flex items-center justify-between">
                          <button onClick={() => setChunkIndex(i => Math.max(0, i - 1))} disabled={chunkIndex === 0} className="p-2 md:p-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-all"><ChevronLeft size={18} /></button>
                          <span className="text-xs md:text-sm font-bold text-slate-300">Page {chunkIndex + 1} of {qrChunks.length}</span>
                          <button onClick={() => setChunkIndex(i => Math.min(qrChunks.length - 1, i + 1))} disabled={chunkIndex === qrChunks.length - 1} className="p-2 md:p-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-all"><ChevronRight size={18} /></button>
                        </div>
                      )}

                      <p className="text-[10px] md:text-xs text-slate-500 text-center">
                        {qrChunks.length > 1 ? 'Show each page to the laptop scanner one by one, in order.' : 'Show this to the laptop webcam scanner.'}
                      </p>

                      <button onClick={clearAllPendingSync} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs md:text-sm transition-all border border-white/5 flex items-center justify-center gap-2">
                        <Trash2 size={16} /> Mark as Synced & Clear
                      </button>
                    </div>
                  )}
                </GlassCard>

                {/* --- SCANNER --- */}
                <GlassCard className="border-t-4 border-t-cyan-500">
                  <div className="flex items-center justify-between mb-4 md:mb-6">
                    <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><Camera size={22} className="text-cyan-400"/> Scan &amp; Import</h3>
                    {!isOnline && (
                      <span className="px-2 md:px-3 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-[10px] md:text-xs font-bold">Backend offline</span>
                    )}
                  </div>

                  {!isScannerOpen ? (
                    <button onClick={startScanner} className="w-full py-3.5 md:py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white rounded-xl font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] flex justify-center items-center gap-2 text-sm md:text-base">
                      <Camera size={18} /> Start Camera Scanner
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div id={QR_SCANNER_ELEMENT_ID} className="w-full min-h-[250px] md:min-h-[300px] rounded-2xl overflow-hidden bg-black relative" /> 
                      <button onClick={stopScanner} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs md:text-sm transition-all border border-white/5">Stop Camera</button>
                    </div>
                  )}

                  {scanMessage && (
                    <p className="text-xs md:text-sm font-semibold text-slate-300 mt-4 text-center">{scanMessage}</p>
                  )}

                  {receivedChunkCount > 0 && (
                    <div className="mt-4 md:mt-5 p-3 md:p-4 bg-slate-900/60 border border-white/10 rounded-xl space-y-3">
                      <p className="text-xs md:text-sm text-slate-300">
                        Pending entries: <span className="font-bold text-white">{receivedChunkCount}</span>
                        {expectedChunkTotal ? ` of ${expectedChunkTotal}` : ''} page(s) — <span className="font-bold text-white">{receivedItemCount}</span> entries ready.
                      </p>
                      <button onClick={handleImportReceived} disabled={isImporting || !isOnline} className="w-full py-3 md:py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl font-bold text-xs md:text-sm transition-all shadow-[0_0_15px_rgba(16,185,129,0.4)] flex justify-center items-center gap-2 disabled:opacity-50">
                        {isImporting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {isImporting ? 'Importing…' : `Import to DB`}
                      </button>
                      {!isOnline && <p className="text-[10px] text-amber-400 text-center">Backend offline — connect to laptop network to import.</p>}
                    </div>
                  )}

                  {receivedSnapshotChunkCount > 0 && (
                    <div className="mt-4 md:mt-5 p-3 md:p-4 bg-slate-900/60 border border-white/10 rounded-xl space-y-3">
                      <p className="text-xs md:text-sm text-slate-300">
                        Snapshot: <span className="font-bold text-white">{receivedSnapshotChunkCount}</span>
                        {expectedSnapshotChunkTotal ? ` of ${expectedSnapshotChunkTotal}` : ''} page(s) — <span className="font-bold text-white">{receivedSnapshotItemCount}</span> entries ready.
                      </p>
                      <button onClick={handleSaveSnapshotLocally} disabled={!isSnapshotComplete} className="w-full py-3 md:py-3.5 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-white rounded-xl font-bold text-xs md:text-sm transition-all shadow-[0_0_15px_rgba(20,184,166,0.4)] flex justify-center items-center gap-2 disabled:opacity-50">
                        <RefreshCw size={16} /> Save for Offline Viewing
                      </button>
                      {!isSnapshotComplete && <p className="text-[10px] text-slate-500 text-center">Scan every page before saving.</p>}
                    </div>
                  )}
                </GlassCard>
              </div>

              {/* --- GENERATE SNAPSHOT --- */}
              <GlassCard className="border-t-4 border-t-teal-500">
                <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6 flex items-center gap-2">
                  <QrCode size={22} className="text-teal-400"/> Send Latest Data to Phone
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-slate-400 text-xs md:text-sm">No DB data yet to send.</p>
                ) : (
                  <div className="space-y-4 md:space-y-5 max-w-md mx-auto">
                    <div className="flex justify-center bg-white p-4 md:p-5 rounded-2xl w-full">
                      <QRCodeSVG value={currentSnapshotQrPayload} size={250} style={{ width: "100%", height: "auto", maxWidth: "300px" }} level="L" includeMargin={true} />
                    </div>
                    {snapshotChunks.length > 1 && (
                      <div className="flex items-center justify-between">
                        <button onClick={() => setSnapshotChunkIndex(i => Math.max(0, i - 1))} disabled={snapshotChunkIndex === 0} className="p-2 md:p-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-all"><ChevronLeft size={18} /></button>
                        <span className="text-xs md:text-sm font-bold text-slate-300">Page {snapshotChunkIndex + 1} of {snapshotChunks.length}</span>
                        <button onClick={() => setSnapshotChunkIndex(i => Math.min(snapshotChunks.length - 1, i + 1))} disabled={snapshotChunkIndex === snapshotChunks.length - 1} className="p-2 md:p-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-all"><ChevronRight size={18} /></button>
                      </div>
                    )}
                    <p className="text-[10px] md:text-xs text-slate-500 text-center">
                      {snapshotChunks.length > 1 ? 'Open QR Sync on your phone and scan each page in order.' : 'Scan this with your phone to update its offline copy.'}
                    </p>
                  </div>
                )}
              </GlassCard>
            </div>
          )}
        </div>
      </main>

      {/* --- ADD ACCOUNT MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-2 overflow-hidden relative">
            <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-slate-800/50">
              <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><CreditCard size={18} className="text-cyan-400"/> New Account Source</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-4 md:p-6 space-y-4 md:space-y-5">
              <div>
                <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Account Name</label>
                <input type="text" required placeholder="e.g. HDFC Bank, Binance Wallet" className={InputStyle} value={newAccName} onChange={e => setNewAccName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Total Amount (Initial Balance)</label>
                <input type="number" placeholder="0.00 (Optional)" className={InputStyle} value={newAccBal} onChange={e => setNewAccBal(e.target.value)} />
              </div>
              <div className="pt-2 md:pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 md:py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all border border-white/5 text-sm md:text-base">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 md:py-3.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:opacity-50 text-sm md:text-base">
                  {isSubmitting ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ADJUST BALANCE MODAL --- */}
      {adjustModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-2 overflow-hidden relative">
            <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-slate-800/50">
              <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                {adjustModal.mode === 'increase' ? <TrendingUp size={18} className="text-emerald-400" /> : <TrendingDown size={18} className="text-rose-400" />}
                {adjustModal.mode === 'increase' ? 'Increase' : 'Decrease'} — {adjustModal.account}
              </h3>
              <button onClick={() => { setAdjustModal(null); setAdjustAmount(''); }} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleAdjustBalance} className="p-4 md:p-6 space-y-4 md:space-y-5">
              <div>
                <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Amount (₹)</label>
                <input type="number" required autoFocus placeholder="0.00" className={InputStyle} value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
              </div>
              <div className="pt-2 md:pt-4 flex gap-3">
                <button type="button" onClick={() => { setAdjustModal(null); setAdjustAmount(''); }} className="flex-1 py-3 md:py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all border border-white/5 text-sm md:text-base">Cancel</button>
                <button type="submit" disabled={isSubmitting} className={`flex-1 py-3 md:py-3.5 text-white rounded-xl font-bold transition-all disabled:opacity-50 text-sm md:text-base ${adjustModal.mode === 'increase' ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]'}`}>
                  {isSubmitting ? 'Saving...' : adjustModal.mode === 'increase' ? 'Add Amount' : 'Deduct Amount'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}