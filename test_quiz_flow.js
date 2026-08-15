const puppeteer = require('puppeteer');
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'lucky2026';
const BASIC_AUTH = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

async function getSocketToken(role) {
  const res = await fetch(`${SERVER_URL}/socket-token/${role}`, {
    headers: { Authorization: BASIC_AUTH }
  });
  if (!res.ok) {
    throw new Error(`無法取得 ${role} socket token: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.token;
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new",
    executablePath: "C:\\Users\\vbnmz\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe"
  });
  const page = await browser.newPage();
  await page.authenticate({ username: ADMIN_USER, password: ADMIN_PASS });
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('requestfailed', request => console.log('FAILED REQUEST:', request.url(), request.failure().errorText));
  page.on('response', response => {
    if (!response.ok()) console.log('404 OR FAILED:', response.url(), response.status());
  });
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`${SERVER_URL}/host`, { waitUntil: 'networkidle2' });
  
  // Also connect an admin client via socket.io to start the game
  const adminToken = await getSocketToken('admin');
  const adminSocket = io(SERVER_URL, { auth: { role: 'admin', token: adminToken } });
  
  adminSocket.on('connect', async () => {
    console.log('Admin connected, starting round...');
    // Add some bots
    adminSocket.emit('admin:spawn_bots', { count: 5 });
    
    setTimeout(() => {
      adminSocket.emit('host:start_round');
      console.log('Round started. Waiting for quiz...');
    }, 1000);
  });

  adminSocket.on('game:quiz_prepare', async (data) => {
    console.log('Quiz prepare!', data);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: 'test_quiz_prepare.png' });
    console.log('Saved prepare screenshot to test_quiz_prepare.png');
  });

  adminSocket.on('game:quiz_start', async (data) => {
    console.log('Quiz triggered!', data);
    await new Promise(r => setTimeout(r, 1000));
    
    // Take a screenshot of the quiz screen
    await page.screenshot({ path: 'test_quiz_integration.png' });
    console.log('Saved integration screenshot to test_quiz_integration.png');
    
    adminSocket.disconnect();
    await browser.close();
    process.exit(0);
  });
  
  // Timeout safety
  setTimeout(async () => {
    console.log('Timeout waiting for quiz...');
    await page.screenshot({ path: 'test_quiz_timeout.png' });
    adminSocket.disconnect();
    await browser.close();
    process.exit(1);
  }, 40000);
})();
