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
const find = require('find-process');
const { resolveMapInfo } = require('./constants/maps');

// -------------------------------------------------------------
// Configurations
// -------------------------------------------------------------
const SERVER_NAME = (process.env.PLAYING_ON_SERVER || 'Singapore').trim();
const DEFAULT_MODE = (process.env.DEFAULT_MODE || 'ranked').trim().toLowerCase();
const ALS_API_KEY = (process.env.ALS_API_KEY || '').trim();
const FALLBACK_MAP = (process.env.FALLBACK_MAP || "World's Edge").trim();
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '893911040713191444').trim();
const PROCESS_POLL_INTERVAL = parseInt(process.env.PROCESS_POLL_INTERVAL_MS, 10) || 5000;
const MAP_POLL_INTERVAL = parseInt(process.env.MAP_POLL_INTERVAL_MS, 10) || 120000;

// Helper: HTTP GET JSON compatible with all Node versions
function requestJson(url) {
    if (typeof fetch === 'function') {
        return fetch(url, { headers: { 'User-Agent': 'ApexRPC-Zero/1.0' } }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }

    return new Promise((resolve, reject) => {
        const https = require('https');
        https.get(url, { headers: { 'User-Agent': 'ApexRPC-Zero/1.0' } }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// -------------------------------------------------------------
// Runtime State
// -------------------------------------------------------------
let rpc = null;
let isDiscordReady = false;
let isApexRunning = false;
let gameStartTime = null;
let currentMapData = null;
let mapPollTimer = null;
let processPollTimer = null;

// Helper: formatted log
function log(level, message) {
    const time = new Date().toLocaleTimeString();
    const tag = `[${time}] [${level.toUpperCase()}]`;
    console.log(`${tag} ${message}`);
}

// Format Mode Label for display
function getModeLabel(mode) {
    switch (mode) {
        case 'ranked':
            return 'Ranked';
        case 'mixtape':
        case 'ltm':
            return 'Mixtape';
        case 'pubs':
        case 'trios':
        case 'duos':
        default:
            return 'Trios (Pubs)';
    }
}

// -------------------------------------------------------------
// Map Fetching (Apex Legends Status API / Fallback)
// -------------------------------------------------------------
async function fetchMapRotation() {
    if (!ALS_API_KEY) {
        return {
            mapName: FALLBACK_MAP,
            assetUrl: null,
            remainingTimer: null
        };
    }

    try {
        const url = `https://api.mozambiquehe.re/maprotation?version=2&auth=${ALS_API_KEY}`;
        const data = await requestJson(url);
        let targetData = null;

        if (DEFAULT_MODE === 'ranked' && data.ranked?.current) {
            targetData = data.ranked.current;
        } else if ((DEFAULT_MODE === 'mixtape' || DEFAULT_MODE === 'ltm') && data.ltm?.current) {
            targetData = data.ltm.current;
        } else if (data.battle_royale?.current) {
            targetData = data.battle_royale.current;
        }

        if (targetData && targetData.map) {
            return {
                mapName: targetData.map,
                assetUrl: targetData.asset || null,
                remainingTimer: targetData.remainingTimer || null
            };
        }
    } catch (err) {
        log('warn', `Failed to fetch map rotation: ${err.message}. Using fallback map.`);
    }

    return {
        mapName: FALLBACK_MAP,
        assetUrl: null,
        remainingTimer: null
    };
}

// -------------------------------------------------------------
// Discord RPC Connection
// -------------------------------------------------------------
async function initDiscordRpc() {
    if (rpc && isDiscordReady) {
        return true;
    }

    return new Promise((resolve) => {
        try {
            rpc = new DiscordRPC.Client({ transport: 'ipc' });

            rpc.on('ready', () => {
                isDiscordReady = true;
                log('info', `Connected to Discord RPC as ${rpc.user?.username || 'Client'}`);
                resolve(true);
            });

            rpc.on('disconnected', () => {
                isDiscordReady = false;
                log('warn', 'Discord RPC disconnected.');
            });

            rpc.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
                log('warn', `Could not connect to Discord RPC: ${err.message}`);
                isDiscordReady = false;
                resolve(false);
            });
        } catch (err) {
            log('error', `Discord RPC initialization error: ${err.message}`);
            resolve(false);
        }
    });
}

// -------------------------------------------------------------
// Discord Activity Updater
// -------------------------------------------------------------
async function updateDiscordActivity() {
    if (!rpc || !isDiscordReady || !isApexRunning) {
        return;
    }

    const modeLabel = getModeLabel(DEFAULT_MODE);
    const mapInfo = resolveMapInfo(currentMapData?.mapName, currentMapData?.assetUrl);

    try {
        await rpc.setActivity({
            details: `Playing ${modeLabel}: ${mapInfo.name}`,
            state: `${SERVER_NAME} | In Game`,
            startTimestamp: gameStartTime,
            largeImageKey: mapInfo.assetUrl || mapInfo.imageKey,
            largeImageText: mapInfo.name,
            smallImageKey: 'apex-legends',
            smallImageText: `Server: ${SERVER_NAME}`,
            instance: false
        });

        log('info', `Discord Presence updated: [${modeLabel}: ${mapInfo.name}] | ${SERVER_NAME}`);
    } catch (err) {
        log('error', `Failed to update Discord presence: ${err.message}`);
    }
}

async function clearDiscordActivity() {
    if (rpc && isDiscordReady) {
        try {
            await rpc.clearActivity();
            log('info', 'Discord Presence cleared.');
        } catch (err) {
            log('warn', `Failed to clear Discord activity: ${err.message}`);
        }
    }
}

// -------------------------------------------------------------
// Process Polling & Lifecycle
// -------------------------------------------------------------
async function checkApexProcess() {
    try {
        const processes = await find('name', 'r5apex', true);
        const running = processes.length > 0;

        if (running && !isApexRunning) {
            // Game just started
            isApexRunning = true;
            gameStartTime = new Date();
            log('info', `Apex Legends detected! Starting Discord presence...`);

            await initDiscordRpc();
            currentMapData = await fetchMapRotation();
            await updateDiscordActivity();

            // Start periodic map refresh
            if (!mapPollTimer) {
                mapPollTimer = setInterval(async () => {
                    if (isApexRunning) {
                        const newMap = await fetchMapRotation();
                        if (newMap.mapName !== currentMapData?.mapName) {
                            log('info', `Map rotation changed to: ${newMap.mapName}`);
                            currentMapData = newMap;
                            await updateDiscordActivity();
                        }
                    }
                }, MAP_POLL_INTERVAL);
            }
        } else if (!running && isApexRunning) {
            // Game just closed
            isApexRunning = false;
            gameStartTime = null;
            log('info', `Apex Legends closed.`);

            if (mapPollTimer) {
                clearInterval(mapPollTimer);
                mapPollTimer = null;
            }

            await clearDiscordActivity();
        }
    } catch (err) {
        log('error', `Process check error: ${err.message}`);
    }
}

// -------------------------------------------------------------
// App Entrypoint
// -------------------------------------------------------------
async function start() {
    console.clear();
    console.log('======================================================');
    console.log('            ApexRPC - Zero Login Mode                 ');
    console.log('======================================================');
    console.log(` Server Region : ${SERVER_NAME}`);
    console.log(` Default Mode  : ${getModeLabel(DEFAULT_MODE)}`);
    console.log(` Live Map API  : ${ALS_API_KEY ? 'Enabled (ALS API)' : 'Using Fallback (' + FALLBACK_MAP + ')'}`);
    console.log(' Status        : Waiting for Apex Legends (r5apex.exe)...');
    console.log('======================================================\n');

    if (!ALS_API_KEY) {
        log('info', 'Tip: You can add an ALS_API_KEY in .env to get automatic live map rotation.');
    }

    // Check process immediately, then loop
    await checkApexProcess();
    processPollTimer = setInterval(checkApexProcess, PROCESS_POLL_INTERVAL);
}

// Graceful shutdown
process.on('SIGINT', async () => {
    log('info', 'Shutting down ApexRPC-Zero...');
    if (processPollTimer) clearInterval(processPollTimer);
    if (mapPollTimer) clearInterval(mapPollTimer);
    await clearDiscordActivity();
    if (rpc) {
        try { await rpc.destroy(); } catch (_) {}
    }
    process.exit(0);
});

start();
