/**
 * 行情数据获取模块
 * 使用东方财富/腾讯公开接口获取 A 股/ETF 历史 K 线
 * 使用天天基金接口获取场外基金实时估值
 */

const https = require('https');
const http = require('http');

function request(url, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const options = {
      timeout: 15000,
      agent: new client.Agent({ keepAlive: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'http://quote.eastmoney.com/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...customHeaders
      }
    };
    client.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function parseJsonp(text, varName) {
  const start = text.indexOf(varName + '(');
  if (start === -1) {
    try { return JSON.parse(text); } catch { return null; }
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonStart = start + varName.length + 1;
  for (let i = jsonStart; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(jsonStart, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

function getSecid(code) {
  const c = String(code).trim();
  if (/^(6|68|5|11|51)/.test(c)) return '1.' + c;
  if (/^(0|3|15|12|16|18)/.test(c)) return '0.' + c;
  return '1.' + c;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function txSymbol(code) {
  const c = String(code).trim();
  if (/^(6|68|5|11|51)/.test(c)) return 'sh' + c;
  return 'sz' + c;
}

function parseEastmoneyKlines(json, code) {
  if (!json.data || !Array.isArray(json.data.klines)) return null;
  return json.data.klines.map(line => {
    const parts = line.split(',');
    return {
      date: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]),
      amount: parseFloat(parts[6]),
      amplitude: parseFloat(parts[7]),
      pctChange: parseFloat(parts[8]),
      change: parseFloat(parts[9]),
      turnover: parseFloat(parts[10])
    };
  });
}

function parseTencentKlines(json, code) {
  const key = txSymbol(code);
  const list = json.data && (json.data[key].qfqday || json.data[key].day);
  if (!Array.isArray(list)) return null;
  return list.map((parts, i) => {
    const open = parseFloat(parts[1]);
    const close = parseFloat(parts[2]);
    const low = parseFloat(parts[3]);
    const high = parseFloat(parts[4]);
    const volume = parseFloat(parts[5]);
    const prevClose = i > 0 ? parseFloat(list[i - 1][2]) : open;
    const change = close - prevClose;
    const pctChange = prevClose ? (change / prevClose) * 100 : 0;
    const amplitude = prevClose ? ((high - low) / prevClose) * 100 : 0;
    return {
      date: parts[0],
      open,
      close,
      high,
      low,
      volume,
      amount: volume * close,
      amplitude,
      pctChange,
      change,
      turnover: 0
    };
  });
}

async function fetchEastmoneyKline(code, periodDays) {
  const secid = getSecid(code);
  const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date();
  start.setDate(start.getDate() - periodDays * 1.5);
  const begDate = start.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=${begDate}&end=${endDate}&lmt=${periodDays}`;
  const raw = await request(url);
  const json = JSON.parse(raw);
  return parseEastmoneyKlines(json, code);
}

async function fetchTencentKline(code, periodDays) {
  const start = new Date();
  start.setDate(start.getDate() - periodDays * 1.5);
  const begDate = start.toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);
  const symbol = txSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${begDate},${endDate},${periodDays},qfq`;
  const raw = await request(url, { Referer: 'https://stock.finance.qq.com/' });
  const json = JSON.parse(raw);
  return parseTencentKlines(json, code);
}

async function fetchStockKline(code, periodDays = 120, retries = 3) {
  // 优先使用腾讯财经（更稳定），失败后再尝试东方财富
  for (let i = 0; i <= retries; i++) {
    try {
      const data = await fetchTencentKline(code, periodDays);
      if (data && data.length >= 70) return data;
    } catch (err) {
      if (i === retries) break;
      await sleep(400 + i * 200);
    }
  }
  for (let i = 0; i <= retries; i++) {
    try {
      const data = await fetchEastmoneyKline(code, periodDays);
      if (data && data.length >= 70) return data;
    } catch (err) {
      if (i === retries) break;
      await sleep(400 + i * 200);
    }
  }
  console.error(`[fetcher] ${code} K线获取失败: 腾讯/东方财富均不可用`);
  return null;
}

async function fetchStockRealtime(code) {
  const secid = getSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`;
  try {
    const raw = await request(url);
    const json = JSON.parse(raw);
    if (!json.data) return null;
    const d = json.data;
    return {
      code: d.f57,
      name: d.f58,
      price: d.f43 / 100,
      open: d.f46 / 100,
      high: d.f44 / 100,
      low: d.f45 / 100,
      prevClose: d.f60 / 100,
      volume: d.f47,
      amount: d.f48,
      pctChange: d.f170 / 100
    };
  } catch (err) {
    console.error(`[fetcher] ${code} 实时行情获取失败:`, err.message);
    return null;
  }
}

async function fetchFundRealtime(code) {
  const url = `http://fundgz.1234567.com.cn/js/${code}.js`;
  try {
    const raw = await request(url);
    const data = parseJsonp(raw, 'jsonpgz');
    if (!data) return null;
    return {
      code: data.fundcode,
      name: data.name,
      price: parseFloat(data.gsz),
      pctChange: parseFloat(data.gszzl),
      nav: parseFloat(data.dwjz),
      date: data.jzrq
    };
  } catch (err) {
    console.error(`[fetcher] ${code} 基金估值获取失败:`, err.message);
    return null;
  }
}

module.exports = {
  fetchStockKline,
  fetchStockRealtime,
  fetchFundRealtime,
  getSecid,
  request
};
