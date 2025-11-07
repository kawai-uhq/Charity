import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { motion } from "framer-motion";
import Confetti from "react-confetti";
import jsPDF from "jspdf";
import { ethers } from "ethers";

/* ---------- tiny UI (no extra libs) ---------- */
const Button = ({ children, className="", variant="default", ...props }) => {
  const base = "inline-flex items-center justify-center px-3 py-2 rounded-xl text-sm transition shadow-sm";
  const styles = variant==="secondary"
    ? "bg-gray-100 hover:bg-gray-200 text-gray-800"
    : "bg-black text-white hover:bg-gray-800";
  return <button className={`${base} ${styles} ${className}`} {...props}>{children}</button>;
};
const Card = ({ children, className="" }) => (<div className={`rounded-2xl border bg-white ${className}`}>{children}</div>);
const CardContent = ({ children, className="" }) => (<div className={`p-6 ${className}`}>{children}</div>);
const Input = ({ className="", ...props }) => (<input className={`border rounded-lg px-3 py-2 text-sm outline-none focus:ring w-full ${className}`} {...props} />);
const Label = ({ children }) => <label className="text-sm text-gray-700">{children}</label>;
const Select = ({ value, onChange, children, className="" }) => (
  <select className={`border rounded-lg px-3 py-2 text-sm w-full ${className}`} value={value} onChange={(e)=>onChange(e.target.value)}>
    {children}
  </select>
);
const SelectItem = ({ children, value }) => <option value={value}>{children}</option>;

/* ---------- Project Aniko: donation addresses ---------- */
const DONATION_WALLETS = {
  "1":   "0x111a60e587C811A05e13c3a26dC02A456Ad4D23e", // Ethereum
  "137": "0x111a60e587C811A05e13c3a26dC02A456Ad4D23e", // Polygon
  "42161":"0x111a60e587C811A05e13c3a26dC02A456Ad4D23e", // Arbitrum
  "56":  "0x111a60e587C811A05e13c3a26dC02A456Ad4D23e", // BSC
};
// Non-EVM
const BTC_ADDRESS  = "bc1q995w9gqc8ae67v7yy8qj9r980vapwvp28wkagx";
const LTC_ADDRESS  = "LahEALVAF3g3UE61D5ikfoXMoHRfy6tojX";
const SOL_ADDRESS  = "HzGvnMAFTLtC574b6bQ5XegFVmdP38kgQqqDK54mLx9z";
const TRON_ADDRESS = "TCEGeAxcpxdj7Q5hzxD1sEVTB8xxktqGT5";

/* ---------- ERC-20 contracts ---------- */
const USDC_ADDRESSES = {
  "1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "137":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "42161":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "56":"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};
const USDT_ADDRESSES = {
  "1":"0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "137":"0xC2132D05D31c914a87C6611C10748AEB04B58e8F",
  "42161":"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "56":"0x55d398326f99059fF775485246999027B3197955",
};

/* ---------- chains & tokens ---------- */
const CHAINS = {
  "1":   { name: "Ethereum",        nativeSymbol: "ETH",  explorer:"https://etherscan.io",     rpc:"https://cloudflare-eth.com" },
  "137": { name: "Polygon",         nativeSymbol: "MATIC", explorer:"https://polygonscan.com", rpc:"https://polygon-rpc.com" },
  "42161":{name: "Arbitrum",        nativeSymbol: "ETH",  explorer:"https://arbiscan.io",      rpc:"https://arb1.arbitrum.io/rpc" },
  "56":  { name: "BNB Smart Chain", nativeSymbol: "BNB",  explorer:"https://bscscan.com",      rpc:"https://bsc-dataseed.binance.org" },
};
const TOKEN_OPTIONS = [
  { id:"NATIVE", label:(chainId)=>CHAINS[chainId]?.nativeSymbol || "Native" },
  { id:"USDC", label:()=> "USDC" },
  { id:"USDT", label:()=> "USDT" },
];

/* ---------- prices (USD) ---------- */
const PRICE_IDS = {
  ETH:'ethereum', USDT:'tether', USDC:'usd-coin',
  BTC:'bitcoin', LTC:'litecoin', SOL:'solana', TRX:'tron',
  BNB:'binancecoin', MATIC:'polygon-pos', ARB:'arbitrum'
};
function normToken(sym){
  const s=(sym||"").toUpperCase();
  if (s.includes("TRX/USDT")) return "USDT";
  if (s.includes("USDT")) return "USDT";
  if (s.includes("TRX")) return "TRX";
  return PRICE_IDS[s]? s : null;
}

export default function App(){
  const [chainId, setChainId] = useState("1");
  const [token, setToken] = useState("NATIVE");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [txStatus, setTxStatus] = useState({ state:"idle", hash:"", message:"" });

  const [donorName, setDonorName] = useState("");
  const [thankOpen, setThankOpen] = useState(false);

  const [prices, setPrices] = useState({});
  const [refreshBoard, setRefreshBoard] = useState(0);

  // EVM manual watch
  const [evmWatchState, setEvmWatchState] = useState("idle");
  const [evmWatchError, setEvmWatchError] = useState(null);
  const [evmWatchWhat, setEvmWatchWhat] = useState(null);
  const evmPollRef = useRef(null);
  const [evmBaseEth, setEvmBaseEth] = useState(null);
  const [evmBaseUsdc, setEvmBaseUsdc] = useState(null);
  const [evmBaseUsdt, setEvmBaseUsdt] = useState(null);

  // Non-EVM watchers
  const [btcState,setBtcState]=useState("idle"); const [btcErr,setBtcErr]=useState(null); const [btcLast,setBtcLast]=useState(null); const btcRef=useRef(null);
  const [ltcState,setLtcState]=useState("idle"); const [ltcErr,setLtcErr]=useState(null); const [ltcLast,setLtcLast]=useState(null); const ltcRef=useRef(null);
  const [solState,setSolState]=useState("idle"); const [solErr,setSolErr]=useState(null); const [solLast,setSolLast]=useState(null); const solRef=useRef(null);
  const [tronState,setTronState]=useState("idle"); const [tronErr,setTronErr]=useState(null); const [tronLast,setTronLast]=useState(null); const tronRef=useRef(null);

  const donationAddress = useMemo(()=> DONATION_WALLETS[chainId] || "", [chainId]);
  const tokenLabel = useMemo(()=>{
    const opt = TOKEN_OPTIONS.find(o=>o.id===token);
    return typeof opt.label==="function"? opt.label(chainId) : opt.label();
  },[token,chainId]);

  /* prices */
  function priceUsdForToken(sym){
    const key = normToken(sym);
    if (!key) return null;
    return prices[key] ?? null;
  }
  async function refreshPrices(){
    try{
      const ids = Array.from(new Set(Object.values(PRICE_IDS))).join(",");
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {cache:"no-store"});
      if (!r.ok) return;
      const j = await r.json();
      const out = {};
      for (const [sym,id] of Object.entries(PRICE_IDS)){
        const usd = j?.[id]?.usd;
        if (typeof usd==="number") out[sym]=usd;
      }
      setPrices(out);
      localStorage.setItem("prices_usd", JSON.stringify({ts:Date.now(), prices:out}));
    }catch(e){}
  }
  useEffect(()=>{
    try{
      const raw = JSON.parse(localStorage.getItem("prices_usd")||"null");
      if (raw?.prices) setPrices(raw.prices);
    }catch{}
    refreshPrices();
    const id = window.setInterval(refreshPrices, 60000);
    return ()=>clearInterval(id);
  },[]);

  /* wallet init */
  useEffect(()=>{
    const eth = window.ethereum;
    if (!eth) return;
    const onAccounts = (a)=>setAccount(a?.[0]||null);
    const onChain = (hex)=>setChainId(parseInt(hex,16).toString());
    eth.request?.({method:"eth_accounts"}).then(a=>setAccount(a?.[0]||null)).catch(()=>{});
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return ()=>{
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  },[]);

  /* record donation with USD snapshot */
  function recordDonation(entry){
    try{
      const prev = JSON.parse(localStorage.getItem("donations")||"[]");
      const list = Array.isArray(prev)? prev: [];
      const price = priceUsdForToken(entry.token);
      const usd = (typeof price==="number" && typeof entry.amount==="number") ? Number((entry.amount*price).toFixed(2)) : null;
      const withTs = {...entry, usd, ts: Date.now()};
      list.push(withTs);
      localStorage.setItem("donations", JSON.stringify(list));
      localStorage.setItem("lastDonation", JSON.stringify(withTs));
    }catch(e){}
  }

  /* thank you trigger */
  useEffect(()=>{
    const any = txStatus.state==="success" || btcState==="confirmed" || ltcState==="confirmed" || solState==="confirmed" || tronState==="confirmed" || evmWatchState==="confirmed";
    if (any) setThankOpen(true);
  },[txStatus.state, btcState, ltcState, solState, tronState, evmWatchState]);

  /* helpers */
  function getEvmProvider(id){
    const url = CHAINS[id]?.rpc;
    if (url) return new ethers.JsonRpcProvider(url);
    if (window.ethereum) return new ethers.BrowserProvider(window.ethereum);
    throw new Error("No RPC available");
  }
  async function erc20Balance(provider, tokenAddress, who){
    const erc20 = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
    return await erc20.balanceOf(who);
  }

  async function connectWallet(){
    if (!window.ethereum) { alert("Install MetaMask"); return; }
    try{
      setIsConnecting(true);
      const accts = await window.ethereum.request({method:"eth_requestAccounts"});
      setAccount(accts?.[0]||null);
      const hex = await window.ethereum.request({method:"eth_chainId"});
      setChainId(parseInt(hex,16).toString());
    } finally { setIsConnecting(false); }
  }
  async function ensureNetwork(targetId){
    if (!window.ethereum) return;
    const hex = "0x"+parseInt(targetId).toString(16);
    await window.ethereum.request({method:"wallet_switchEthereumChain", params:[{chainId:hex}]});
  }

  async function donate(){
    setTxStatus({state:"idle"});
    const value = parseFloat(amount);
    if (!donationAddress) return setTxStatus({state:"error", message:"Missing donation address"});
    if (!amount || isNaN(value) || value<=0) return setTxStatus({state:"error", message:"Enter a valid amount"});
    if (!window.ethereum) return setTxStatus({state:"error", message:"No wallet found"});

    try{
      await ensureNetwork(chainId);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      setTxStatus({state:"pending"});
      let txHash="";
      if (token==="NATIVE"){
        const tx = await signer.sendTransaction({to: donationAddress, value: ethers.parseEther(value.toString())});
        await tx.wait(); txHash=tx.hash;
      } else {
        const addrMap = token==="USDC"? USDC_ADDRESSES: USDT_ADDRESSES;
        const contract = new ethers.Contract(addrMap[chainId], [
          "function transfer(address to, uint256 amount) returns (bool)",
          "function decimals() view returns (uint8)"
        ], signer);
        const decimals = await contract.decimals();
        const amt = ethers.parseUnits(value.toString(), decimals);
        const tx = await contract.transfer(donationAddress, amt);
        await tx.wait(); txHash=tx.hash;
      }
      setTxStatus({state:"success", hash: txHash});
      recordDonation({
        name: donorName || (account? `${account.slice(0,6)}…${account.slice(-4)}`: "Anonymous"),
        token: token==="NATIVE"? CHAINS[chainId].nativeSymbol : token,
        chain: CHAINS[chainId].name,
        amount: value,
        txHash,
        method: "wallet",
      });
      setRefreshBoard(x=>x+1);
    }catch(e){
      setTxStatus({state:"error", message: e?.message || "Transaction failed"});
    }
  }

/* --------- EVM manual watchers (balance bump) --------- */
  function startEvmEthWatch(amountSent){
    if (!donationAddress){ setEvmWatchError("Missing address"); setEvmWatchState("error"); return; }
    setEvmWatchWhat("ETH");
    const provider = getEvmProvider(chainId);
    setEvmWatchState("watching");
    (async()=> setEvmBaseEth(await provider.getBalance(donationAddress)))();
    if (evmPollRef.current) clearInterval(evmPollRef.current);
    let tries=0;
    evmPollRef.current = setInterval(async ()=>{
      tries++;
      try{
        const cur = await provider.getBalance(donationAddress);
        if (evmBaseEth!==null && cur>evmBaseEth){
          setEvmWatchState("confirmed"); clearInterval(evmPollRef.current);
          recordDonation({ name: donorName||"Anonymous", token: CHAINS[chainId].nativeSymbol, chain: CHAINS[chainId].name, amount: amountSent||0, txHash:"", method:"manual" });
          setRefreshBoard(x=>x+1);
        } else if (tries>30){ setEvmWatchState("error"); setEvmWatchError("Couldn’t auto-detect yet. Thank you!"); clearInterval(evmPollRef.current); }
      }catch{}
    }, 12000);
  }
  function startEvmErc20Watch(sym, amountSent){
    if (!donationAddress){ setEvmWatchError("Missing address"); setEvmWatchState("error"); return; }
    setEvmWatchWhat(sym);
    const provider = getEvmProvider(chainId);
    const addrMap = sym==="USDC" ? USDC_ADDRESSES : USDT_ADDRESSES;
    const tokenAddr = addrMap[chainId];
    if (!tokenAddr){ setEvmWatchState("error"); setEvmWatchError(`${sym} not supported on this chain`); return; }
    setEvmWatchState("watching");
    (async()=>{ 
      const base = await erc20Balance(provider, tokenAddr, donationAddress);
      if (sym==="USDC") setEvmBaseUsdc(base); else setEvmBaseUsdt(base);
    })();
    if (evmPollRef.current) clearInterval(evmPollRef.current);
    let tries=0;
    evmPollRef.current = setInterval(async ()=>{
      tries++;
      try{
        const cur = await erc20Balance(provider, tokenAddr, donationAddress);
        const base = sym==="USDC" ? evmBaseUsdc : evmBaseUsdt;
        if (base!==null && cur>base){
          setEvmWatchState("confirmed"); clearInterval(evmPollRef.current);
          recordDonation({ name: donorName||"Anonymous", token: sym, chain: CHAINS[chainId].name, amount: amountSent||0, txHash:"", method:"manual" });
          setRefreshBoard(x=>x+1);
        } else if (tries>30){ setEvmWatchState("error"); setEvmWatchError("Couldn’t auto-detect yet. Thank you!"); clearInterval(evmPollRef.current); }
      }catch{}
    }, 12000);
  }

  /* --------- Non-EVM pollers (BTC, LTC, SOL, TRON) --------- */
  async function fetchLatestTx_Blockchair(coin,address){
    try{
      const r = await fetch(`https://api.blockchair.com/${coin}/dashboards/address/${address}?limit=1`, {cache:"no-store"});
      if (r.ok){ const j=await r.json(); const txs=j?.data?.[address]?.transactions; return Array.isArray(txs)&&txs.length? txs[0]: null; }
    }catch{}
    return null;
  }
  async function fetchLatestBtcTx(a){
    try{
      const r = await fetch(`https://blockstream.info/api/address/${a}/txs`, {cache:"no-store"});
      if (r.ok){ const arr=await r.json(); return Array.isArray(arr)&&arr.length? (arr[0]?.txid || null): null; }
    }catch{}
    return fetchLatestTx_Blockchair("bitcoin", a);
  }
  async function fetchLatestLtcTx(a){
    try{
      const r = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${a}/full?limit=1`, {cache:"no-store"});
      if (r.ok){ const j=await r.json(); const h=j?.txs?.[0]?.hash||null; if (h) return h; }
    }catch{}
    return fetchLatestTx_Blockchair("litecoin", a);
  }
  async function fetchLatestSolSig(a){
    try{
      const r = await fetch("https://api.mainnet-beta.solana.com", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({jsonrpc:"2.0", id:1, method:"getSignaturesForAddress", params:[a,{limit:1}]})
      });
      if (r.ok){ const j=await r.json(); return j?.result?.[0]?.signature || null; }
    }catch{}
    return null;
  }
  async function fetchLatestTronTx(a){
    const urls = [
      `https://apilist.tronscanapi.com/api/transaction?address=${a}&sort=-timestamp&limit=1`,
      `https://apilist.tronscan.org/api/transaction?address=${a}&sort=-timestamp&limit=1`,
    ];
    for (const u of urls){
      try{
        const r = await fetch(u,{cache:"no-store"});
        if (r.ok){ const j=await r.json(); const h=j?.data?.[0]?.hash || j?.data?.[0]?.txID || null; if (h) return h; }
      }catch{}
    }
    return null;
  }

  // set baselines on mount + cleanup
  useEffect(()=>{
    (async ()=>{
      if (BTC_ADDRESS) setBtcLast(await fetchLatestBtcTx(BTC_ADDRESS));
      if (LTC_ADDRESS) setLtcLast(await fetchLatestLtcTx(LTC_ADDRESS));
      if (SOL_ADDRESS) setSolLast(await fetchLatestSolSig(SOL_ADDRESS));
      if (TRON_ADDRESS) setTronLast(await fetchLatestTronTx(TRON_ADDRESS));
    })();
    return ()=> {
      [btcRef, ltcRef, solRef, tronRef, evmPollRef].forEach(ref=>{
        if (ref.current) clearInterval(ref.current);
      });
    };
  },[]);

  function startWatcher({getLatest, getBaseline, setState, setError, ref, onConfirm}){
    setError?.(null);
    setState("watching");
    let tries=0;
    if (ref.current) clearInterval(ref.current);
    ref.current = setInterval(async ()=>{
      tries++;
      try{
        const cur = await getLatest();
        const base = getBaseline();
        if (cur && cur!==base){
          setState("confirmed"); clearInterval(ref.current);
          onConfirm?.(cur);
        } else if (tries>30){ setState("error"); setError?.("We couldn't auto-detect yet. Thank you!"); clearInterval(ref.current); }
      }catch{}
    }, 12000);
  }

  function startBtcWatch(amountSent){
    if (!BTC_ADDRESS){ setBtcErr("No BTC address configured."); setBtcState("error"); return; }
    startWatcher({
      getLatest:()=>fetchLatestBtcTx(BTC_ADDRESS),
      getBaseline:()=>btcLast,
      setState:setBtcState, setError:setBtcErr, ref: btcRef,
      onConfirm:(txid)=>{ recordDonation({name: donorName||"Anonymous", token:"BTC", chain:"Bitcoin", amount: amountSent||0, txHash: txid, method:"manual"}); setRefreshBoard(x=>x+1); }
    });
  }
  function startLtcWatch(amountSent){
    if (!LTC_ADDRESS){ setLtcErr("No LTC address configured."); setLtcState("error"); return; }
    startWatcher({
      getLatest:()=>fetchLatestLtcTx(LTC_ADDRESS),
      getBaseline:()=>ltcLast,
      setState:setLtcState, setError:setLtcErr, ref: ltcRef,
      onConfirm:(txid)=>{ recordDonation({name: donorName||"Anonymous", token:"LTC", chain:"Litecoin", amount: amountSent||0, txHash: txid, method:"manual"}); setRefreshBoard(x=>x+1); }
    });
  }
  function startSolWatch(amountSent){
    if (!SOL_ADDRESS){ setSolErr("No SOL address configured."); setSolState("error"); return; }
    startWatcher({
      getLatest:()=>fetchLatestSolSig(SOL_ADDRESS),
      getBaseline:()=>solLast,
      setState:setSolState, setError:setSolErr, ref: solRef,
      onConfirm:(sig)=>{ recordDonation({name: donorName||"Anonymous", token:"SOL", chain:"Solana", amount: amountSent||0, txHash: sig, method:"manual"}); setRefreshBoard(x=>x+1); }
    });
  }
  function startTronWatch(amountSent){
    if (!TRON_ADDRESS){ setTronErr("No TRON address configured."); setTronState("error"); return; }
    startWatcher({
      getLatest:()=>fetchLatestTronTx(TRON_ADDRESS),
      getBaseline:()=>tronLast,
      setState:setTronState, setError:setTronErr, ref: tronRef,
      onConfirm:(txid)=>{ recordDonation({name: donorName||"Anonymous", token:"TRX/USDT", chain:"Tron", amount: amountSent||0, txHash: txid, method:"manual"}); setRefreshBoard(x=>x+1); }
    });
                                            }

/* explorer URL (for wallet-initiated tx) */
  const explorerTxUrl = (hash)=>{
    if (!hash) return "#";
    const ex = CHAINS[chainId]?.explorer; return ex? `${ex}/tx/${hash}`: `https://etherscan.io/tx/${hash}`;
  };

  /* receipt PDF */
  function downloadReceipt(){
    try{
      const raw = localStorage.getItem("lastDonation");
      const d = raw? JSON.parse(raw): null;
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text("Project Aniko — Donation Receipt", 20,20);
      doc.setFontSize(11);
      const pricesRaw = JSON.parse(localStorage.getItem("prices_usd")||"null");
      const pmap = pricesRaw?.prices || {};
      const sym = (d?.token||"").toUpperCase();
      const key = sym.includes("USDT")? "USDT" : (sym.includes("TRX")? "TRX" : sym);
      const price = pmap?.[key];
      const usdLine = d?.usd ? `USD Approx: $${Number(d.usd).toFixed(2)}` : (price? `USD Approx: $${(Number(d?.amount||0)*price).toFixed(2)}` : "USD Approx: N/A");
      const lines = [
        `Date: ${new Date().toLocaleString()}`,
        `Donor: ${d?.name || "Anonymous"}`,
        `Network: ${d?.chain || ""}`,
        `Token: ${d?.token || ""}`,
        `Amount: ${d?.amount || ""}`,
        usdLine,
        d?.txHash ? `Tx: ${d.txHash}` : `Tx: (manual send)`,
        `To: Project Aniko Wallet`,
      ];
      lines.forEach((t,i)=> doc.text(t,20,40+i*8));
      doc.text("Thank you for your generosity!", 20, 40+lines.length*8+10);
      doc.save("donation-receipt.pdf");
    }catch(e){}
  }

  /* leaderboard */
  function LeaderboardCard(){
    const [mode, setMode] = useState("USD"); // USD by default
    const [tok, setTok] = useState("ETH");
    const [limit, setLimit] = useState(10);
    const [rows, setRows] = useState([]);

    useEffect(()=>{
      try{
        const raw = JSON.parse(localStorage.getItem("donations")||"[]");
        const list = Array.isArray(raw)? raw: [];
        const map = new Map();
        if (mode==="USD"){
          list.forEach(d=>{
            const k = d?.name || "Anonymous";
            const v = Number(d?.usd ?? 0);
            map.set(k, (map.get(k)||0) + (isFinite(v)? v: 0));
          });
        } else {
          list.filter(d => (d?.token||"").toUpperCase()===tok.toUpperCase()).forEach(d=>{
            const k = d?.name || "Anonymous";
            map.set(k, (map.get(k)||0)+ Number(d?.amount||0));
          });
        }
        const arr = Array.from(map.entries()).map(([name,total])=>({name, total})).sort((a,b)=>b.total-a.total).slice(0, limit);
        setRows(arr);
      } catch { setRows([]); }
    }, [mode, tok, limit, refreshBoard]);

    return (
      <Card className="shadow-sm rounded-2xl md:col-span-2">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Top Donors — Project Aniko</h2>
            <div className="flex items-center gap-2">
              <Select value={mode} onChange={v=>setMode(v)}>
                <SelectItem value="USD">By USD (all tokens)</SelectItem>
                <SelectItem value="TOKEN">By Token</SelectItem>
              </Select>
              {mode==="TOKEN" && (
                <Select value={tok} onChange={v=>setTok(v)}>
                  {["ETH","USDC","USDT","BNB","MATIC","ARB","BTC","LTC","SOL","TRX/USDT"].map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}
                </Select>
              )}
              <Select value={String(limit)} onChange={v=>setLimit(Number(v))}>
                {[5,10].map(n=> <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}
              </Select>
            </div>
          </div>
          <div className="rounded-xl border overflow-hidden">
            <div className="grid grid-cols-2 text-xs uppercase text-gray-500 bg-gray-50 px-4 py-2">
              <div>Name</div>
              <div className="text-right">{mode==="USD"? "Total USD ($)" : `Total ${tok}`}</div>
            </div>
            {rows.length===0 && <div className="px-4 py-6 text-sm text-gray-500">No donations yet.</div>}
            {rows.map((r,i)=>(
              <div key={r.name+String(i)} className="grid grid-cols-2 px-4 py-2 border-t">
                <div className="flex items-center gap-2"><div className="text-xs text-gray-500">#{i+1}</div><div>{r.name}</div></div>
                <div className="text-right font-medium">{mode==="USD"? `$${r.total.toFixed(2)}` : r.total}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  /* shared non-EVM watch card */
  function WatchCard({ title, address, state, error, onStart, subtitle, networkLabel }) {
    const [amt, setAmt] = useState("");
    return (
      <Card className="shadow-sm rounded-2xl md:col-span-2">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-gray-600">{subtitle}</p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="flex flex-col items-center justify-center gap-3 border rounded-xl p-4">
              <QRCodeCanvas value={address || ""} size={160} includeMargin />
              <div className="text-xs text-gray-600">{networkLabel} Receiving Address</div>
              <div className="font-mono text-xs break-all text-center">{address || "(add your address)"}</div>
            </div>
            <div className="md:col-span-2 flex flex-col gap-3">
              <div className="p-3 rounded-lg bg-gray-50">
                <div className="font-semibold mb-1">How it works</div>
                <ul className="list-disc pl-5 space-y-1 text-gray-700">
                  <li>Enter your amount and click <span className="font-semibold">“I sent it”</span> after transfer.</li>
                  <li>We auto-detect a new on-chain transaction to our address.</li>
                  <li>Once detected you’ll see a big ❤️ Thank You confirmation.</li>
                </ul>
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="grid gap-1">
                  <Label>Amount sent</Label>
                  <Input value={amt} onChange={(e)=>setAmt(e.target.value)} placeholder="e.g. 0.1" type="number" />
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <Button onClick={()=>onStart(parseFloat(amt)||undefined)} disabled={!address || state === "watching"}>
                    {state === "watching" ? "Checking…" : "I sent it"}
                  </Button>
                  {state === "confirmed" && (<div className="text-emerald-700 text-sm">✅ Thank you! Donation detected.</div>)}
                  {state === "error" && (<div className="text-red-600 text-sm">⚠ {error}</div>)}
                </div>
              </div>
              {state === "watching" && (<div className="text-xs text-gray-600">This may take a few minutes depending on network conditions.</div>)}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* thank you modal */
  function ThankYouModal({ onClose }){
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <Confetti numberOfPieces={320} recycle={false} />
        <motion.div initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} className="relative z-10 w-[92vw] max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="text-center space-y-3">
            <div className="text-3xl font-semibold">❤️ Thank You!</div>
            <p className="text-gray-700">Your gift to <span className="font-semibold">Project Aniko</span> makes a real impact.</p>
            <div className="pt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={downloadReceipt}>Download receipt (PDF)</Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
               }

/* -------------------- UI -------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <header className="max-w-4xl mx-auto px-6 py-10 flex items-center justify-between">
        <motion.h1 initial={{opacity:0, y:-6}} animate={{opacity:1, y:0}} className="text-3xl md:text-4xl font-semibold tracking-tight">
          Project Aniko ♡
        </motion.h1>
        <div className="flex items-center gap-3">
          <Input className="w-44" placeholder="Your name (optional)" value={donorName} onChange={(e)=>setDonorName(e.target.value)} />
          {account && <span className="text-sm text-gray-600 font-mono">{account.slice(0,6)}…{account.slice(-4)}</span>}
          <Button onClick={connectWallet} disabled={isConnecting}>{account? "Wallet" : (isConnecting? "…" : "Connect")}</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 grid md:grid-cols-2 gap-6 pb-16">
        {/* EVM donation card */}
        <Card className="shadow-sm rounded-2xl">
          <CardContent className="p-6 space-y-5">
            <h2 className="text-xl font-semibold">Make an EVM Donation</h2>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Network</Label>
                <Select value={chainId} onChange={setChainId}>
                  {Object.entries(CHAINS).map(([id,meta])=> <SelectItem key={id} value={id}>{meta.name}</SelectItem>)}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Token</Label>
                <Select value={token} onChange={setToken}>
                  {TOKEN_OPTIONS.map(t => <SelectItem key={t.id} value={t.id}>{t.label(chainId)}</SelectItem>)}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Amount ({tokenLabel})</Label>
                <Input type="number" placeholder={`e.g. 10 ${tokenLabel}`} value={amount} onChange={(e)=>setAmount(e.target.value)} />
                <div className="text-xs text-gray-600">
                  {(() => {
                    const p = priceUsdForToken(token==="NATIVE"? CHAINS[chainId].nativeSymbol : token);
                    const v = parseFloat(amount||"0");
                    if (!p || !v) return null;
                    return `≈ $${(p*v).toFixed(2)} USD`;
                  })()}
                </div>
              </div>
              <Button onClick={donate} className="w-full h-11 text-base">Donate {amount? amount:""} {tokenLabel}</Button>
              {txStatus.state==="pending" && <div className="text-amber-600 text-sm">Confirm the transaction in your wallet…</div>}
              {txStatus.state==="success" && <div className="text-emerald-600 text-sm">✅ Donation sent! <a className="underline" href={explorerTxUrl(txStatus.hash)} target="_blank" rel="noreferrer">View</a></div>}
              {txStatus.state==="error" && <div className="text-red-600 text-sm">⚠ {txStatus.message}</div>}
            </div>
          </CardContent>
        </Card>

        {/* Manual EVM */}
        <Card className="shadow-sm rounded-2xl">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">Manual EVM (No wallet popup)</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex flex-col items-center justify-center gap-3 border rounded-xl p-4">
                <QRCodeCanvas value={donationAddress||""} size={160} includeMargin />
                <div className="text-xs text-gray-600">{CHAINS[chainId]?.name} Receiving Address</div>
                <div className="font-mono text-xs break-all text-center">{donationAddress}</div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="p-3 rounded-lg bg-gray-50">
                  <div className="font-semibold mb-1">After sending</div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-1">
                      <Label>Amount sent</Label>
                      <Input id="manualAmt" type="number" placeholder="e.g. 10" />
                    </div>
                    <Button onClick={()=>startEvmEthWatch(parseFloat(document.getElementById('manualAmt').value)||undefined)}>I sent ETH</Button>
                    <Button variant="secondary" onClick={()=>startEvmErc20Watch("USDC", parseFloat(document.getElementById('manualAmt').value)||undefined)}>I sent USDC</Button>
                    <Button variant="secondary" onClick={()=>startEvmErc20Watch("USDT", parseFloat(document.getElementById('manualAmt').value)||undefined)}>I sent USDT</Button>
                  </div>
                </div>
                {evmWatchState==="watching" && <div className="text-amber-600 text-sm">Checking for {evmWatchWhat||"payment"}…</div>}
                {evmWatchState==="confirmed" && <div className="text-emerald-700 text-sm">✅ Thank you! Your {evmWatchWhat} donation was detected.</div>}
                {evmWatchState==="error" && <div className="text-red-600 text-sm">⚠ {evmWatchError}</div>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* BTC */}
        <WatchCard
          title="Donate with Bitcoin (BTC)"
          address={BTC_ADDRESS}
          state={btcState}
          error={btcErr}
          onStart={(amt)=>startBtcWatch(amt)}
          subtitle="We poll Blockstream/Blockchair for your BTC payment."
          networkLabel="Bitcoin"
        />

        {/* LTC */}
        <WatchCard
          title="Donate with Litecoin (LTC)"
          address={LTC_ADDRESS}
          state={ltcState}
          error={ltcErr}
          onStart={(amt)=>startLtcWatch(amt)}
          subtitle="We poll BlockCypher/Blockchair for your LTC payment."
          networkLabel="Litecoin"
        />

        {/* SOL */}
        <WatchCard
          title="Donate with Solana (SOL)"
          address={SOL_ADDRESS}
          state={solState}
          error={solErr}
          onStart={(amt)=>startSolWatch(amt)}
          subtitle="We poll Solana RPC for new signatures."
          networkLabel="Solana"
        />

        {/* TRON */}
        <WatchCard
          title="Donate with Tron (TRX / TRC20 USDT)"
          address={TRON_ADDRESS}
          state={tronState}
          error={tronErr}
          onStart={(amt)=>startTronWatch(amt)}
          subtitle="We poll TRONSCAN for new transactions."
          networkLabel="Tron"
        />

        <LeaderboardCard />
      </main>

      {thankOpen && <ThankYouModal onClose={()=>setThankOpen(false)} />}
    </div>
  );
}
