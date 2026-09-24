// Map asset mapping and CDN fallbacks
const MAP_ASSETS = {
    "kings canyon": {
        key: "kings-canyon",
        displayName: "Kings Canyon",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Kings_Canyon.png"
    },
    "world's edge": {
        key: "world-edge",
        displayName: "World's Edge",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Worlds_Edge.png"
    },
    "worlds edge": {
        key: "world-edge",
        displayName: "World's Edge",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Worlds_Edge.png"
    },
    "olympus": {
        key: "olympus",
        displayName: "Olympus",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Olympus.png"
    },
    "storm point": {
        key: "stormpoint",
        displayName: "Storm Point",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Storm_Point.png"
    },
    "broken moon": {
        key: "broken-moon",
        displayName: "Broken Moon",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Broken_Moon.png"
    },
    "e-district": {
        key: "e-district",
        displayName: "E-District",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/EDistrict.png"
    },
    "edistrict": {
        key: "e-district",
        displayName: "E-District",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/EDistrict.png"
    },
    "firing range": {
        key: "firing-range",
        displayName: "Firing Range",
        fallbackUrl: "https://images.apexlegendsstatus.com/maps/Firing_Range.png"
    }
};

function resolveMapInfo(mapName, apiAssetUrl) {
    if (!mapName || typeof mapName !== 'string') {
        return {
            name: "Apex Legends",
            imageKey: "apex-legends",
            assetUrl: null
        };
    }

    const normalized = mapName.trim().toLowerCase();
    const match = MAP_ASSETS[normalized];

    if (match) {
        return {
            name: match.displayName,
            imageKey: match.key,
            assetUrl: apiAssetUrl || match.fallbackUrl
        };
    }

    // Generic fallback for new or unknown maps
    return {
        name: mapName,
        imageKey: "apex-legends",
        assetUrl: apiAssetUrl || null
    };
}

module.exports = {
    MAP_ASSETS,
    resolveMapInfo
};
