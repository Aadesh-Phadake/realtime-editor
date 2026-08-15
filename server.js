import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { Server } from 'socket.io';
import ACTIONS from './shared/Actions.js';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Common headers to mimic a real browser ──
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Persistent stealth browser instance ──
let browserInstance = null;

async function getStealthBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;
  try {
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    };

    // Production (Render): use @sparticuz/chromium which bundles its own Chromium
    if (process.env.RENDER) {
      const chromium = (await import('@sparticuz/chromium')).default;
      launchOptions.executablePath = await chromium.executablePath();
      launchOptions.args = [...chromium.args, '--single-process'];
      launchOptions.headless = chromium.headless;
      console.log('  Using @sparticuz/chromium for Render');
    } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      // Custom Chrome path (Docker, buildpack, etc.)
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    // else: local dev — puppeteer auto-detects its bundled Chrome

    browserInstance = await puppeteer.launch(launchOptions);
    console.log('✅ Stealth browser launched');
    return browserInstance;
  } catch (err) {
    console.warn('⚠️ Stealth browser unavailable:', err.message);
    return null;
  }
}

// ── Parse sample test cases from HTML (shared by both cheerio and Puppeteer) ──
function parseSamplesFromHtml(html) {
  const $ = cheerio.load(html);
  const sampleTest = $('.sample-test');
  if (sampleTest.length === 0) return [];

  const inputs = sampleTest.find('.input pre');
  const outputs = sampleTest.find('.output pre');
  const samples = [];

  inputs.each((i, el) => {
    const $pre = $(el);
    const divs = $pre.find('div');
    let inputText;
    if (divs.length > 0) {
      inputText = divs.map((_, d) => $(d).text()).get().join('\n').trim();
    } else {
      inputText = $pre.text().trim();
    }

    let outputText = '';
    const $outPre = $(outputs[i]);
    if ($outPre.length) {
      const outDivs = $outPre.find('div');
      if (outDivs.length > 0) {
        outputText = outDivs.map((_, d) => $(d).text()).get().join('\n').trim();
      } else {
        outputText = $outPre.text().trim();
      }
    }

    samples.push({ input: inputText, output: outputText });
  });

  return samples;
}

// ── Tier 1: Try lightweight fetch + cheerio ──
async function scrapeCfCheerio(cfUrl) {
  const res = await fetch(cfUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
  if (!res.ok) return null; // signal to try Puppeteer
  const html = await res.text();
  const samples = parseSamplesFromHtml(html);
  return samples.length > 0 ? samples : null;
}

// ── Tier 2: Stealth Puppeteer (bypasses Cloudflare) ──
async function scrapeCfPuppeteer(cfUrl) {
  const browser = await getStealthBrowser();
  if (!browser) return [];

  const page = await browser.newPage();

  // Capture HTML from network responses — works even if frame detaches or nav times out
  let capturedHtml = '';
  page.on('response', async (response) => {
    try {
      const ct = response.headers()['content-type'] || '';
      if (
        response.url().includes('codeforces.com') &&
        ct.includes('text/html') &&
        response.status() === 200
      ) {
        const text = await response.text();
        if (text.includes('sample-test')) {
          capturedHtml = text;
        }
      }
    } catch (_) {}
  });

  try {
    // Navigate — catch ALL errors (timeout, detached frame, etc.)
    // The response listener captures HTML independently of navigation state
    try {
      await page.goto(cfUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (navErr) {
      console.log(`  ⏳ Navigation issue: ${navErr.message.split('\n')[0]}, checking captured data...`);
      // Give response listener extra time to capture HTML
      await new Promise(r => setTimeout(r, 3000));
    }

    // Try getting content directly from page
    try {
      await page.waitForSelector('.sample-test', { timeout: 5000 }).catch(() => {});
      const html = await page.content();
      const samples = parseSamplesFromHtml(html);
      if (samples.length > 0) return samples;
    } catch (_) {}

    // Fallback: use the HTML captured from network response
    if (capturedHtml) {
      console.log('  ✅ Using network-captured HTML');
      return parseSamplesFromHtml(capturedHtml);
    }

    return [];
  } catch (err) {
    console.warn('⚠️ Stealth scrape error:', err.message);
    return [];
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

// ── Combined scraper: cheerio fast-path → Puppeteer fallback ──
async function scrapeCfSamples(cfUrl) {
  try {
    // Try lightweight cheerio first
    const cheerioResult = await scrapeCfCheerio(cfUrl);
    if (cheerioResult) {
      console.log('  ✅ Samples scraped via cheerio (fast path)');
      return cheerioResult;
    }

    // Cloudflare blocked us — fall back to stealth Puppeteer
    console.log('  ⏳ Cheerio blocked, trying stealth Puppeteer...');
    const puppeteerResult = await scrapeCfPuppeteer(cfUrl);
    if (puppeteerResult.length > 0) {
      console.log('  ✅ Samples scraped via stealth Puppeteer');
    } else {
      console.warn('  ⚠️ Could not scrape samples (Cloudflare may be blocking both methods)');
    }
    return puppeteerResult;
  } catch (err) {
    console.warn('⚠️ CF scrape failed:', err.message);
    return [];
  }
}

// ── Fetch from Codeforces API with proper headers and retry ──
async function fetchCfApi() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://codeforces.com/api/problemset.problems', {
        headers: BROWSER_HEADERS,
      });
      return res;
    } catch (err) {
      if (attempt < 3) {
        console.warn(`⚠️ CF API attempt ${attempt} failed: ${err.message}, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        throw err;
      }
    }
  }
}

// ── Codeforces Problem Endpoint ──
app.get('/api/codeforces', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing "url" query parameter' });

  // Parse contestId and index from URL
  let contestId, index;
  const psMatch = url.match(/problemset\/problem\/(\d+)\/(\w+)/);
  const ctMatch = url.match(/contest\/(\d+)\/problem\/(\w+)/);
  if (psMatch) {
    contestId = parseInt(psMatch[1]);
    index = psMatch[2].toUpperCase();
  } else if (ctMatch) {
    contestId = parseInt(ctMatch[1]);
    index = ctMatch[2].toUpperCase();
  } else {
    return res.status(400).json({ error: 'Invalid Codeforces URL. Use format: codeforces.com/problemset/problem/{contestId}/{index}' });
  }

  try {
    const cfPageUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`;
    console.log(`🔍 Fetching CF problem: ${contestId}/${index}`);

    const [apiRes, samples] = await Promise.all([
      fetchCfApi(),
      scrapeCfSamples(cfPageUrl),
    ]);

    if (!apiRes.ok) {
      return res.status(502).json({ error: 'Codeforces API unavailable' });
    }
    const apiData = await apiRes.json();
    if (apiData.status !== 'OK') {
      return res.status(502).json({ error: 'Codeforces API returned error' });
    }

    const problem = apiData.result.problems.find(
      p => p.contestId === contestId && p.index === index
    );

    if (!problem) {
      return res.status(404).json({ error: `Problem ${contestId}/${index} not found` });
    }

    console.log(`✅ CF: ${problem.index}. ${problem.name} | ${samples.length} sample(s)`);
    res.json({
      contestId: problem.contestId,
      index: problem.index,
      title: `${problem.index}. ${problem.name}`,
      name: problem.name,
      rating: problem.rating || null,
      tags: problem.tags || [],
      url: cfPageUrl,
      samples,
    });
  } catch (err) {
    console.warn('⚠️ CF fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch problem — Codeforces may be temporarily unavailable. Try again or add test cases manually.' });
  }
});

app.use(express.static('dist'));
app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const userSocketMap = {};

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((socketId) => {
    return {
      socketId,
      username: userSocketMap[socketId],
    };
  });
}

io.on('connection', (socket) => {
  console.log('✅ Socket connected:', socket.id);

  socket.on(ACTIONS.JOIN, ({roomId , username}) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({socketId}) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({roomId, code}) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, {code});
  });

  socket.on(ACTIONS.SYNC_CODE, ({socketId, code}) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, {code});
  });


  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms);
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    socket.leave();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
