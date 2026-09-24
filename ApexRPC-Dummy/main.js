const path = require('path');
const fs = require('fs');

// Resolve .env from working directory or .exe directory
const possibleEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(path.dirname(process.execPath), '.env')
];
for (const p of possibleEnvPaths) {
    if (fs.existsSync(p)) {
        require('dotenv').config({ path: p });
        break;
    }
}
require('dotenv').config();

const DiscordRPC = require('discord-rpc');
const SteamUser = require('steam-user');
const prompts = require('prompts');

// Constants
const Translation = require('./Constants/Translation');
const Gallery = require('./Constants/Gallery');
const Termination = require('./Constants/Termination');

// Configurations
const DUMMY_USERNAME = (process.env.DUMMY_STEAM_USERNAME || '').trim();
const DUMMY_PASSWORD = (process.env.DUMMY_STEAM_PASSWORD || '').trim();
const MAIN_STEAM_ID64 = (process.env.MAIN_STEAM_ID64 || '').trim();
const SERVER_NAME = (process.env.PLAYING_ON_SERVER || 'Singapore').trim();
const AUTO_DETECT_SERVER = String(process.env.AUTO_DETECT_SERVER || 'true').trim().toLowerCase() === 'true';
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '893911040713191444').trim();

// Runtime state
const SteamClient = new SteamUser();
const RPC = new DiscordRPC.Client({ transport: 'ipc' });
let discordReady = false;
let startTimestamp = null;
let friendIsPlaying = false;

function log(level, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
}

function getRichPresenceField(richPresence, key) {
    return richPresence.find(d => d.key && d.key.toLowerCase() === key.toLowerCase());
}

function detectServerFromRichPresence(richPresence) {
    const exactKeys = ['server', 'server_name', 'server_region', 'region', 'datacenter', 'data_center', 'cluster', 'location'];
    for (const key of exactKeys) {
        const field = getRichPresenceField(richPresence, key);
        if (field && field.value) return field.value.trim();
    }
    return null;
}

function normalizeLevelKey(levelValue) {
    if (!levelValue || typeof levelValue !== 'string') return null;
    let normalized = levelValue.toLowerCase();
    if (Translation[normalized]) return normalized;

    const suffixPatterns = [/_mu\d+$/, /_hu$/, /_desc$/, /_night\d*$/, /_holiday$/, /_64k$/, /_s\d+$/, /_ltm\d*$/, /_event\d*$/, /_takeover\d*$/];
    let changed = true;
    while (changed) {
        changed = false;
        for (const pattern of suffixPatterns) {
            if (pattern.test(normalized)) {
                normalized = normalized.replace(pattern, '');
                changed = true;
            }
        }
        for (const token of Termination) {
            const suffix = `_${token}`;
            if (normalized.endsWith(suffix)) {
                normalized = normalized.slice(0, -suffix.length);
                changed = true;
                break;
            }
        }
    }
    return normalized || null;
}

async function loginDiscordRpc() {
    if (discordReady) return;
    try {
        await RPC.login({ clientId: DISCORD_CLIENT_ID });
        discordReady = true;
        log('info', 'Connected to Discord RPC.');
    } catch (err) {
        log('warn', `Failed to connect Discord RPC: ${err.message}`);
    }
}

async function clearDiscordActivity() {
    if (discordReady) {
        try {
            await RPC.clearActivity();
            startTimestamp = null;
            friendIsPlaying = false;
            log('info', 'Friend stopped playing. Discord activity cleared.');
        } catch (_) {}
    }
}

function handleRichPresence(richPresence) {
    const statusField = getRichPresenceField(richPresence, 'status');
    const groupSizeField = getRichPresenceField(richPresence, 'steam_player_group_size');
    const mapField = getRichPresenceField(richPresence, 'map');
    const playlistField = getRichPresenceField(richPresence, 'playlist');

    const detectedServer = AUTO_DETECT_SERVER ? detectServerFromRichPresence(richPresence) : null;
    const activeServer = detectedServer || SERVER_NAME;

    let details = 'Playing Apex Legends';
    if (statusField && statusField.value) {
        const rawStatus = statusField.value.trim();
        details = Translation[rawStatus] || rawStatus;
    }

    let state = `${activeServer} | In Game`;
    if (playlistField && playlistField.value) {
        const rawMode = playlistField.value.trim();
        const modeLabel = Translation[rawMode] || rawMode;
        state = `${activeServer} | ${modeLabel}`;
    }

    let largeImageKey = 'apex-legends';
    let largeImageText = 'Apex Legends';

    if (mapField && mapField.value) {
        const rawMap = mapField.value.trim();
        const normalizedMap = normalizeLevelKey(rawMap);
        largeImageKey = Gallery[rawMap] || Gallery[normalizedMap] || 'apex-legends';
        largeImageText = Translation[rawMap] || Translation[normalizedMap] || rawMap;
    }

    if (!startTimestamp) {
        startTimestamp = new Date();
    }

    const activity = {
        details: details,
        state: state,
        startTimestamp: startTimestamp,
        largeImageKey: largeImageKey,
        largeImageText: largeImageText,
        smallImageKey: 'apex-legends',
        smallImageText: `Server: ${activeServer}`,
        instance: false
    };

    if (groupSizeField && parseInt(groupSizeField.value, 10) > 0) {
        activity.partySize = parseInt(groupSizeField.value, 10);
        activity.partyMax = 3;
    }

    RPC.setActivity(activity).then(() => {
        log('info', `Presence updated from Main Account: ${details} (${state})`);
    }).catch(err => {
        log('error', `SetActivity error: ${err.message}`);
    });
}

// -------------------------------------------------------------
// Steam Events
// -------------------------------------------------------------
SteamClient.on('loggedOn', () => {
    log('info', `Dummy Account logged in: ${SteamClient.steamID.getSteamID64()}`);
    SteamClient.setPersona(SteamUser.EPersonaState.Online);
    loginDiscordRpc();

    if (MAIN_STEAM_ID64) {
        log('info', `Subscribing to Rich Presence of Main Account (${MAIN_STEAM_ID64})...`);
        SteamClient.getPersonas([MAIN_STEAM_ID64]);

        // Keep polling friend persona periodically
        setInterval(() => {
            if (SteamClient.steamID) {
                SteamClient.getPersonas([MAIN_STEAM_ID64]).catch(() => {});
            }
        }, 30000);
    }
});

SteamClient.on('steamGuard', async (domain, callback) => {
    const response = await prompts({ type: 'text', name: 'code', message: 'Enter Steam Guard Code: ' });
    if (!response || !response.code) {
        SteamClient.logOff();
        log('error', 'No Steam Guard code entered.');
        return;
    }
    callback(response.code);
});

SteamClient.on('user', (sID, user) => {
    if (!MAIN_STEAM_ID64 || sID.getSteamID64() !== MAIN_STEAM_ID64) return;

    const isPlayingApex = user.gameid == 1172470 || (user.rich_presence && user.rich_presence.length > 0);

    if (isPlayingApex) {
        if (!friendIsPlaying) {
            friendIsPlaying = true;
            log('info', `Main Account (${user.player_name || MAIN_STEAM_ID64}) started playing Apex Legends!`);
            loginDiscordRpc();
        }
        if (user.rich_presence && user.rich_presence.length > 0) {
            handleRichPresence(user.rich_presence);
        }
    } else if (friendIsPlaying) {
        clearDiscordActivity();
    }
});

SteamClient.on('error', (err) => {
    log('error', `Steam connection error: ${err.message}`);
});

// -------------------------------------------------------------
// Startup
// -------------------------------------------------------------
async function start() {
    console.clear();
    console.log('======================================================');
    console.log('            ApexRPC - Dummy Account Mode              ');
    console.log('======================================================');
    console.log(' Main Account Protected 100% (No main credentials)   ');
    console.log(` Target Main Account : ${MAIN_STEAM_ID64 || 'NOT SET (check .env)'}`);
    console.log(` Server Region       : ${SERVER_NAME}`);
    console.log('======================================================\n');

    if (!DUMMY_USERNAME || !DUMMY_PASSWORD) {
        log('error', 'DUMMY_STEAM_USERNAME and DUMMY_STEAM_PASSWORD must be set in .env!');
        log('info', 'Please edit .env with your dummy account credentials.');
        return;
    }

    if (!MAIN_STEAM_ID64) {
        log('warn', 'MAIN_STEAM_ID64 is not set in .env! Cannot track main account.');
        log('info', 'Please find your SteamID64 at https://steamid.io and put it in .env');
        return;
    }

    log('info', `Logging into Steam as dummy account: ${DUMMY_USERNAME}...`);
    SteamClient.logOn({
        accountName: DUMMY_USERNAME,
        password: DUMMY_PASSWORD
    });
}

process.on('SIGINT', async () => {
    log('info', 'Shutting down...');
    await clearDiscordActivity();
    if (SteamClient) SteamClient.logOff();
    process.exit(0);
});

start();
