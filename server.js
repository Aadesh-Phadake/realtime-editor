import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { Server } from 'socket.io';
import ACTIONS from './shared/Actions.js';
import puppeteer from 'puppeteer';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Persistent browser instance for scraping (reuse for performance) ──
let browserInstance = null;
let puppeteerAvailable = true; // flag to avoid retrying if Chrome is missing

async function getBrowser() {
  if (!puppeteerAvailable) return null;
  if (browserInstance && browserInstance.connected) return browserInstance;

  try {
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    };

    // On Render/Linux, Chromium may be installed via buildpack at a custom path
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browserInstance = await puppeteer.launch(launchOptions);
    console.log('✅ Puppeteer browser launched');
    return browserInstance;
  } catch (err) {
    console.warn('⚠️ Puppeteer unavailable (Chrome not found). Sample scraping disabled.');
    console.warn('   To fix on Render: add https://github.com/nicholasgasior/render-puppeteer-buildpack');
    puppeteerAvailable = false;
    return null;
  }
}

// Scrape sample test cases from a Codeforces problem page using Puppeteer
async function scrapeCfSamples(cfUrl) {
  const browser = await getBrowser();
  if (!browser) return []; // Chrome not available, skip scraping
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.goto(cfUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait a bit for Cloudflare challenge to resolve
    await new Promise(r => setTimeout(r, 3000));

    // Check if the page loaded properly
    const hasSamples = await page.evaluate(() => !!document.querySelector('.sample-test'));
    if (!hasSamples) {
      return [];
    }

    const samples = await page.evaluate(() => {
      // Codeforces wraps each line in a <div> inside <pre>. We need to
      // extract text from each child div separately and join with newlines.
      function extractPreText(preEl) {
        const divs = preEl.querySelectorAll('div');
        if (divs.length > 0) {
          // Each <div> = one line
          return [...divs].map(d => d.textContent).join('\n').trim();
        }
        // Fallback: no divs, use innerText which preserves <br> as newlines
        return preEl.innerText.trim();
      }
      const inputs = [...document.querySelectorAll('.sample-test .input pre')];
      const outputs = [...document.querySelectorAll('.sample-test .output pre')];
      return inputs.map((el, i) => ({
        input: extractPreText(el),
        output: outputs[i] ? extractPreText(outputs[i]) : '',
      }));
    });
    return samples;
  } catch (err) {
    console.error('Puppeteer scrape error:', err.message);
    return [];
  } finally {
    await page.close();
  }
}

// ── Codeforces Problem Endpoint (API metadata + Puppeteer sample scraping) ──
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
    // Fetch metadata from official CF API + scrape samples with Puppeteer in parallel
    const cfPageUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`;
    const [apiRes, samples] = await Promise.all([
      fetch('https://codeforces.com/api/problemset.problems'),
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

    console.log(`✅ CF: ${problem.index}. ${problem.name} | ${samples.length} sample(s) scraped`);
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
    console.error('CF error:', err.message);
    res.status(500).json({ error: 'Failed to fetch problem' });
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
