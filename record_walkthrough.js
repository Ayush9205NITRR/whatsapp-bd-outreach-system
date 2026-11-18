const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARTIFACT_DIR = '/Users/ayushtiwari/.gemini/antigravity/brain/ebb504e4-7d2e-4ef5-8017-44e859994a64';
const FRAMES_DIR = path.join(ARTIFACT_DIR, 'scratch', 'demo_frames');
const DESKTOP_VIDEO = '/Users/ayushtiwari/Desktop/enout_whatsapp_bd_system_demo.mp4';
const ARTIFACT_VIDEO = path.join(ARTIFACT_DIR, 'enout_whatsapp_bd_system_demo.mp4');

fs.mkdirSync(FRAMES_DIR, { recursive: true });

let frameIndex = 0;

async function captureHold(page, count = 15, screenshotPath = null) {
    const buf = await page.screenshot({ type: 'png' });
    if (screenshotPath) {
        fs.writeFileSync(screenshotPath, buf);
    }
    for (let i = 0; i < count; i++) {
        frameIndex++;
        const frameFile = path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(4, '0')}.png`);
        fs.writeFileSync(frameFile, buf);
    }
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

(async () => {
    console.log('Launching Chrome for full HD walkthrough recording...');
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
        defaultViewport: { width: 1440, height: 920, deviceScaleFactor: 2 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 1. Open Dashboard
    console.log('Step 1: Opening http://localhost:3030...');
    await page.goto('http://localhost:3030', { waitUntil: 'networkidle0' });
    await sleep(600);
    await captureHold(page, 20, path.join(ARTIFACT_DIR, 'step1_initial_dashboard.png'));

    // 2. Click Generate QR Code for BD Exec 1 (Ayush)
    console.log('Step 2: Generating WhatsApp QR Code for BD Exec 1 (Ayush)...');
    await page.click('#btnConnectSim');
    await sleep(800);
    await captureHold(page, 25, path.join(ARTIFACT_DIR, 'step2_qr_code_generated.png'));

    // 3. Complete QR Scan Login
    console.log('Step 3: Linking WhatsApp Session...');
    await page.click('#btnSimulateScan');
    await sleep(800);
    await captureHold(page, 20, path.join(ARTIFACT_DIR, 'step3_whatsapp_connected.png'));

    // 4. Fetch Airtable View "reapply march 21"
    console.log('Step 4: Fetching Airtable View "reapply march 21"...');
    await page.click('#btnFetchAirtable');
    await sleep(800);
    await captureHold(page, 20, path.join(ARTIFACT_DIR, 'step4_airtable_view_loaded.png'));

    // 5. Scroll down to Step 2, Step 3, Step 4 and run Demo Verification
    console.log('Step 5: Running Demo Verification & Test Shoot (92173 54399, 86900 22224)...');
    await page.evaluate(() => {
        document.getElementById('btnDemoRun').scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await sleep(400);
    await captureHold(page, 15);

    await page.click('#btnDemoRun');
    await sleep(1000);
    await page.evaluate(() => {
        document.getElementById('demoReportBox').scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await sleep(400);
    await captureHold(page, 30, path.join(ARTIFACT_DIR, 'step5_demo_run_verified.png'));

    // 6. Click Shoot Campaign & Update Airtable Fields
    console.log('Step 6: Shooting Campaign & Updating Airtable Fields...');
    await page.click('#btnShootCampaign');
    for (let i = 0; i < 6; i++) {
        await sleep(400);
        await page.evaluate(() => {
            document.getElementById('shootProgressBox').scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await captureHold(page, 5);
    }
    await sleep(1000);
    await captureHold(page, 30, path.join(ARTIFACT_DIR, 'step6_campaign_shoot_completed.png'));

    // 7. Scroll back to top to show Airtable table updated with "WA scheduling message sent: true ✅"
    console.log('Step 7: Verifying Airtable records updated in Step 1 table...');
    await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await sleep(600);
    await captureHold(page, 30, path.join(ARTIFACT_DIR, 'step7_airtable_fields_updated.png'));

    // 8. Open GitHub Repository to show pushed code
    console.log('Step 8: Capturing GitHub Repository...');
    await page.goto('https://github.com/Ayush9205NITRR/whatsapp-bd-outreach-system', { waitUntil: 'networkidle2' });
    await sleep(800);
    await captureHold(page, 25, path.join(ARTIFACT_DIR, 'step8_github_repo.png'));

    await browser.close();

    console.log(`Captured ${frameIndex} frames. Encoding MP4 video via ffmpeg...`);
    const ffmpegCmd = `ffmpeg -y -framerate 10 -i "${FRAMES_DIR}/frame_%04d.png" -vf "scale=1440:920" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 20 "${ARTIFACT_VIDEO}"`;
    execSync(ffmpegCmd, { stdio: 'inherit' });
    fs.copyFileSync(ARTIFACT_VIDEO, DESKTOP_VIDEO);
    console.log(`✅ Video saved to:\n  1. ${DESKTOP_VIDEO}\n  2. ${ARTIFACT_VIDEO}`);
})();
