const defaultCountdownStartTimeMs = 20 * 1000;
const minCountdownStartTimeMs = 0;
const maxCountdownStartTimeMs = 60 * 1000;
const intervalRateMs = 1000;

const cssClassName_Wrapper = `redirect-page-auto-closer-for-slack-wrapper`;
const cssClassName_MainPopOver = `redirect-page-auto-closer-for-slack-main-pop-over`;
const cssClassName_CountdownText = `redirect-page-auto-closer-for-slack-countdown-text`;
const cssClassName_CloseNowBtn = `redirect-page-auto-closer-for-slack-close-now-btn`;
const cssClassName_StopLink = `redirect-page-auto-closer-for-slack-stop-link`;

const cssClassName_SettingsMenu = `redirect-page-auto-closer-for-slack-settings-menu`;
const cssClassName_SettingsOption = `redirect-page-auto-closer-for-slack-settings-option`;

const storageKey_CountdownStartTimeMs = `rpacfs_timer`;

/** Cached countdown (synced from chrome.storage); used for sync reads. */
let savedCountdownStartTimeMs = defaultCountdownStartTimeMs;

function log(text) {
  console.log(`RPACFS: ${text}`);
}

function getCountdownStartTimeMs() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      log('chrome.storage.local unavailable; using default');
      savedCountdownStartTimeMs = defaultCountdownStartTimeMs;
      resolve(defaultCountdownStartTimeMs);
      return;
    }
    chrome.storage.local.get([storageKey_CountdownStartTimeMs], (result) => {
      if (chrome.runtime?.lastError) {
        log(`Storage get failed: ${chrome.runtime.lastError.message}; using default ${defaultCountdownStartTimeMs}ms`);
        savedCountdownStartTimeMs = defaultCountdownStartTimeMs;
        setCountdownStartTimeMs(defaultCountdownStartTimeMs).then(() => resolve(defaultCountdownStartTimeMs));
        return;
      }
      let startTimeMs = result[storageKey_CountdownStartTimeMs];
      startTimeMs = typeof startTimeMs === 'number' ? startTimeMs : Number(startTimeMs);
      if (typeof startTimeMs !== 'number' || isNaN(startTimeMs) || startTimeMs < minCountdownStartTimeMs || startTimeMs > maxCountdownStartTimeMs) {
        startTimeMs = defaultCountdownStartTimeMs;
        setCountdownStartTimeMs(startTimeMs).then(() => {
          savedCountdownStartTimeMs = startTimeMs;
          resolve(startTimeMs);
        });
      } else {
        savedCountdownStartTimeMs = startTimeMs;
        resolve(startTimeMs);
      }
    });
  });
}

function setCountdownStartTimeMs(startTimeMs) {
  savedCountdownStartTimeMs = startTimeMs;
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      log('chrome.storage.local unavailable; skipped save');
      resolve();
      return;
    }
    chrome.storage.local.set({ [storageKey_CountdownStartTimeMs]: startTimeMs }, () => {
      if (chrome.runtime?.lastError) {
        log(`Storage set failed: ${chrome.runtime.lastError.message}`);
      } else {
        log(`Storage saved: ${storageKey_CountdownStartTimeMs}=${startTimeMs}`);
      }
      resolve();
    });
  });
}

log('loaded...');

let timeTillCloseMs = defaultCountdownStartTimeMs;
let intervalId;

(async function init() {
  timeTillCloseMs = await getCountdownStartTimeMs();
  intervalId = setInterval(countDownToClose, intervalRateMs);
})();

function getWrapperEl() {
  return document.documentElement.querySelector(`.${cssClassName_Wrapper}`);
}

function countdownWithText(countdownTimeMs) {
  if (false) { // Used for freezing the countdown when debugging styling
    countdownTimeMs = savedCountdownStartTimeMs;
    clearInterval(intervalId);
  }

  let wrapperEl = getWrapperEl();

  if (!wrapperEl) { // Lazy init the element
    wrapperEl = document.createElement('div');
    wrapperEl.classList.add(cssClassName_Wrapper);
    wrapperEl.innerHTML = `
    <div class='${cssClassName_MainPopOver}'>
      <div class='${cssClassName_CountdownText}'></div>
      <a class='${cssClassName_StopLink}'>cancel</a>
      <a class='${cssClassName_CloseNowBtn}'>close now</a>
    </div>
    `;
    document.body.appendChild(wrapperEl);

    wrapperEl.querySelector(`.${cssClassName_CloseNowBtn}`).onclick = () => {
      log('Closing tab now');
      closeThisTabNow();
    };

    wrapperEl.querySelector(`.${cssClassName_StopLink}`).onclick = () => {
      log('Canceled the countdown');
      clearInterval(intervalId);
      wrapperEl.remove();
    };

    injectAndUpdateSettingsMenu();
  }

  const countdownEl = wrapperEl.querySelector(`.${cssClassName_CountdownText}`);
  const displaySec = Math.max(0, Math.round(countdownTimeMs / 1000));
  countdownEl.innerText = `Closing page in ${displaySec} second${displaySec !== 1 ? 's' : ''}`;
}

function injectAndUpdateSettingsMenu() {
  const incrementalSec = 1;
  const trueCountdownStartTimeSec = Math.round(savedCountdownStartTimeMs / 1000);

  const optionsList = [];
  const decrementValSec = trueCountdownStartTimeSec - incrementalSec;
  const incrementValSec = trueCountdownStartTimeSec + incrementalSec;
  if (decrementValSec >= 0) {
    optionsList.push(decrementValSec);
  }
  if (incrementValSec * 1000 <= maxCountdownStartTimeMs) {
    optionsList.push(incrementValSec);
  }
  if (optionsList.length === 0) {
    log('no options');
    return;
  }
  const wrapperEl = getWrapperEl();
  wrapperEl.querySelector(`.${cssClassName_SettingsMenu}`)?.remove();

  const settingsEl = document.createElement('div');
  settingsEl.classList.add(cssClassName_SettingsMenu);
  settingsEl.innerHTML = `
  ${trueCountdownStartTimeSec} second${trueCountdownStartTimeSec !== 1 ? 's' : ''} not your speed? Try
  <a class='${cssClassName_SettingsOption}'>${optionsList[0]}s</a>
  `;
  if (optionsList.length > 1) {
    settingsEl.innerHTML += `
    or
    <a class='${cssClassName_SettingsOption}'>${optionsList[1]}s</a>
    `;
  }
  const optionsElList = settingsEl.querySelectorAll(`.${cssClassName_SettingsOption}`);
  optionsElList.forEach((optionEl, i) => {
    const op = optionsList[i];
    optionEl.onclick = () => {
      log(`New time selected: ${op}`);
      setCountdownStartTimeMs(op * 1000); // save for next pageview; current countdown continues unchanged
      injectAndUpdateSettingsMenu();
    };
  });
  wrapperEl.appendChild(settingsEl);
}

function isPageTextLikeSlackRedirect() {
  // Ensure DOM is ready
  if (!document.body) return false;
  
  const pageText = document.body.innerText?.toLowerCase() || '';
  return (
    pageText.includes('redirecting to') ||
    pageText.includes('redirected you') ||
    pageText.includes('launching')
  );
}

let isSlackRedirectPageCached = null;

function countDownToClose() {
  timeTillCloseMs -= intervalRateMs;

  if (isSlackRedirectPageCached === null) {
    isSlackRedirectPageCached = isPageTextLikeSlackRedirect();
  }
  if (!isSlackRedirectPageCached) {
    log(`Slack redirect page not detected`);
    timeTillCloseMs += intervalRateMs; // Put back the time
    return;
  }

  log(`Time remaining: ${Math.ceil(timeTillCloseMs / 1000)}s`);
  countdownWithText(timeTillCloseMs);

  if (timeTillCloseMs > 0) { return; }

  clearInterval(intervalId);

  closeThisTabNow();
}

function closeThisTabNow() {
  chrome.runtime.sendMessage({ pleaseCloseThisTab: true });
}
