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
    
    // Switch to racing screen first (so quiz overlay appears on top)
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
      const racingScreen = document.getElementById('screen-racing');
      if (racingScreen) racingScreen.classList.add('active');
    });

    await new Promise(r => setTimeout(r, 1000));

    // Open quiz overlay and populate with sample data
    await page.evaluate(() => {
      const overlay = document.getElementById('quiz-overlay');
      if (overlay) overlay.style.display = 'flex';

      // Render team bar
      const teams = window.GameConfig ? window.GameConfig.TEAMS : [];
      const bar = document.getElementById('quiz-team-bar');
      if (bar && teams.length > 0) {
        bar.innerHTML = '';
        const sampleProgress = ['3/12', '5/12', '2/8', '4/10', '1/6'];
        teams.forEach((t, i) => {
          const cell = document.createElement('div');
          cell.className = 'quiz-team-cell';
          cell.innerHTML = `
            <span class="qt-name">${t.name}</span>
            <span class="qt-progress">${sampleProgress[i]}</span>
            <div class="qt-bar-wrap">
              <div class="qt-bar-fill" style="width: ${Math.random() * 60 + 20}%; background-color: ${t.hex};"></div>
            </div>
          `;
          bar.appendChild(cell);
        });
      }

      // Set question
      const qBox = document.getElementById('quiz-question-box');
      if (qBox) qBox.innerText = 'Q3. 新郎新娘的第一次約會是去哪裡？';

      // Set timer
      const timerNum = document.getElementById('quiz-timer-num');
      if (timerNum) timerNum.innerText = '8';

      // Render options
      const optGrid = document.getElementById('quiz-options-display');
      if (optGrid) {
        const options = ['夜市吃臭豆腐', '看電影', '逛書店', '爬山'];
        const labels = ['A', 'B', 'C', 'D'];
        optGrid.innerHTML = '';
        options.forEach((opt, i) => {
          const card = document.createElement('div');
          card.className = 'quiz-option-card-v2';
          card.innerHTML = `<span class="opt-text">${labels[i]}. ${opt}</span>`;
          optGrid.appendChild(card);
        });
      }
    });

    await new Promise(r => setTimeout(r, 1500));
    
    const screenshotPath = 'quiz_screenshot.png';
    await page.screenshot({ path: screenshotPath });
    console.log("Quiz screenshot saved to", screenshotPath);
    
    await browser.close();
  } catch (error) {
    console.error("Error taking screenshot:", error);
    process.exit(1);
  }
})();
