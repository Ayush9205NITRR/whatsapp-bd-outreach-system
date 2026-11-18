const {Client, LocalAuth, MessageMedia} = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const csv = require('csv-parser');

const SESSION_FILE_PATH = './session.json';
let sessionData;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = require(SESSION_FILE_PATH);
}

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client-one' }),
});

function getMessage(name) {
    const params = Array.from(arguments);

    const hasNullOrUndefined = params.some(param => param === undefined || param === null);

    if (hasNullOrUndefined) {
        console.log("Params is undefined", params);
        return undefined;
    }

    return `Hi ${name}, this is Nirupam from AlgoUniversity. 👋🏻

We’ve received your application for the ⛺ *Accelerator Camp* and I’m happy to inform you that you’re in the _top 5% of applicants!_ We’d like to move forward with the mentor interview to *evaluate your fit for the camp*. 

👉 _*Camp Details*_  ng.tinyc.co/acceleratorCampDetails 🔗

I’ve attached the detailed camp structure and I’ll call you today to collect your technical profiles and schedule your mentor interview.

*Can you confirm if you're available* for a quick 10 min call now?`;
}

function MySleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeColumnName(columnName) {
    return columnName.trim().toLowerCase();
}

function logHeaders(firstRow) {
    console.log('Available columns:', Object.keys(firstRow));
}

async function getMessageWithMedia(name, mediaPath) {
    const message = getMessage(name);
    const media = await loadMedia(mediaPath);
    if (!media) {
        return { error: 'Failed to load media' };
    }
    return { message, media };
}

async function loadMedia(mediaPath) {
    try {
        const fileData = fs.readFileSync(mediaPath, { encoding: 'base64' });
        const fileType = mediaPath.split('.').pop();

        return new MessageMedia(`image/${fileType}`, fileData);
    } catch (error) {
        console.error('Error loading media:', error);
        return null;
    }
}


async function sendMessageWithMedia(client, chatID, name, mediaPath) {
    const { message, media, error } = await getMessageWithMedia(name, mediaPath);

    if (error) {
        console.error(error);
        return;
    }

    try {
        await client.sendMessage(chatID, media, { caption: message });
        console.log(`Message with media sent to ${name}`);
    } catch (err) {
        console.error('Failed to send message with media:', err);
    }
}

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, {small: true});
});

client.on('ready', async () => {
    console.log('Client is ready!');

    const rows = [];

    fs.createReadStream('file.csv')
        .pipe(csv({ skipLines: 0, separator: ',', mapHeaders: ({ header }) => normalizeColumnName(header) }))
        .on('data', (row) => {
            if (rows.length === 0) {
                console.log('First row structure:', row);
                logHeaders(row);
            }
            rows.push(row);
        })
        .on('end', async () => {
            console.log('CSV file successfully processed');

            for (const row of rows) {
                let number = row['number'];
                number = number.replace(/\D/g, '');
                const name = row['name'];
                // const msg = row['message'];

                const chatID = await client.getNumberId(number);
                console.log(`Sending message to ${JSON.stringify(row)}`);

                await MySleep(2000);
                try {
                    const message = getMessage(name)
                    if (!message) {
                        console.log("Message is undefined");
                        continue;
                    }

                    // message with no media
                    await client.sendMessage(chatID._serialized, message);

                    // message with media
                    // await sendMessageWithMedia(client, chatID._serialized, name, 'img.png');

                    console.log(`Message sent to ${JSON.stringify(row)}`);
                } catch (error) {
                    console.error(error);
                }
            }
        });
});

client.initialize().then(r => console.log("Client initialized")).catch(error => console.log(error));