const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({ 
      headless: "new",
      executablePath: "C:\\Users\\vbnmz\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe"
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    console.log("Navigating to http://localhost:3000/host...");
    await page.goto('http://localhost:3000/host', { waitUntil: 'networkidle2' });
    
    // Switch to racing screen
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
      const racingScreen = document.getElementById('screen-racing');
      if (racingScreen) {
        racingScreen.classList.add('active');
      }
    });

    await new Promise(r => setTimeout(r, 2000));
    
    const screenshotPath = 'test_screenshot.png';
    await page.screenshot({ path: screenshotPath });
    console.log("Screenshot saved to", screenshotPath);
    
    await browser.close();
  } catch (error) {
    console.error("Error taking screenshot:", error);
    process.exit(1);
  }
})();
