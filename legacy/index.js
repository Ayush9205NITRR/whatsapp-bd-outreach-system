const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Airtable API Configuration
const AIRTABLE_BASE_URL = "https://api.airtable.com/v0/appxUfmx7hibOaBNb/Main";
const AIRTABLE_VIEW = "reapply march 21";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "YOUR_AIRTABLE_API_KEY";

const headers = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json"
};

// Initialize WhatsApp Client
const client = new Client({ authStrategy: new LocalAuth({clientId: 'client-one'}), puppeteer: {path:"/Applications/Google\ Chrome.app", headless: true, args: [ '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', ], } });

// Generate QR Code for WhatsApp Login
client.on('qr', qr => {
    console.log('QR RECEIVED');
    qrcode.generate(qr, { small: true });
});

// WhatsApp Client Ready
client.on('ready', async () => {
    console.log('Client is ready!');
    await sendMessages();
});

// Function to fetch records from Airtable
async function fetchAirtableRecords() {
    try {
        const response = await axios.get(`${AIRTABLE_BASE_URL}?view=${AIRTABLE_VIEW}`, { headers });
        return response.data.records;
    } catch (error) {
        console.error("Error fetching data from Airtable:", error.response?.data || error.message);
        return [];
    }
}

// Function to send WhatsApp Messages
async function sendMessages() {
    const records = await fetchAirtableRecords();

    for (const record of records) {
        const fields = record.fields;
        const phoneNumber = fields["phone text"];
        const name = fields["Full Name"]; 
        const referred_by = fields["Referred By"]
        // const rank = fields["college_wise_rank"];
        // const scholarship = fields["GC_Scholarship"]// Adjust column name if different
        const recordId = record.id;

        if (!phoneNumber || !name) {
            console.log(`Skipping record ${recordId}: Missing phone number or name.`);
            continue;
        }

        let chatID = await client.getNumberId(phoneNumber);
        if (!chatID) {
            console.log(`Invalid number: ${phoneNumber}`);
            continue;
        }

        console.log(`Sending message to ${name} (${phoneNumber})...`);

        try {
            const message = `Hi ${name}, this is Nirupam from AlgoUniversity. 👋🏻

We’ve received your application for the ⛺ *Accelerator Camp* and I’m happy to inform you that _you’ve cleared the initial shortlisting!_ We’d like to move forward with the mentor interview to *evaluate your fit for the camp*. 

Please prepare these questions beforehand for the _screening round_ :
1. What’s your motivation for joining the Accelerator Camp?
2. Why do you believe you deserve a seat in the camp?

👉 _*Check Camp Details:*_ ng.tinyc.co/acceleratorCampDetails 🔗

We have 5 available slots for the screening call between *6:45–7:30 PM today*. Kindly confirm your availability!`;

            await client.sendMessage(chatID._serialized, message);
            console.log(`Message sent to ${name}`);

            // Update Airtable to mark message as sent
            await updateAirtableRecord(recordId);

        } catch (error) {
            console.error(`Failed to send message to ${name}:`, error.message);
        }

        await new Promise(resolve => setTimeout(resolve, 500)); // Delay between messages
    }
}

// Function to update Airtable record
async function updateAirtableRecord(recordId) {
    try {
        const updateData = {
            records: [{
                id: recordId,
                fields: { "WA scheduling message sent": true } // Adjust field name as needed
            }]
        };

        const response = await axios.patch(AIRTABLE_BASE_URL, updateData, { headers });
        console.log(`✅ Airtable updated for Record ID: ${recordId}`);
    } catch (error) {
        console.error(`❌ Failed to update Airtable record ${recordId}:`, error.response?.data || error.message);
    }
}

// Initialize WhatsApp Client
client.initialize();
