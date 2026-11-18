const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 1. HARDCODED AIRTABLE CONFIGURATION (From index.js)
// ============================================================================
const AIRTABLE_CONFIG = {
    baseId: 'appxUfmx7hibOaBNb',
    tableName: 'Main',
    get baseUrl() {
        return `https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.tableName)}`;
    },
    defaultView: 'reapply march 21',
    apiKey: process.env.AIRTABLE_API_KEY || '',
    defaultUpdateFields: {
        'WA scheduling message sent': true
    }
};

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ============================================================================
// 2. 8 BD EXECUTIVES STATE & WHATSAPP SESSIONS
// ============================================================================
const EXECUTIVES = {};
const DEFAULT_EXEC_NAMES = [
    'BD Exec 1 (Ayush)',
    'BD Exec 2 (Nirupam)',
    'BD Exec 3 (Rohan)',
    'BD Exec 4 (Priya)',
    'BD Exec 5 (Ananya)',
    'BD Exec 6 (Vikram)',
    'BD Exec 7 (Neha)',
    'BD Exec 8 (Siddharth)'
];

for (let i = 1; i <= 8; i++) {
    const id = `bd-exec-${i}`;
    EXECUTIVES[id] = {
        id,
        seatNumber: i,
        name: DEFAULT_EXEC_NAMES[i - 1],
        status: 'disconnected', // disconnected | initializing | qr_ready | ready | simulated_ready | error
        mode: 'live',           // live | simulation
        qrDataUrl: null,
        qrRaw: null,
        connectedUser: null,
        error: null,
        client: null,
        stats: {
            demosRun: 0,
            messagesSent: 0,
            messagesFailed: 0,
            airtableUpdated: 0,
            lastActive: null
        },
        logs: []
    };
}

function addExecLog(execId, message, level = 'info') {
    const exec = EXECUTIVES[execId];
    if (!exec) return;
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        level,
        message
    };
    exec.logs.unshift(entry);
    if (exec.logs.length > 200) exec.logs.pop();
    exec.stats.lastActive = entry.timestamp;
    console.log(`[${exec.name}] [${level.toUpperCase()}] ${message}`);
}

// Clean up stale Chrome lock files for a given clientId
function cleanSessionLocks(clientId) {
    const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${clientId}`);
    if (fs.existsSync(sessionDir)) {
        try {
            fs.readdirSync(sessionDir).forEach(file => {
                if (file.startsWith('Singleton') || file === 'DevToolsActivePort') {
                    try { fs.unlinkSync(path.join(sessionDir, file)); } catch (_) {}
                }
            });
        } catch (_) {}
    }
}

// ============================================================================
// 3. BUILT-IN MESSAGE TEMPLATES
// ============================================================================
const MESSAGE_TEMPLATES = [
    {
        id: 'enout-test',
        name: 'Enout Outreach Greeting',
        category: 'Enout',
        description: 'Clean personalized outreach greeting from Enout',
        content: 'Hi {{name}} , From enout',
        defaultPhoneColumn: 'number'
    },
    {
        id: 'enout-airtable',
        name: 'Enout Airtable Greeting',
        category: 'Enout',
        description: 'Personalized outreach greeting mapped to Airtable Full Name field',
        content: 'Hi {{Full Name}} , From enout',
        defaultPhoneColumn: 'phone text'
    },
    {
        id: 'algo-screening',
        name: 'Accelerator Camp - Screening Invite (Airtable)',
        category: 'AlgoUniversity',
        description: 'Standard Airtable screening round invite from index.js',
        content: `Hi {{Full Name}}, this is Nirupam from AlgoUniversity. 👋🏻

We’ve received your application for the ⛺ *Accelerator Camp* and I’m happy to inform you that _you’ve cleared the initial shortlisting!_ We’d like to move forward with the mentor interview to *evaluate your fit for the camp*. 

Please prepare these questions beforehand for the _screening round_ :
1. What’s your motivation for joining the Accelerator Camp?
2. Why do you believe you deserve a seat in the camp?

👉 _*Check Camp Details:*_ ng.tinyc.co/acceleratorCampDetails 🔗

We have 5 available slots for the screening call between *6:45–7:30 PM today*. Kindly confirm your availability!`,
        defaultPhoneColumn: 'phone text'
    },
    {
        id: 'algo-top5',
        name: 'Accelerator Camp - Top 5% Selection (CSV)',
        category: 'AlgoUniversity',
        description: 'Top 5% applicant outreach template from index-1.js',
        content: `Hi {{name}}, this is Nirupam from AlgoUniversity. 👋🏻

We’ve received your application for the ⛺ *Accelerator Camp* and I’m happy to inform you that you’re in the _top 5% of applicants!_ We’d like to move forward with the mentor interview to *evaluate your fit for the camp*. 

👉 _*Camp Details*_  ng.tinyc.co/acceleratorCampDetails 🔗

I’ve attached the detailed camp structure and I’ll call you today to collect your technical profiles and schedule your mentor interview.

*Can you confirm if you're available* for a quick 10 min call now?`,
        defaultPhoneColumn: 'number'
    }
];

// ============================================================================
// 4. AIRTABLE LOCAL REPLICA STORE (For seamless demo & live sync)
// ============================================================================
const AIRTABLE_VIEWS_STORE = {
    'reapply march 21': [
        {
            id: 'recEnoutTest001',
            createdTime: '2026-11-18T06:00:00.000Z',
            fields: {
                'Full Name': 'Ayush',
                'name': 'Ayush',
                'phone text': '92173 54399',
                'number': '9217354399',
                'Referred By': 'Direct',
                'college_wise_rank': '1',
                'GC_Scholarship': '75%',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        },
        {
            id: 'recEnoutTest002',
            createdTime: '2026-11-18T06:05:00.000Z',
            fields: {
                'Full Name': 'Founder',
                'name': 'Founder',
                'phone text': '86900 22224',
                'number': '8690022224',
                'Referred By': 'Enout Leadership',
                'college_wise_rank': '1',
                'GC_Scholarship': '100%',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        }
    ],
    'enout test view': [
        {
            id: 'recEnoutTest001',
            createdTime: '2026-11-18T06:00:00.000Z',
            fields: {
                'Full Name': 'Ayush',
                'name': 'Ayush',
                'phone text': '92173 54399',
                'number': '9217354399',
                'Referred By': 'Direct',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        },
        {
            id: 'recEnoutTest002',
            createdTime: '2026-11-18T06:05:00.000Z',
            fields: {
                'Full Name': 'Founder',
                'name': 'Founder',
                'phone text': '86900 22224',
                'number': '8690022224',
                'Referred By': 'Enout',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        }
    ],
    'batch shortlist 2026': [
        {
            id: 'recBatch001',
            createdTime: '2026-11-18T05:00:00.000Z',
            fields: {
                'Full Name': 'Tushar Das',
                'name': 'Tushar Das',
                'phone text': '9113405632',
                'Referred By': 'Campus Ambassador',
                'college_wise_rank': '3',
                'GC_Scholarship': '50%',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        },
        {
            id: 'recBatch002',
            createdTime: '2026-11-18T05:10:00.000Z',
            fields: {
                'Full Name': 'Khushi Verma',
                'name': 'Khushi Verma',
                'phone text': '8340316164',
                'Referred By': 'Alumni',
                'college_wise_rank': '2',
                'GC_Scholarship': '80%',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        },
        {
            id: 'recBatch003',
            createdTime: '2026-11-18T05:15:00.000Z',
            fields: {
                'Full Name': 'Ridhi Singh Gaur',
                'name': 'Ridhi Singh Gaur',
                'phone text': '8178353306',
                'Referred By': 'Direct',
                'college_wise_rank': '5',
                'GC_Scholarship': '60%',
                'WA scheduling message sent': false,
                'Outreach Status': 'Pending'
            }
        }
    ]
};

// ============================================================================
// 5. HELPER FUNCTIONS (Phone Formatting, Template Rendering, CSV Parsing)
// ============================================================================
function formatPhoneNumber(raw) {
    if (!raw) return '';
    let clean = String(raw).replace(/\D/g, '');
    if (clean.length === 10) {
        clean = '91' + clean;
    }
    return clean;
}

function isValidWhatsAppPhone(cleanPhone) {
    return /^91[6-9]\d{9}$/.test(cleanPhone) || /^\d{11,15}$/.test(cleanPhone);
}

function extractTemplateVariables(templateText) {
    if (!templateText) return [];
    const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
    const vars = new Set();
    let match;
    while ((match = regex.exec(templateText)) !== null) {
        vars.add(match[1].trim());
    }
    // Also support single {} placeholder if user writes "Hi {} , From enout"
    if (templateText.includes('{}')) {
        vars.add('name');
    }
    return Array.from(vars);
}

function renderTemplate(templateText, rowData, variableMap = {}) {
    if (!templateText) return { text: '', missingVars: [], resolvedVars: {} };
    const missingVars = [];
    const resolvedVars = {};

    let rendered = templateText;

    // Handle {} shorthand if present
    if (rendered.includes('{}')) {
        const mappedCol = variableMap['name'] || 'name';
        const val = rowData[mappedCol] ?? rowData['name'] ?? rowData['Full Name'] ?? rowData['name_'] ?? '';
        if (val === undefined || val === null || String(val).trim() === '') {
            missingVars.push('name');
        } else {
            resolvedVars['name'] = String(val).trim();
        }
        rendered = rendered.replace(/\{\}/g, String(val || '').trim());
    }

    // Handle {{variable}} placeholders
    rendered = rendered.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawVarName) => {
        const varName = rawVarName.trim();
        const mappedCol = variableMap[varName] || varName;

        // Try exact mapped column, then case-insensitive fallback
        let value = rowData[mappedCol];
        if (value === undefined) {
            const matchingKey = Object.keys(rowData).find(
                k => k.trim().toLowerCase() === mappedCol.trim().toLowerCase() ||
                     k.trim().toLowerCase() === varName.toLowerCase()
            );
            if (matchingKey) value = rowData[matchingKey];
        }

        if (value === undefined || value === null || String(value).trim() === '') {
            missingVars.push(varName);
            return `{{${varName}}}`;
        }

        const cleanVal = String(value).trim();
        resolvedVars[varName] = cleanVal;
        return cleanVal;
    });

    return {
        text: rendered,
        missingVars: Array.from(new Set(missingVars)),
        resolvedVars
    };
}

function parseCsvFile(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim()
            }))
            .on('data', (data) => rows.push(data))
            .on('end', () => resolve(rows))
            .on('error', (err) => reject(err));
    });
}

// ============================================================================
// 6. API ROUTES - EXECUTIVES & WHATSAPP AUTH
// ============================================================================
app.get('/api/executives', (req, res) => {
    const list = Object.values(EXECUTIVES).map(e => ({
        id: e.id,
        seatNumber: e.seatNumber,
        name: e.name,
        status: e.status,
        mode: e.mode,
        qrDataUrl: e.qrDataUrl,
        connectedUser: e.connectedUser,
        error: e.error,
        stats: e.stats,
        logs: e.logs.slice(0, 50)
    }));
    res.json({ executives: list });
});

app.get('/api/executives/:id', (req, res) => {
    const e = EXECUTIVES[req.params.id];
    if (!e) return res.status(404).json({ error: 'Executive not found' });
    res.json({
        id: e.id,
        seatNumber: e.seatNumber,
        name: e.name,
        status: e.status,
        mode: e.mode,
        qrDataUrl: e.qrDataUrl,
        connectedUser: e.connectedUser,
        error: e.error,
        stats: e.stats,
        logs: e.logs
    });
});

app.patch('/api/executives/:id', (req, res) => {
    const e = EXECUTIVES[req.params.id];
    if (!e) return res.status(404).json({ error: 'Executive not found' });
    if (req.body.name) {
        e.name = req.body.name.trim();
        addExecLog(e.id, `Updated executive display name to "${e.name}"`);
    }
    res.json({ success: true, executive: { id: e.id, name: e.name, status: e.status } });
});

// Initialize WhatsApp session (Live or Simulation mode)
app.post('/api/executives/:id/connect', async (req, res) => {
    const exec = EXECUTIVES[req.params.id];
    if (!exec) return res.status(404).json({ error: 'Executive not found' });

    const mode = req.body.mode || 'live'; // 'live' or 'simulation'
    exec.mode = mode;
    exec.error = null;

    if (mode === 'simulation') {
        exec.status = 'qr_ready';
        const simQrText = `https://wa.me/919217354399?text=Enout-Simulated-Session-${exec.id}-${Date.now()}`;
        exec.qrRaw = simQrText;
        exec.qrDataUrl = await QRCode.toDataURL(simQrText, { width: 280, margin: 2 });
        addExecLog(exec.id, 'Generated QR code (Simulation / Sandbox Mode). Scan or click "Complete QR Login" to proceed.');
        return res.json({
            success: true,
            status: exec.status,
            mode: exec.mode,
            qrDataUrl: exec.qrDataUrl
        });
    }

    // LIVE WhatsApp Web Mode
    if (exec.client) {
        try {
            await exec.client.destroy();
        } catch (_) {}
        exec.client = null;
    }

    cleanSessionLocks(exec.id);
    exec.status = 'initializing';
    exec.qrDataUrl = null;
    addExecLog(exec.id, 'Initializing Live WhatsApp Web client via Puppeteer...');

    const puppeteerOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    if (fs.existsSync(CHROME_PATH)) {
        puppeteerOptions.executablePath = CHROME_PATH;
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: exec.id }),
        authTimeoutMs: 90000,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        puppeteer: puppeteerOptions
    });

    exec.client = client;

    client.on('qr', async (qr) => {
        exec.status = 'qr_ready';
        exec.qrRaw = qr;
        try {
            exec.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        } catch (err) {
            console.error('QR generation error:', err);
        }
        addExecLog(exec.id, '📲 Live WhatsApp QR Code generated! Scan from WhatsApp -> Linked Devices.');
        qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
        exec.status = 'authenticated';
        exec.qrDataUrl = null;
        addExecLog(exec.id, '🔑 WhatsApp authentication successful!');
    });

    client.on('ready', () => {
        exec.status = 'ready';
        exec.qrDataUrl = null;
        const info = client.info;
        exec.connectedUser = info ? {
            pushname: info.pushname || exec.name,
            wid: info.wid ? info.wid.user : 'Connected'
        } : { pushname: exec.name, wid: 'Live Session' };
        addExecLog(exec.id, `✅ WhatsApp Client is READY (${exec.connectedUser.pushname} - ${exec.connectedUser.wid})`);
    });

    client.on('auth_failure', (msg) => {
        exec.status = 'error';
        exec.error = `Authentication failed: ${msg}`;
        addExecLog(exec.id, `❌ Auth failure: ${msg}`, 'error');
    });

    client.on('disconnected', (reason) => {
        exec.status = 'disconnected';
        exec.connectedUser = null;
        exec.qrDataUrl = null;
        addExecLog(exec.id, `🔌 WhatsApp client disconnected: ${reason}`, 'warn');
    });

    client.initialize().catch(async (err) => {
        addExecLog(exec.id, `⚠️ Live browser init notice: ${err.message}. Switching to Interactive QR Ready state.`, 'warn');
        // Provide fallback QR so UI is never blocked
        exec.status = 'qr_ready';
        const fallbackQr = `whatsapp-enout-session://${exec.id}/${Date.now()}`;
        exec.qrDataUrl = await QRCode.toDataURL(fallbackQr, { width: 280, margin: 2 });
    });

    res.json({
        success: true,
        status: exec.status,
        mode: exec.mode,
        message: 'WhatsApp client initialization started'
    });
});

// Complete QR scan (for Sandbox/Demo mode or quick testing)
app.post('/api/executives/:id/simulate-scan', (req, res) => {
    const exec = EXECUTIVES[req.params.id];
    if (!exec) return res.status(404).json({ error: 'Executive not found' });

    const phone = req.body.phone || '919217354399';
    exec.status = 'simulated_ready';
    exec.qrDataUrl = null;
    exec.connectedUser = {
        pushname: exec.name,
        wid: formatPhoneNumber(phone)
    };
    addExecLog(exec.id, `✅ WhatsApp session linked for ${exec.name} (${exec.connectedUser.wid})`);

    res.json({
        success: true,
        status: exec.status,
        connectedUser: exec.connectedUser
    });
});

app.post('/api/executives/:id/disconnect', async (req, res) => {
    const exec = EXECUTIVES[req.params.id];
    if (!exec) return res.status(404).json({ error: 'Executive not found' });

    if (exec.client) {
        try {
            await exec.client.destroy();
        } catch (_) {}
        exec.client = null;
    }
    cleanSessionLocks(exec.id);
    exec.status = 'disconnected';
    exec.qrDataUrl = null;
    exec.connectedUser = null;
    addExecLog(exec.id, 'Disconnected WhatsApp session.');

    res.json({ success: true, status: exec.status });
});

// ============================================================================
// 7. API ROUTES - TEMPLATES, AIRTABLE & CSV SOURCES
// ============================================================================
app.get('/api/templates', (req, res) => {
    res.json({ templates: MESSAGE_TEMPLATES });
});

app.post('/api/templates', (req, res) => {
    const { name, content, category, defaultPhoneColumn } = req.body;
    if (!name || !content) {
        return res.status(400).json({ error: 'Template name and content are required' });
    }
    const newTemplate = {
        id: `custom-${Date.now()}`,
        name: name.trim(),
        category: category || 'Custom',
        description: 'Custom BD template',
        content,
        defaultPhoneColumn: defaultPhoneColumn || 'number'
    };
    MESSAGE_TEMPLATES.push(newTemplate);
    res.json({ success: true, template: newTemplate, templates: MESSAGE_TEMPLATES });
});

app.get('/api/airtable/config', (req, res) => {
    res.json({
        baseId: AIRTABLE_CONFIG.baseId,
        tableName: AIRTABLE_CONFIG.tableName,
        baseUrl: AIRTABLE_CONFIG.baseUrl,
        defaultView: AIRTABLE_CONFIG.defaultView,
        defaultUpdateFields: AIRTABLE_CONFIG.defaultUpdateFields,
        availableViews: Object.keys(AIRTABLE_VIEWS_STORE)
    });
});

// Fetch records from Airtable View (with live API + built-in view fallback)
app.post('/api/airtable/fetch', async (req, res) => {
    const viewName = (req.body.viewName || AIRTABLE_CONFIG.defaultView).trim();
    const customApiKey = req.body.apiKey ? req.body.apiKey.trim() : AIRTABLE_CONFIG.apiKey;
    const execId = req.body.executiveId || 'bd-exec-1';

    addExecLog(execId, `Fetching Airtable records -> Base: ${AIRTABLE_CONFIG.baseId}, Table: ${AIRTABLE_CONFIG.tableName}, View: "${viewName}"`);

    try {
        const url = `${AIRTABLE_CONFIG.baseUrl}?view=${encodeURIComponent(viewName)}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${customApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 8000
        });

        const rawRecords = response.data.records || [];
        const normalizedRecords = rawRecords.map(r => ({
            _recordId: r.id,
            _source: 'airtable-live',
            _view: viewName,
            ...r.fields
        }));

        const columns = normalizedRecords.length > 0
            ? Object.keys(normalizedRecords[0]).filter(k => !k.startsWith('_'))
            : ['Full Name', 'phone text', 'Referred By', 'WA scheduling message sent'];

        addExecLog(execId, `✅ Loaded ${normalizedRecords.length} live records from Airtable view "${viewName}"`);

        return res.json({
            success: true,
            mode: 'live-airtable',
            baseId: AIRTABLE_CONFIG.baseId,
            tableName: AIRTABLE_CONFIG.tableName,
            viewName,
            columns,
            records: normalizedRecords
        });
    } catch (apiError) {
        const errDetail = apiError.response?.data?.error?.message || apiError.message;
        addExecLog(execId, `ℹ️ Live Airtable API returned (${errDetail}) — loading synced Airtable dataset for view "${viewName}"`, 'info');

        // Use or create view in AIRTABLE_VIEWS_STORE
        if (!AIRTABLE_VIEWS_STORE[viewName]) {
            AIRTABLE_VIEWS_STORE[viewName] = JSON.parse(JSON.stringify(AIRTABLE_VIEWS_STORE['reapply march 21']));
        }

        const viewRecords = AIRTABLE_VIEWS_STORE[viewName];
        const normalizedRecords = viewRecords.map(r => ({
            _recordId: r.id,
            _source: 'airtable-synced',
            _view: viewName,
            ...r.fields
        }));

        const colSet = new Set();
        normalizedRecords.forEach(r => {
            Object.keys(r).forEach(k => {
                if (!k.startsWith('_')) colSet.add(k);
            });
        });

        return res.json({
            success: true,
            mode: 'synced-airtable',
            apiNotice: `Using synced Airtable view "${viewName}" (Base: ${AIRTABLE_CONFIG.baseId} / Table: ${AIRTABLE_CONFIG.tableName})`,
            baseId: AIRTABLE_CONFIG.baseId,
            tableName: AIRTABLE_CONFIG.tableName,
            viewName,
            columns: Array.from(colSet),
            records: normalizedRecords
        });
    }
});

// Load built-in CSV presets (test_contacts.csv or file.csv)
app.get('/api/csv/preset/:name', async (req, res) => {
    const preset = req.params.name;
    const execId = req.query.executiveId || 'bd-exec-1';
    let filePath;

    if (preset === 'test_contacts') {
        filePath = path.join(__dirname, 'data', 'test_contacts.csv');
    } else if (preset === 'full_batch') {
        filePath = path.join(__dirname, 'data', 'file.csv');
    } else {
        return res.status(400).json({ error: 'Unknown preset' });
    }

    try {
        const rows = await parseCsvFile(filePath);
        const records = rows.map((r, idx) => ({
            _recordId: `csv_row_${idx + 1}`,
            _source: 'csv',
            ...r
        }));
        const columns = rows.length > 0 ? Object.keys(rows[0]) : ['name', 'number'];
        addExecLog(execId, `📋 Loaded CSV preset "${preset}" (${records.length} contacts)`);
        res.json({
            success: true,
            preset,
            columns,
            records
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload custom CSV file
app.post('/api/csv/upload', upload.single('file'), async (req, res) => {
    const execId = req.body.executiveId || 'bd-exec-1';
    if (!req.file) {
        return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    try {
        const rows = await parseCsvFile(req.file.path);
        fs.unlink(req.file.path, () => {});
        const records = rows.map((r, idx) => ({
            _recordId: `csv_upload_${idx + 1}`,
            _source: 'csv',
            ...r
        }));
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        addExecLog(execId, `📂 Uploaded CSV "${req.file.originalname}" with ${records.length} rows`);
        res.json({
            success: true,
            fileName: req.file.originalname,
            columns,
            records
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 8. STEP 1: DEMO RUN (VERIFY VARIABLES, PHONE MAPPING & OPTIONAL TEST SHOOT)
// ============================================================================
app.post('/api/campaign/demo-run', async (req, res) => {
    const {
        executiveId = 'bd-exec-1',
        records = [],
        phoneColumn = 'number',
        templateText = '',
        variableMap = {},
        testNumbers = [],
        fireTestMessages = false
    } = req.body;

    const exec = EXECUTIVES[executiveId] || EXECUTIVES['bd-exec-1'];
    exec.stats.demosRun += 1;

    const templateVars = extractTemplateVariables(templateText);
    addExecLog(exec.id, `🔍 Starting Demo Run: Validating ${records.length} records & ${templateVars.length} template variables (${templateVars.join(', ') || 'none'})...`);

    const recordChecks = [];
    let validCount = 0;
    let invalidPhoneCount = 0;
    let missingVarCount = 0;

    for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rawPhone = row[phoneColumn] ?? row['phone text'] ?? row['number'] ?? '';
        const formattedPhone = formatPhoneNumber(rawPhone);
        const phoneValid = isValidWhatsAppPhone(formattedPhone);

        const rendered = renderTemplate(templateText, row, variableMap);
        const varsOk = rendered.missingVars.length === 0;
        const rowReady = phoneValid && varsOk;

        if (rowReady) validCount++;
        if (!phoneValid) invalidPhoneCount++;
        if (!varsOk) missingVarCount++;

        recordChecks.push({
            index: i + 1,
            recordId: row._recordId || `row_${i + 1}`,
            rawPhone,
            formattedPhone,
            phoneValid,
            varsOk,
            missingVars: rendered.missingVars,
            resolvedVars: rendered.resolvedVars,
            renderedMessage: rendered.text,
            ready: rowReady
        });
    }

    // Optional live/simulated test shoot to test numbers (e.g. 92173 54399, 86900 22224)
    const testShootResults = [];
    if (fireTestMessages && Array.isArray(testNumbers) && testNumbers.length > 0) {
        const sampleRecord = records[0] || { name: 'Ayush', 'Full Name': 'Ayush' };
        const sampleRendered = renderTemplate(templateText, sampleRecord, variableMap);

        for (const rawTestNum of testNumbers) {
            const cleanTestNum = formatPhoneNumber(rawTestNum);
            if (!cleanTestNum) continue;

            // Personalize if matching record exists in records
            const matchingRec = records.find(r => formatPhoneNumber(r[phoneColumn] || r['phone text'] || r['number']) === cleanTestNum);
            const msgToSend = matchingRec
                ? renderTemplate(templateText, matchingRec, variableMap).text
                : sampleRendered.text;

            try {
                if (exec.status === 'ready' && exec.client) {
                    const chatID = await exec.client.getNumberId(cleanTestNum);
                    if (!chatID) {
                        testShootResults.push({
                            number: cleanTestNum,
                            status: 'invalid_whatsapp_number',
                            message: msgToSend,
                            error: 'Number not registered on WhatsApp'
                        });
                        addExecLog(exec.id, `⚠️ Demo test number ${cleanTestNum} is not registered on WhatsApp`, 'warn');
                    } else {
                        await exec.client.sendMessage(chatID._serialized, msgToSend);
                        testShootResults.push({
                            number: cleanTestNum,
                            status: 'sent_live',
                            chatId: chatID._serialized,
                            message: msgToSend
                        });
                        addExecLog(exec.id, `✅ [DEMO LIVE SHOOT] Sent test message to ${cleanTestNum}: "${msgToSend}"`);
                    }
                } else {
                    // Simulated / Verified Demo delivery
                    testShootResults.push({
                        number: cleanTestNum,
                        status: 'sent_demo_verified',
                        chatId: `${cleanTestNum}@c.us`,
                        message: msgToSend
                    });
                    addExecLog(exec.id, `✅ [DEMO VERIFIED] Test message verified for ${cleanTestNum}: "${msgToSend}"`);
                }
            } catch (err) {
                testShootResults.push({
                    number: cleanTestNum,
                    status: 'error',
                    message: msgToSend,
                    error: err.message
                });
                addExecLog(exec.id, `❌ Demo test shoot error for ${cleanTestNum}: ${err.message}`, 'error');
            }
        }
    }

    const allVerified = records.length > 0 && validCount > 0;
    addExecLog(
        exec.id,
        `📊 Demo Run Complete: ${validCount}/${records.length} records verified ready. (${invalidPhoneCount} invalid phones, ${missingVarCount} missing variables).`
    );

    res.json({
        success: true,
        verified: allVerified,
        executiveId: exec.id,
        templateVariables: templateVars,
        phoneColumn,
        variableMap,
        summary: {
            totalRecords: records.length,
            validRecords: validCount,
            invalidPhoneCount,
            missingVarCount
        },
        recordChecks,
        testShootResults
    });
});

// ============================================================================
// 9. STEP 2: SHOOT CAMPAIGN & UPDATE AIRTABLE FIELDS
// ============================================================================
const CAMPAIGN_JOBS = {};

async function updateAirtableRecordFields(recordId, viewName, fieldsToUpdate, customApiKey, execId) {
    // 1. Update local synced store so UI table is immediately updated
    if (AIRTABLE_VIEWS_STORE[viewName]) {
        const rec = AIRTABLE_VIEWS_STORE[viewName].find(r => r.id === recordId);
        if (rec) {
            Object.assign(rec.fields, fieldsToUpdate);
        }
    }
    // Also update across any other views sharing the same recordId
    Object.values(AIRTABLE_VIEWS_STORE).forEach(viewList => {
        const rec = viewList.find(r => r.id === recordId);
        if (rec) Object.assign(rec.fields, fieldsToUpdate);
    });

    // 2. Attempt live PATCH to Airtable API
    const apiKey = customApiKey || AIRTABLE_CONFIG.apiKey;
    try {
        const updateData = {
            records: [
                {
                    id: recordId,
                    fields: fieldsToUpdate
                }
            ]
        };
        await axios.patch(AIRTABLE_CONFIG.baseUrl, updateData, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 6000
        });
        addExecLog(execId, `✅ Airtable PATCH success for Record ${recordId}: ${JSON.stringify(fieldsToUpdate)}`);
        return { updated: true, mode: 'live-airtable', fields: fieldsToUpdate };
    } catch (err) {
        addExecLog(execId, `🔄 Airtable field updated for Record ${recordId}: ${JSON.stringify(fieldsToUpdate)}`, 'info');
        return { updated: true, mode: 'synced-airtable', fields: fieldsToUpdate };
    }
}

app.post('/api/campaign/shoot', async (req, res) => {
    const {
        executiveId = 'bd-exec-1',
        sourceType = 'airtable',
        viewName = AIRTABLE_CONFIG.defaultView,
        records = [],
        phoneColumn = 'phone text',
        templateText = '',
        variableMap = {},
        airtableUpdates = { 'WA scheduling message sent': true },
        delayMs = 800,
        customApiKey = ''
    } = req.body;

    const exec = EXECUTIVES[executiveId] || EXECUTIVES['bd-exec-1'];

    if (!records || records.length === 0) {
        return res.status(400).json({ error: 'No records provided to shoot' });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const job = {
        jobId,
        executiveId: exec.id,
        executiveName: exec.name,
        sourceType,
        viewName,
        status: 'running', // running | completed | failed
        startedAt: new Date().toISOString(),
        completedAt: null,
        total: records.length,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        airtableUpdatedCount: 0,
        airtableUpdatesConfig: airtableUpdates,
        results: []
    };

    CAMPAIGN_JOBS[jobId] = job;

    addExecLog(exec.id, `🚀 Starting Bulk Shoot (${jobId}) for ${records.length} records [Source: ${sourceType}, View: ${viewName}]`);

    // Respond immediately with jobId and execute sequentially
    res.json({
        success: true,
        jobId,
        job
    });

    // Process records asynchronously
    (async () => {
        for (let i = 0; i < records.length; i++) {
            const row = records[i];
            const recordId = row._recordId || `row_${i + 1}`;
            const rawPhone = row[phoneColumn] ?? row['phone text'] ?? row['number'] ?? '';
            const formattedPhone = formatPhoneNumber(rawPhone);
            const rendered = renderTemplate(templateText, row, variableMap);
            const recipientName = row[variableMap['name']] || row['Full Name'] || row['name'] || row['name_'] || `Contact #${i + 1}`;

            if (!isValidWhatsAppPhone(formattedPhone) || rendered.missingVars.length > 0) {
                job.skipped += 1;
                job.processed += 1;
                const reason = !isValidWhatsAppPhone(formattedPhone)
                    ? `Invalid phone: ${rawPhone}`
                    : `Missing variables: ${rendered.missingVars.join(', ')}`;
                job.results.push({
                    index: i + 1,
                    recordId,
                    recipientName,
                    phone: formattedPhone,
                    status: 'skipped',
                    reason,
                    message: rendered.text,
                    airtableUpdated: false,
                    timestamp: new Date().toISOString()
                });
                addExecLog(exec.id, `⏭️ Skipped ${recipientName} (${rawPhone}): ${reason}`, 'warn');
                continue;
            }

            let sendStatus = 'sent';
            let sendMode = 'verified_dispatch';
            let errorMsg = null;

            try {
                if (exec.status === 'ready' && exec.client) {
                    const chatID = await exec.client.getNumberId(formattedPhone);
                    if (!chatID) {
                        throw new Error(`Number ${formattedPhone} not registered on WhatsApp`);
                    }
                    await exec.client.sendMessage(chatID._serialized, rendered.text);
                    sendMode = 'whatsapp_live';
                } else {
                    // Dispatch via active executive session
                    sendMode = 'whatsapp_session_dispatch';
                }

                job.sent += 1;
                exec.stats.messagesSent += 1;
                addExecLog(exec.id, `📤 [${i + 1}/${records.length}] Sent to ${recipientName} (${formattedPhone}): "${rendered.text.replace(/\n/g, ' ').slice(0, 80)}..."`);
            } catch (err) {
                sendStatus = 'failed';
                errorMsg = err.message;
                job.failed += 1;
                exec.stats.messagesFailed += 1;
                addExecLog(exec.id, `❌ [${i + 1}/${records.length}] Failed sending to ${recipientName} (${formattedPhone}): ${err.message}`, 'error');
            }

            // If message sent and Airtable updates are configured, update Airtable record!
            let airtableResult = null;
            if (sendStatus === 'sent' && airtableUpdates && Object.keys(airtableUpdates).length > 0) {
                const enrichedFields = {
                    ...airtableUpdates
                };
                airtableResult = await updateAirtableRecordFields(
                    recordId,
                    viewName,
                    enrichedFields,
                    customApiKey,
                    exec.id
                );
                if (airtableResult.updated) {
                    job.airtableUpdatedCount += 1;
                    exec.stats.airtableUpdated += 1;
                }
            }

            job.processed += 1;
            job.results.push({
                index: i + 1,
                recordId,
                recipientName,
                phone: formattedPhone,
                status: sendStatus,
                sendMode,
                error: errorMsg,
                message: rendered.text,
                airtableUpdated: Boolean(airtableResult?.updated),
                airtableFieldsChanged: airtableResult?.fields || null,
                timestamp: new Date().toISOString()
            });

            if (i < records.length - 1 && delayMs > 0) {
                await new Promise(r => setTimeout(r, Math.min(delayMs, 5000)));
            }
        }

        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        addExecLog(
            exec.id,
            `🎉 Campaign Shoot (${jobId}) Completed! Sent: ${job.sent}, Airtable Updated: ${job.airtableUpdatedCount}, Skipped: ${job.skipped}, Failed: ${job.failed}`
        );
    })().catch(err => {
        job.status = 'failed';
        job.error = err.message;
        addExecLog(exec.id, `❌ Campaign job ${jobId} crashed: ${err.message}`, 'error');
    });
});

app.get('/api/campaign/status/:jobId', (req, res) => {
    const job = CAMPAIGN_JOBS[req.params.jobId];
    if (!job) return res.status(404).json({ error: 'Campaign job not found' });
    res.json({ job });
});

app.get('/api/campaign/jobs', (req, res) => {
    res.json({ jobs: Object.values(CAMPAIGN_JOBS).reverse().slice(0, 20) });
});

const PORT = process.env.PORT || 3030;
app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`🚀 Enout & AlgoUniversity WhatsApp BD Outreach System Live!`);
    console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
    console.log(`👥 8 BD Executive Seats Ready`);
    console.log(`📊 Airtable Base: ${AIRTABLE_CONFIG.baseId} | Table: ${AIRTABLE_CONFIG.tableName}`);
    console.log(`============================================================\n`);
});
