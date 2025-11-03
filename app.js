const params = new URLSearchParams(location.search);
const lojistaId = params.get('lojista') || 'default-lojista';
const storagePrefix = 'pdv_local_'; 
const cfgKey = storagePrefix + 'cfg_' + lojistaId;
const histKey = storagePrefix + 'hist_' + lojistaId;

const cfgModal = document.getElementById('configModal');
const openConfig = document.getElementById('openConfig');
const closeConfig = document.getElementById('closeConfig');
const saveConfig = document.getElementById('saveConfig');
const clearConfig = document.getElementById('clearConfig');

const cfgName = document.getElementById('cfgName');
const cfgBtcAddress = document.getElementById('cfgBtcAddress');
const cfgUsdtAddress = document.getElementById('cfgUsdtAddress');
const cfgWebhook = document.getElementById('cfgWebhook');
const cfgPin = document.getElementById('cfgPin');

const lojistaNameEl = document.getElementById('lojistaName');
const amountUSD = document.getElementById('amountUSD');
const usdtNetwork = document.getElementById('usdtNetwork');
const generateBtn = document.getElementById('generate');
const qrcodeImg = document.getElementById('qrcodeImg');
const btcUri = document.getElementById('btcUri');
const statusEl = document.getElementById('status');
const usdtMsg = document.getElementById('usdtMsg');
const historyBody = document.getElementById('historyBody');
const lastInfo = document.getElementById('lastInfo');
const txInfo = document.getElementById('txInfo');
const forceCheck = document.getElementById('forceCheck');

let cfg = loadConfig();
let history = loadHistory();
let currentPayment = null;
let monitorInterval = null;

lojistaNameEl.textContent = cfg?.name || lojistaId;
renderHistory();
populateConfigUI();

// Config modal
openConfig.addEventListener('click', () => {
  const storedPin = cfg?.pin;
  if (storedPin) {
    const input = prompt('Digite o PIN local do lojista para abrir configurações:');
    if (!input || input !== storedPin) return alert('PIN incorreto.');
  }
  cfgModal.style.display='block';
});
closeConfig.addEventListener('click', ()=> cfgModal.style.display='none');
saveConfig.addEventListener('click', () => {
  const name = cfgName.value.trim() || lojistaId;
  const btc = cfgBtcAddress.value.trim();
  const usdt = cfgUsdtAddress.value.trim();
  const webhook = cfgWebhook.value.trim();
  const pin = cfgPin.value.trim();
  cfg = { name, btc, usdt, webhook, pin };
  localStorage.setItem(cfgKey, JSON.stringify(cfg));
  cfgModal.style.display='none';
  populateConfigUI();
});
clearConfig.addEventListener('click', () => {
  if (!confirm('Remover configuração local do lojista?')) return;
  localStorage.removeItem(cfgKey);
  cfg = {};
  populateConfigUI();
});

generateBtn.addEventListener('click', async () => {
  if (!cfg || !cfg.btc) return alert('Configure o endereço BTC do lojista.');
  const usd = parseFloat(amountUSD.value);
  if (!usd || usd <= 0) return alert('Digite um valor em USD válido.');

  const btcPrice = await getBTCPriceUSD();
  const amountBTC = (usd / btcPrice).toFixed(8);

  const id = Date.now().toString();
  const btcAddress = cfg.btc;
  const paymentURI = `bitcoin:${btcAddress}?amount=${amountBTC}`;

  const url = await QRCode.toDataURL(paymentURI, { width: 600 });
  qrcodeImg.src = url;
  btcUri.value = paymentURI;

  statusEl.textContent = 'Aguardando pagamento on-chain...';
  usdtMsg.textContent = '';

  currentPayment = { id, usd, amountBTC, btcAddress, status: 'pending', timestamp: Date.now(), txid: null, usdtNetwork: usdtNetwork.value, usdtDestination: cfg.usdt || '' };
  history.unshift(currentPayment);
  saveHistory();
  renderHistory();
  lastInfo.textContent = `ID ${id} — ${usd} USD ≈ ${amountBTC} BTC`;
  startMonitor(btcAddress, parseFloat(amountBTC), currentPayment);
  forceCheck.style.display = 'inline-block';
});

forceCheck.addEventListener('click', ()=>{ if(currentPayment) checkPaymentNow(currentPayment) });

function loadConfig(){ const raw=localStorage.getItem(cfgKey); if(!raw) return {}; try{ return JSON.parse(raw);}catch{return {}}}
function loadHistory(){ const raw=localStorage.getItem(histKey); if(!raw) return []; try{ return JSON.parse(raw);}catch{return []}}
function saveHistory(){ localStorage.setItem(histKey,JSON.stringify(history)); renderHistory();}
function populateConfigUI(){ cfg = loadConfig(); cfgName.value = cfg?.name || lojistaId; cfgBtcAddress.value = cfg?.btc || ''; cfgUsdtAddress.value = cfg?.usdt || ''; cfgWebhook.value = cfg?.webhook || ''; cfgPin.value = cfg?.pin || ''; lojistaNameEl.textContent = cfg?.name || lojistaId; }
function renderHistory(){ historyBody.innerHTML=''; history.forEach(h=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${h.id}</td><td>${h.usd}</td><td>${h.amountBTC}</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${h.btcAddress}</td><td>${h.status}</td><td style="font-size:12px">${h.txid?(`<a href="https://blockstream.info/tx/${h.txid}" target="_blank">${h.txid.slice(0,12)}...</a>`):'-'}</td>`; historyBody.appendChild(tr); }); }

async function getBTCPriceUSD(){ try{ const res=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'); const j=await res.json(); return j.bitcoin.usd;}catch(e){console.warn('CoinGecko falhou, fallback 30000',e); return 30000;}}

async function getReceivedBTC(address){ try{ const resp=await fetch(`https://blockstream.info/api/address/${address}/utxo`); if(!resp.ok) throw new Error('Blockstream error'); const utxos=await resp.json(); const totalSats=utxos.reduce((s,u)=>s+(u.value||0),0); return totalSats/1e8;}catch(e){console.error('Erro ao consultar Blockstream',e); return 0;}}

function startMonitor(address,amountBTC,payment){ if(monitorInterval) clearInterval(monitorInterval); monitorInterval=setInterval(()=>checkPaymentNow(payment),5000); checkPaymentNow(payment); }

async function checkPaymentNow(payment){
  if(!payment) return;
  statusEl.textContent='Verificando blockchain...';
  const received = await getReceivedBTC(payment.btcAddress);
  if(received >= parseFloat(payment.amountBTC)-0.00000001){
    payment.status='confirmed';
    try{
      const resp = await fetch(`https://blockstream.info/api/address/${payment.btcAddress}/txs`);
      const txs = await resp.json();
      let foundTx = null; for(const tx of txs){ foundTx = tx.txid; break; }
      payment.txid = foundTx || null;
    }catch(e){console.warn('Não obteve TXID', e);}
    saveHistory();
    statusEl.textContent='Pagamento confirmado on-chain!';
    usdtMsg.textContent=`Enviar ${payment.usd} USDT para ${cfg?.usdt || '(não configurado)'}`;
    if(monitorInterval){clearInterval(monitorInterval); monitorInterval=null;}
    if(cfg?.webhook) triggerWebhook(cfg.webhook,payment).then(ok=>console.log('webhook ok',ok)).catch(err=>console.warn('webhook falhou',err));
  }else{
    statusEl.textContent=`Aguardando pagamento — recebido: ${received} BTC`;
  }
}

async function triggerWebhook(url,payment){
  const payload = { lojistaId, payment: { id: payment.id, usd: payment.usd, amountBTC: payment.amountBTC, btcAddress: payment.btcAddress, txid: payment.txid || null, timestamp: payment.timestamp }, usdtDestination: cfg?.usdt || null, network: payment.usdtNetwork || null };
  const resp = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return resp.ok ? await resp.json().catch(()=>({ok:true})) : Promise.reject(new Error('webhook response not ok'));
}
