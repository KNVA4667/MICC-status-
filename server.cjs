const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// MICC FACTION STATUS RELAY
// Made by RobertHarvey
// ============================================================

const app = express();

const PORT = process.env.PORT || 3002;

const MICC_SECRET =
    process.env.MICC_SECRET ||
    "MICC-r8K42-xP91-2026";

const FFSCOUTER_API_KEY =
    String(
        process.env.FFSCOUTER_API_KEY ||
        ""
    ).trim();

const FFSCOUTER_FACTION_ID =
    Number(
        process.env.FFSCOUTER_FACTION_ID ||
        0
    );

const TORN_FACTION_API_KEY =
    String(
        process.env.TORN_FACTION_API_KEY ||
        ""
    ).trim();


const DATA_FILE =
    path.join(__dirname, "micc-status.json");

const CALENDAR_FILE =
    path.join(__dirname, "micc-calendar.json");

const ACTIVITY_FILE =
    path.join(__dirname, "micc-activity.json");

const ARMORY_FILE =
    path.join(__dirname, "micc-armory.json");

const ACTIVITY_BUCKET_MS =
    10 * 60 * 1000;

const ACTIVITY_RETENTION_MS =
    30 * 24 * 60 * 60 * 1000;

const ARMORY_RETENTION_MS =
    30 * 24 * 60 * 60 * 1000;

const CALENDAR_OWNER_ID = "3209900";

const MAX_STATUS_AGE =
    24 * 60 * 60 * 1000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-MICC-Secret"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// ============================================================
// DATABASE
// ============================================================

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return {};
        }

        const raw =
            fs.readFileSync(DATA_FILE, "utf8");

        if (!raw.trim()) {
            return {};
        }

        return JSON.parse(raw);

    } catch (error) {
        console.error(
            "[MICC] Database load error:",
            error
        );

        return {};
    }
}

let database = loadDatabase();

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                database,
                null,
                2
            )
        );

    } catch (error) {
        console.error(
            "[MICC] Database save error:",
            error
        );
    }
}


function loadCalendarDatabase() {
    try {
        if (!fs.existsSync(CALENDAR_FILE)) {
            return {
                events: [],
                notes: [],
                editors: []
            };
        }

        const raw =
            fs.readFileSync(
                CALENDAR_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            return {
                events: [],
                notes: [],
                editors: []
            };
        }

        const parsed =
            JSON.parse(raw);

        return {
            events:
                Array.isArray(parsed.events)
                    ? parsed.events
                    : [],
            notes:
                Array.isArray(parsed.notes)
                    ? parsed.notes
                    : [],
            editors:
                Array.isArray(parsed.editors)
                    ? parsed.editors
                    : []
        };

    } catch (error) {
        console.error(
            "[MICC] Calendar database load error:",
            error
        );

        return {
            events: [],
            notes: [],
            editors: []
        };
    }
}

let calendarDatabase =
    loadCalendarDatabase();

function saveCalendarDatabase() {
    try {
        fs.writeFileSync(
            CALENDAR_FILE,
            JSON.stringify(
                calendarDatabase,
                null,
                2
            )
        );

    } catch (error) {
        console.error(
            "[MICC] Calendar database save error:",
            error
        );
    }
}


function loadActivityDatabase() {
    try {
        if (!fs.existsSync(ACTIVITY_FILE)) {
            return {
                members: {}
            };
        }

        const raw =
            fs.readFileSync(
                ACTIVITY_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            return {
                members: {}
            };
        }

        const parsed =
            JSON.parse(raw);

        return {
            members:
                parsed?.members &&
                typeof parsed.members ===
                    "object"
                    ? parsed.members
                    : {}
        };
    } catch (error) {
        console.error(
            "[MICC] Activity database load error:",
            error
        );

        return {
            members: {}
        };
    }
}

let activityDatabase =
    loadActivityDatabase();

function saveActivityDatabase() {
    try {
        fs.writeFileSync(
            ACTIVITY_FILE,
            JSON.stringify(
                activityDatabase,
                null,
                2
            )
        );
    } catch (error) {
        console.error(
            "[MICC] Activity database save error:",
            error
        );
    }
}

function pruneActivityDatabase(now = Date.now()) {
    const cutoff =
        now - ACTIVITY_RETENTION_MS;

    let changed = false;

    for (
        const [id, member]
        of Object.entries(
            activityDatabase.members
        )
    ) {
        const before =
            Array.isArray(
                member.observations
            )
                ? member.observations
                : [];

        const after =
            before.filter(
                observation =>
                    Number(
                        observation.ts || 0
                    ) >= cutoff
            );

        if (
            after.length !==
            before.length
        ) {
            changed = true;
        }

        member.observations = after;

        if (!after.length) {
            delete activityDatabase
                .members[id];

            changed = true;
        }
    }

    if (changed) {
        saveActivityDatabase();
    }
}

function normalizeActivityStatus(value) {
    const status =
        String(value || "")
            .trim()
            .toLowerCase();

    if (status === "online") {
        return "online";
    }

    if (status === "idle") {
        return "idle";
    }

    return "offline";
}

function normalizeBooleanOrNull(value) {
    if (value === true) {
        return true;
    }

    if (value === false) {
        return false;
    }

    return null;
}

function buildActivityMemberSummary(
    member,
    since,
    now
) {
    const observations =
        (Array.isArray(
            member.observations
        )
            ? member.observations
            : []
        )
            .filter(
                observation =>
                    Number(
                        observation.ts || 0
                    ) >= since
            )
            .sort(
                (a, b) =>
                    Number(a.ts || 0) -
                    Number(b.ts || 0)
            );

    if (!observations.length) {
        return null;
    }

    let online = 0;
    let idle = 0;
    let offline = 0;
    let lastSeen = 0;

    const activeDates =
        new Set();

    const sampledDates =
        new Set();

    const activeHourCounts =
        new Array(24).fill(0);

    const uniqueActionChanges =
        new Set();

    const last24Cutoff =
        now - 24 * 60 * 60 * 1000;

    let last24Samples = 0;
    let last24Active = 0;

    for (
        const observation
        of observations
    ) {
        const ts =
            Number(
                observation.ts || 0
            );

        if (!ts) {
            continue;
        }

        const status =
            normalizeActivityStatus(
                observation.status
            );

        const date =
            new Date(ts);

        const dateKey =
            date
                .toISOString()
                .slice(0, 10);

        sampledDates.add(
            dateKey
        );

        const active =
            status === "online" ||
            status === "idle";

        if (status === "online") {
            online += 1;
        } else if (status === "idle") {
            idle += 1;
        } else {
            offline += 1;
        }

        if (active) {
            activeDates.add(
                dateKey
            );

            activeHourCounts[
                date.getUTCHours()
            ] += 1;

            lastSeen =
                Math.max(
                    lastSeen,
                    ts
                );
        }

        const actionTs =
            Number(
                observation.lastActionTimestamp ||
                0
            );

        if (actionTs > 0) {
            uniqueActionChanges.add(
                actionTs
            );

            lastSeen =
                Math.max(
                    lastSeen,
                    actionTs < 1e12
                        ? actionTs * 1000
                        : actionTs
                );
        }

        if (ts >= last24Cutoff) {
            last24Samples += 1;

            if (active) {
                last24Active += 1;
            }
        }
    }

    const total =
        online + idle + offline;

    const activeSamples =
        online + idle;

    const activityPct =
        total > 0
            ? (
                activeSamples /
                total
            ) * 100
            : 0;

    let mostActiveHour = null;
    let mostActiveCount = 0;

    activeHourCounts.forEach(
        (count, hour) => {
            if (
                count >
                mostActiveCount
            ) {
                mostActiveCount =
                    count;

                mostActiveHour =
                    hour;
            }
        }
    );

    const latest =
        observations[
            observations.length - 1
        ];

    const currentInOc =
        normalizeBooleanOrNull(
            latest?.isInOc
        );

    let noOcSince = null;

    if (currentInOc === false) {
        let lastInOcIndex = -1;

        for (
            let index =
                observations.length - 1;
            index >= 0;
            index -= 1
        ) {
            if (
                observations[index]
                    .isInOc === true
            ) {
                lastInOcIndex =
                    index;
                break;
            }
        }

        if (lastInOcIndex >= 0) {
            const next =
                observations[
                    lastInOcIndex + 1
                ];

            noOcSince =
                Number(
                    next?.ts ||
                    observations[
                        lastInOcIndex
                    ]?.ts ||
                    0
                ) || null;
        } else {
            noOcSince =
                Number(
                    observations[0]?.ts ||
                    0
                ) || null;
        }
    }

    const sampledDays =
        Math.max(
            sampledDates.size,
            1
        );

    /*
       This is deliberately called "observed actions/day".
       We only know that last_action changed between samples;
       it is a lower bound, not Torn's exact action count.
    */
    const observedActionChanges =
        Math.max(
            0,
            uniqueActionChanges.size - 1
        );

    const observedActionsPerDay =
        observedActionChanges /
        sampledDays;

    return {
        playerId:
            Number(
                member.playerId
            ),
        name:
            String(
                member.name || ""
            ),
        samples:
            total,
        onlineSamples:
            online,
        idleSamples:
            idle,
        offlineSamples:
            offline,
        activityPct,
        estimatedActiveHours:
            activeSamples *
            (
                ACTIVITY_BUCKET_MS /
                3600000
            ),
        activeDays:
            activeDates.size,
        sampledDays:
            sampledDates.size,
        mostActiveHour,
        observedActionChanges,
        observedActionsPerDay,
        currentInOc,
        noOcSince,
        lastSeen:
            lastSeen ||
            Number(
                latest?.ts || 0
            ),
        lastObserved:
            Number(
                latest?.ts || 0
            ),
        activeLast24hPct:
            last24Samples > 0
                ? (
                    last24Active /
                    last24Samples
                ) * 100
                : 0,
        currentStatus:
            normalizeActivityStatus(
                latest?.status
            )
    };
}



function buildActivityMemberDays(
    member,
    since,
    now
) {
    const observations =
        (Array.isArray(member?.observations)
            ? member.observations
            : []
        )
            .filter(
                observation =>
                    Number(observation?.ts || 0) >= since &&
                    Number(observation?.ts || 0) <= now
            )
            .sort(
                (a, b) =>
                    Number(a?.ts || 0) -
                    Number(b?.ts || 0)
            );

    const dayMap =
        new Map();

    const dayStart =
        new Date(since);

    dayStart.setUTCHours(
        0,
        0,
        0,
        0
    );

    const endDay =
        new Date(now);

    endDay.setUTCHours(
        0,
        0,
        0,
        0
    );

    for (
        let cursor = dayStart.getTime();
        cursor <= endDay.getTime();
        cursor += 24 * 60 * 60 * 1000
    ) {
        const date =
            new Date(cursor)
                .toISOString()
                .slice(0, 10);

        dayMap.set(
            date,
            new Array(144).fill(null)
        );
    }

    for (
        const observation
        of observations
    ) {
        const ts =
            Number(
                observation?.ts || 0
            );

        if (!ts) {
            continue;
        }

        const date =
            new Date(ts);

        const dateKey =
            date.toISOString()
                .slice(0, 10);

        const bucket =
            date.getUTCHours() * 6 +
            Math.floor(
                date.getUTCMinutes() / 10
            );

        const buckets =
            dayMap.get(dateKey);

        if (
            buckets &&
            bucket >= 0 &&
            bucket < 144
        ) {
            buckets[bucket] =
                normalizeActivityStatus(
                    observation?.status
                );
        }
    }

    return Array.from(
        dayMap.entries()
    )
        .map(
            ([date, buckets]) => ({
                date,
                buckets
            })
        );
}

function buildFactionActivityDetail(
    since,
    now
) {
    const members =
        Object.values(
            activityDatabase.members
        );

    const dayMap =
        new Map();

    const hourTotals =
        new Array(24).fill(0);

    const hourActive =
        new Array(24).fill(0);

    const activeDates =
        new Set();

    let totalSamples = 0;
    let activeSamples = 0;

    for (
        const member
        of members
    ) {
        const observations =
            (Array.isArray(member?.observations)
                ? member.observations
                : []
            ).filter(
                observation =>
                    Number(observation?.ts || 0) >= since &&
                    Number(observation?.ts || 0) <= now
            );

        for (
            const observation
            of observations
        ) {
            const ts =
                Number(
                    observation?.ts || 0
                );

            if (!ts) {
                continue;
            }

            const date =
                new Date(ts);

            const dateKey =
                date.toISOString()
                    .slice(0, 10);

            const hour =
                date.getUTCHours();

            const status =
                normalizeActivityStatus(
                    observation?.status
                );

            const active =
                status === "online" ||
                status === "idle";

            const key =
                `${dateKey}:${hour}`;

            if (!dayMap.has(key)) {
                dayMap.set(
                    key,
                    {
                        date: dateKey,
                        hour,
                        samples: 0,
                        active: 0
                    }
                );
            }

            const entry =
                dayMap.get(key);

            entry.samples += 1;
            totalSamples += 1;
            hourTotals[hour] += 1;

            if (active) {
                entry.active += 1;
                activeSamples += 1;
                hourActive[hour] += 1;
                activeDates.add(dateKey);
            }
        }
    }

    let peakHour = null;
    let peakPct = -1;

    for (
        let hour = 0;
        hour < 24;
        hour += 1
    ) {
        if (!hourTotals[hour]) {
            continue;
        }

        const pct =
            (
                hourActive[hour] /
                hourTotals[hour]
            ) * 100;

        if (pct > peakPct) {
            peakPct = pct;
            peakHour = hour;
        }
    }

    const dateKeys =
        new Set();

    for (
        const entry
        of dayMap.values()
    ) {
        dateKeys.add(
            entry.date
        );
    }

    const days =
        Array.from(dateKeys)
            .sort()
            .map(
                date => ({
                    date,
                    hours:
                        Array.from(
                            { length: 24 },
                            (_, hour) => {
                                const entry =
                                    dayMap.get(
                                        `${date}:${hour}`
                                    );

                                const samples =
                                    Number(
                                        entry?.samples ||
                                        0
                                    );

                                const active =
                                    Number(
                                        entry?.active ||
                                        0
                                    );

                                return {
                                    hour,
                                    samples,
                                    activityPct:
                                        samples > 0
                                            ? (
                                                active /
                                                samples
                                            ) * 100
                                            : 0
                                };
                            }
                        )
                })
            );

    return {
        summary: {
            membersTracked:
                members.length,
            current: (() => {
                let online = 0;
                let idle = 0;
                let offline = 0;

                for (
                    const member
                    of members
                ) {
                    const observations =
                        Array.isArray(
                            member?.observations
                        )
                            ? member.observations
                            : [];

                    const latest =
                        observations[
                            observations.length - 1
                        ];

                    const status =
                        normalizeActivityStatus(
                            latest?.status
                        );

                    if (status === "online") {
                        online += 1;
                    } else if (status === "idle") {
                        idle += 1;
                    } else {
                        offline += 1;
                    }
                }

                return {
                    online,
                    idle,
                    offline
                };
            })(),
            samples:
                totalSamples,
            activityPct:
                totalSamples > 0
                    ? (
                        activeSamples /
                        totalSamples
                    ) * 100
                    : 0,
            activeDays:
                activeDates.size,
            peakHour
        },
        days
    };
}



function loadArmoryDatabase() {
    try {
        if (!fs.existsSync(ARMORY_FILE)) {
            return {
                snapshots: []
            };
        }

        const raw =
            fs.readFileSync(
                ARMORY_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            return {
                snapshots: []
            };
        }

        const parsed =
            JSON.parse(raw);

        return {
            snapshots:
                Array.isArray(
                    parsed?.snapshots
                )
                    ? parsed.snapshots
                    : []
        };
    } catch (error) {
        console.error(
            "[MICC] Armory database load error:",
            error
        );

        return {
            snapshots: []
        };
    }
}

let armoryDatabase =
    loadArmoryDatabase();

function saveArmoryDatabase() {
    try {
        fs.writeFileSync(
            ARMORY_FILE,
            JSON.stringify(
                armoryDatabase,
                null,
                2
            )
        );
    } catch (error) {
        console.error(
            "[MICC] Armory database save error:",
            error
        );
    }
}

function pruneArmoryDatabase(
    now = Date.now()
) {
    const cutoff =
        now -
        ARMORY_RETENTION_MS;

    const before =
        Array.isArray(
            armoryDatabase.snapshots
        )
            ? armoryDatabase.snapshots
            : [];

    const after =
        before.filter(
            snapshot =>
                Number(
                    snapshot?.ts || 0
                ) >= cutoff
        );

    armoryDatabase.snapshots =
        after;

    if (
        after.length !==
        before.length
    ) {
        saveArmoryDatabase();
    }
}

function normalizeArmoryIncomingItem(item) {
    const id =
        Number(item?.id || 0) || 0;

    if (id <= 0) {
        return null;
    }

    const amount =
        Math.max(
            0,
            Math.floor(
                Number(
                    item?.amount || 0
                ) || 0
            )
        );

    const category =
        String(
            item?.category || ""
        )
            .trim()
            .toLowerCase()
            .slice(0, 30);

    const uids =
        Array.isArray(item?.uids)
            ? item.uids
                .map(uid =>
                    String(
                        uid || ""
                    )
                        .trim()
                        .slice(0, 80)
                )
                .filter(Boolean)
                .slice(0, 300)
            : [];

    const rwUids =
        Array.isArray(item?.rwUids)
            ? item.rwUids
                .map(uid =>
                    String(
                        uid || ""
                    )
                        .trim()
                        .slice(0, 80)
                )
                .filter(Boolean)
                .slice(0, 300)
            : [];

    const rwDetails =
        Array.isArray(item?.rwDetails)
            ? item.rwDetails
                .map(detail => {
                    const bonuses =
                        Array.isArray(detail?.bonuses)
                            ? detail.bonuses
                                .map(bonus => ({
                                    id:
                                        Number(bonus?.id || 0) || 0,
                                    title:
                                        String(bonus?.title || "")
                                            .trim()
                                            .slice(0, 80),
                                    description:
                                        String(bonus?.description || "")
                                            .trim()
                                            .slice(0, 240),
                                    value:
                                        Number.isFinite(Number(bonus?.value))
                                            ? Number(bonus.value)
                                            : null
                                }))
                                .filter(
                                    bonus =>
                                        bonus.title ||
                                        bonus.description
                                )
                                .slice(0, 8)
                            : [];

                    if (!bonuses.length) {
                        return null;
                    }

                    return {
                        uid:
                            String(detail?.uid || "")
                                .trim()
                                .slice(0, 80),
                        name:
                            String(detail?.name || "")
                                .trim()
                                .slice(0, 100),
                        subType:
                            String(detail?.subType || "")
                                .trim()
                                .slice(0, 80),
                        rarity:
                            String(detail?.rarity || "")
                                .trim()
                                .slice(0, 30),
                        stats: {
                            damage:
                                Number.isFinite(Number(detail?.stats?.damage))
                                    ? Number(detail.stats.damage)
                                    : null,
                            accuracy:
                                Number.isFinite(Number(detail?.stats?.accuracy))
                                    ? Number(detail.stats.accuracy)
                                    : null,
                            quality:
                                Number.isFinite(Number(detail?.stats?.quality))
                                    ? Number(detail.stats.quality)
                                    : null
                        },
                        bonuses
                    };
                })
                .filter(Boolean)
                .slice(0, 300)
            : [];

    const loaned =
        item?.loaned &&
        typeof item.loaned ===
            "object"
            ? {
                id:
                    Number(
                        item.loaned.id ||
                        0
                    ) || 0,
                name:
                    String(
                        item.loaned.name ||
                        ""
                    )
                        .trim()
                        .slice(0, 64)
            }
            : null;

    return {
        id,
        name:
            String(
                item?.name ||
                `Item ${id}`
            )
                .trim()
                .slice(0, 100),
        type:
            String(
                item?.type || ""
            )
                .trim()
                .slice(0, 60),
        category,
        amount,
        uids,
        rwUids,
        rwDetails,
        loaned
    };
}

function armorySnapshotKey(
    sourceTimestamps,
    items
) {
    const sourcePart =
        Object.entries(
            sourceTimestamps || {}
        )
            .sort(
                ([a], [b]) =>
                    a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}:${Number(value || 0)}`
            )
            .join("|");

    if (
        sourcePart &&
        !sourcePart
            .split("|")
            .every(
                pair =>
                    pair.endsWith(":0")
            )
    ) {
        return sourcePart;
    }

    const itemPart =
        items
            .map(
                item =>
                    `${item.category}:${item.id}:${item.amount}:${item.rwUids.length}:${item.loaned?.id || 0}`
            )
            .sort()
            .join("|");

    return crypto
        .createHash("sha1")
        .update(itemPart)
        .digest("hex");
}

function getArmoryMetrics(snapshot) {
    const items =
        Array.isArray(
            snapshot?.items
        )
            ? snapshot.items
            : [];

    let xanax = 0;
    let medical = 0;
    let temporary = 0;
    let armor = 0;
    let armorLoaned = 0;
    let rwWeapons = 0;
    let rwLoaned = 0;

    for (const item of items) {
        const amount =
            Math.max(
                0,
                Number(
                    item?.amount || 0
                ) || 0
            );

        const name =
            String(
                item?.name || ""
            )
                .trim()
                .toLowerCase();

        const category =
            String(
                item?.category || ""
            )
                .trim()
                .toLowerCase();

        if (
            category === "drugs" &&
            name === "xanax"
        ) {
            xanax += amount;
        }

        if (
            category === "medical"
        ) {
            medical += amount;
        }

        if (
            category === "temporary"
        ) {
            temporary += amount;
        }

        if (
            category === "armor"
        ) {
            armor += amount;

            if (item?.loaned) {
                armorLoaned +=
                    Math.min(
                        amount,
                        1
                    );
            }
        }

        if (
            category === "weapons"
        ) {
            const rwCount =
                Array.isArray(
                    item?.rwUids
                )
                    ? item.rwUids.length
                    : 0;

            rwWeapons += rwCount;

            if (
                item?.loaned &&
                rwCount > 0
            ) {
                rwLoaned +=
                    Math.min(
                        rwCount,
                        1
                    );
            }
        }
    }

    return {
        xanax,
        medical,
        temporary,
        rwWeapons,
        rwAvailable:
            Math.max(
                0,
                rwWeapons -
                rwLoaned
            ),
        armor,
        armorAvailable:
            Math.max(
                0,
                armor -
                armorLoaned
            )
    };
}

function getArmoryItemAmounts(snapshot) {
    const map =
        new Map();

    const items =
        Array.isArray(
            snapshot?.items
        )
            ? snapshot.items
            : [];

    for (const item of items) {
        const key =
            `${item.category}:${item.id}`;

        const existing =
            map.get(key) || {
                key,
                id:
                    Number(
                        item.id || 0
                    ),
                name:
                    String(
                        item.name || ""
                    ),
                category:
                    String(
                        item.category || ""
                    ),
                amount: 0
            };

        existing.amount +=
            Math.max(
                0,
                Number(
                    item.amount || 0
                ) || 0
            );

        map.set(
            key,
            existing
        );
    }

    return map;
}

function getArmoryLowStock(
    snapshot,
    usage = null
) {
    const items =
        getArmoryItemAmounts(
            snapshot
        );

    const usedKeys =
        new Set(
            Array.isArray(usage?.items)
                ? usage.items
                    .filter(
                        item =>
                            Number(item?.used || 0) > 0
                    )
                    .map(
                        item =>
                            String(item?.key || "")
                    )
                    .filter(Boolean)
                : []
        );

    const lows = [];

    for (
        const entry
        of items.values()
    ) {
        const name =
            entry.name
                .trim()
                .toLowerCase();

        const category =
            entry.category
                .trim()
                .toLowerCase();

        // Restock warnings are intentionally limited to consumables.
        if (
            ![
                "drugs",
                "medical",
                "temporary"
            ].includes(category)
        ) {
            continue;
        }

        let threshold = null;

        if (
            category === "drugs" &&
            name === "xanax"
        ) {
            threshold = 100;
        } else if (
            usedKeys.has(entry.key)
        ) {
            if (
                category === "medical" &&
                name === "first aid kit"
            ) {
                threshold = 200;
            } else if (
                category === "medical"
            ) {
                threshold = 50;
            } else if (
                category === "temporary"
            ) {
                threshold = 25;
            } else if (
                category === "drugs"
            ) {
                threshold = 25;
            }
        }

        if (
            threshold !== null &&
            entry.amount < threshold
        ) {
            lows.push({
                key: entry.key,
                label: entry.name,
                category,
                current:
                    entry.amount,
                threshold,
                ratio:
                    threshold > 0
                        ? entry.amount /
                            threshold
                        : 1
            });
        }
    }

    return lows.sort(
        (a, b) =>
            Number(a.ratio || 0) -
            Number(b.ratio || 0)
    );
}

function buildArmoryRecentChanges(
    latest,
    previous
) {
    if (
        !latest ||
        !previous
    ) {
        return [];
    }

    const latestMap =
        getArmoryItemAmounts(
            latest
        );

    const previousMap =
        getArmoryItemAmounts(
            previous
        );

    const keys =
        new Set([
            ...latestMap.keys(),
            ...previousMap.keys()
        ]);

    const changes = [];

    for (const key of keys) {
        const current =
            latestMap.get(key);
        const prior =
            previousMap.get(key);

        const currentAmount =
            Number(
                current?.amount || 0
            );

        const priorAmount =
            Number(
                prior?.amount || 0
            );

        const delta =
            currentAmount -
            priorAmount;

        if (!delta) {
            continue;
        }

        changes.push({
            key,
            label:
                current?.name ||
                prior?.name ||
                key,
            category:
                current?.category ||
                prior?.category ||
                "",
            current:
                currentAmount,
            previous:
                priorAmount,
            delta
        });
    }

    const latestMetrics =
        getArmoryMetrics(
            latest
        );

    const previousMetrics =
        getArmoryMetrics(
            previous
        );

    for (
        const [key, label]
        of [
            ["rwWeapons", "RW weapons"],
            ["armor", "Armor"]
        ]
    ) {
        const delta =
            Number(
                latestMetrics[key] || 0
            ) -
            Number(
                previousMetrics[key] ||
                0
            );

        if (delta) {
            changes.push({
                key:
                    `group:${key}`,
                label,
                category: "group",
                current:
                    latestMetrics[key],
                previous:
                    previousMetrics[key],
                delta
            });
        }
    }

    return changes.sort(
        (a, b) =>
            Math.abs(
                Number(b.delta || 0)
            ) -
            Math.abs(
                Number(a.delta || 0)
            )
    );
}

function buildArmoryConsumableUsage(
    snapshots
) {
    // Faction-side only:
    // compares consecutive faction inventory snapshots and measures
    // observed stock leaving / entering the faction armory.
    const validCategories =
        new Set([
            "drugs",
            "medical",
            "temporary"
        ]);

    const ordered =
        (Array.isArray(snapshots)
            ? snapshots
            : []
        )
            .slice()
            .sort(
                (a, b) =>
                    Number(a?.ts || 0) -
                    Number(b?.ts || 0)
            );

    const flowByKey =
        new Map();

    for (
        let index = 1;
        index < ordered.length;
        index += 1
    ) {
        const previous =
            getArmoryItemAmounts(
                ordered[index - 1]
            );

        const current =
            getArmoryItemAmounts(
                ordered[index]
            );

        const keys =
            new Set([
                ...previous.keys(),
                ...current.keys()
            ]);

        for (const key of keys) {
            const before =
                previous.get(key);

            const after =
                current.get(key);

            const category =
                String(
                    after?.category ||
                    before?.category ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            if (
                !validCategories.has(
                    category
                )
            ) {
                continue;
            }

            const beforeAmount =
                Math.max(
                    0,
                    Number(before?.amount || 0) || 0
                );

            const afterAmount =
                Math.max(
                    0,
                    Number(after?.amount || 0) || 0
                );

            const delta =
                afterAmount -
                beforeAmount;

            if (!delta) {
                continue;
            }

            const existing =
                flowByKey.get(key) || {
                    key,
                    id:
                        Number(
                            after?.id ||
                            before?.id ||
                            0
                        ) || 0,
                    name:
                        String(
                            after?.name ||
                            before?.name ||
                            key
                        ),
                    category,
                    used: 0,
                    added: 0
                };

            if (delta < 0) {
                // Observed stock leaving the faction armory.
                existing.used +=
                    Math.abs(delta);
            } else {
                // Observed stock being added / restocked into faction armory.
                existing.added +=
                    delta;
            }

            flowByKey.set(
                key,
                existing
            );
        }
    }

    const items =
        [...flowByKey.values()]
            .sort(
                (a, b) =>
                    Number(b.used || 0) -
                    Number(a.used || 0) ||
                    Number(b.added || 0) -
                    Number(a.added || 0) ||
                    a.name.localeCompare(b.name)
            );

    const categories = {
        drugs: 0,
        medical: 0,
        temporary: 0
    };

    const addedCategories = {
        drugs: 0,
        medical: 0,
        temporary: 0
    };

    for (const item of items) {
        if (
            Object.prototype.hasOwnProperty.call(
                categories,
                item.category
            )
        ) {
            categories[item.category] +=
                Math.max(
                    0,
                    Number(item.used || 0) || 0
                );

            addedCategories[item.category] +=
                Math.max(
                    0,
                    Number(item.added || 0) || 0
                );
        }
    }

    const spanMs =
        ordered.length >= 2
            ? Math.max(
                0,
                Number(
                    ordered[
                        ordered.length - 1
                    ]?.ts || 0
                ) -
                Number(
                    ordered[0]?.ts || 0
                )
            )
            : 0;

    return {
        snapshotCount:
            ordered.length,
        spanMs,
        categories,
        addedCategories,
        items
    };
}


function median(values) {
    const nums =
        values
            .map(Number)
            .filter(Number.isFinite)
            .sort(
                (a, b) =>
                    a - b
            );

    if (!nums.length) {
        return 0;
    }

    const middle =
        Math.floor(
            nums.length / 2
        );

    if (
        nums.length % 2
    ) {
        return nums[middle];
    }

    return (
        nums[middle - 1] +
        nums[middle]
    ) / 2;
}

function buildArmoryAlerts(
    snapshots,
    readyAlerts
) {
    const alerts = [];

    const latest =
        snapshots[
            snapshots.length - 1
        ];

    if (!latest) {
        return alerts;
    }

    const usage =
        buildArmoryConsumableUsage(
            snapshots
        );

    for (
        const low
        of getArmoryLowStock(
            latest,
            usage
        )
    ) {
        alerts.push({
            level:
                Number(
                    low.ratio || 0
                ) <= .5
                    ? "critical"
                    : "warning",
            key:
                `low:${low.key}`,
            message:
                `${low.label} is low: ${low.current} / ${low.threshold}`
        });
    }

    if (
        !readyAlerts ||
        snapshots.length < 3
    ) {
        return alerts;
    }

    const allKeys =
        new Set();

    for (const snapshot of snapshots) {
        for (
            const key
            of getArmoryItemAmounts(
                snapshot
            ).keys()
        ) {
            allKeys.add(key);
        }
    }

    for (const key of allKeys) {
        const values =
            snapshots.map(
                snapshot => {
                    const entry =
                        getArmoryItemAmounts(
                            snapshot
                        ).get(key);

                    return {
                        ts:
                            Number(
                                snapshot.ts ||
                                0
                            ),
                        amount:
                            Number(
                                entry?.amount ||
                                0
                            ),
                        name:
                            entry?.name ||
                            key
                    };
                }
            );

        const latestPair =
            values.slice(-2);

        if (
            latestPair.length < 2
        ) {
            continue;
        }

        const latestDrop =
            latestPair[0].amount -
            latestPair[1].amount;

        if (
            latestDrop <= 0
        ) {
            continue;
        }

        const historicalDrops = [];

        for (
            let index = 1;
            index <
            values.length - 1;
            index += 1
        ) {
            const drop =
                values[index - 1]
                    .amount -
                values[index]
                    .amount;

            if (drop > 0) {
                historicalDrops.push(
                    drop
                );
            }
        }

        const typical =
            median(
                historicalDrops
            );

        const previousAmount =
            Math.max(
                1,
                latestPair[0].amount
            );

        const percentage =
            latestDrop /
            previousAmount;

        const unusualThreshold =
            Math.max(
                5,
                typical > 0
                    ? typical * 2.5
                    : 5
            );

        if (
            latestDrop >=
                unusualThreshold &&
            percentage >= .10
        ) {
            alerts.push({
                level:
                    percentage >= .30
                        ? "critical"
                        : "warning",
                key:
                    `drop:${key}`,
                message:
                    `${latestPair[1].name} dropped by ${latestDrop} (${Math.round(percentage * 100)}%) in the latest armory snapshot`
            });
        }
    }

    return alerts;
}


function buildArmoryForecast(
    snapshots
) {
    const safeSnapshots =
        Array.isArray(snapshots)
            ? snapshots
            : [];

    if (!safeSnapshots.length) {
        return {
            xanax: {
                ready: false,
                consumptionPerDay: 0,
                daysRemaining: null,
                recommendedRestock: 0,
                targetStock: 500
            }
        };
    }

    const firstTs =
        Number(
            safeSnapshots[0]?.ts ||
            0
        );

    const lastTs =
        Number(
            safeSnapshots[
                safeSnapshots.length - 1
            ]?.ts || 0
        );

    const spanMs =
        Math.max(
            0,
            lastTs - firstTs
        );

    const ready =
        safeSnapshots.length >= 6 &&
        spanMs >=
            5 *
            60 *
            60 *
            1000;

    const xanaxValues =
        safeSnapshots.map(
            snapshot => {
                const metrics =
                    getArmoryMetrics(
                        snapshot
                    );

                return {
                    ts:
                        Number(
                            snapshot?.ts ||
                            0
                        ),
                    value:
                        Number(
                            metrics?.xanax ||
                            0
                        )
                };
            }
        );

    let observedConsumption = 0;

    for (
        let index = 1;
        index < xanaxValues.length;
        index += 1
    ) {
        const previous =
            xanaxValues[index - 1]
                .value;

        const current =
            xanaxValues[index]
                .value;

        if (
            current < previous
        ) {
            observedConsumption +=
                previous - current;
        }
    }

    const spanDays =
        spanMs > 0
            ? spanMs /
                (
                    24 *
                    60 *
                    60 *
                    1000
                )
            : 0;

    const consumptionPerDay =
        ready &&
        spanDays > 0
            ? observedConsumption /
                spanDays
            : 0;

    const latestXanax =
        xanaxValues[
            xanaxValues.length - 1
        ]?.value || 0;

    const daysRemaining =
        ready &&
        consumptionPerDay > 0
            ? latestXanax /
                consumptionPerDay
            : null;

    const targetStock = 500;

    const recommendedRestock =
        ready
            ? Math.max(
                0,
                targetStock -
                latestXanax
            )
            : 0;

    return {
        xanax: {
            ready,
            current:
                latestXanax,
            observedConsumption,
            consumptionPerDay:
                Number(
                    consumptionPerDay
                        .toFixed(2)
                ),
            daysRemaining:
                daysRemaining === null
                    ? null
                    : Number(
                        daysRemaining
                            .toFixed(2)
                    ),
            recommendedRestock,
            targetStock,
            snapshots:
                safeSnapshots.length,
            spanMs
        }
    };
}


function buildArmoryInventoryRows(snapshot) {
    const items =
        Array.isArray(
            snapshot?.items
        )
            ? snapshot.items
            : [];

    return items
        .map(
            item => ({
                id:
                    Number(
                        item.id || 0
                    ),
                name:
                    String(
                        item.name || ""
                    ),
                category:
                    String(
                        item.category || ""
                    ),
                amount:
                    Number(
                        item.amount || 0
                    ),
                rwCount:
                    Array.isArray(
                        item.rwDetails
                    )
                        ? item.rwDetails.filter(
                            detail =>
                                Array.isArray(detail?.bonuses) &&
                                detail.bonuses.length > 0
                        ).length
                        : (
                            Array.isArray(item.rwUids)
                                ? item.rwUids.length
                                : 0
                        ),
                rwDetails:
                    Array.isArray(item.rwDetails)
                        ? item.rwDetails
                        : [],
                loanedTo:
                    item?.loaned?.name ||
                    ""
            })
        )
        .sort(
            (a, b) =>
                a.category
                    .localeCompare(
                        b.category
                    ) ||
                a.name
                    .localeCompare(
                        b.name
                    )
        );
}


function makeId(prefix) {
    return (
        `${prefix}_` +
        crypto
            .randomBytes(8)
            .toString("hex")
    );
}

function getRequester(req) {
    return {
        id:
            String(
                req.headers[
                    "x-micc-player-id"
                ] || ""
            ).trim(),
        name:
            String(
                req.headers[
                    "x-micc-player-name"
                ] || ""
            ).trim()
    };
}

function isCalendarEditorId(playerId) {
    const id =
        String(playerId || "");

    if (
        id === CALENDAR_OWNER_ID
    ) {
        return true;
    }

    return calendarDatabase.editors
        .some(editor => {
            return String(
                editor.playerId
            ) === id;
        });
}

function requireCalendarIdentity(
    req,
    res,
    next
) {
    const requester =
        getRequester(req);

    if (!requester.id) {
        return res.status(401).json({
            success: false,
            error:
                "MICC calendar requires a connected player identity"
        });
    }

    req.miccRequester =
        requester;

    next();
}

function requireCalendarEditor(
    req,
    res,
    next
) {
    const requester =
        getRequester(req);

    if (
        !requester.id ||
        !isCalendarEditorId(
            requester.id
        )
    ) {
        return res.status(403).json({
            success: false,
            error:
                "Calendar manager rights required"
        });
    }

    req.miccRequester =
        requester;

    next();
}

function requireCalendarOwner(
    req,
    res,
    next
) {
    const requester =
        getRequester(req);

    if (
        requester.id !==
        CALENDAR_OWNER_ID
    ) {
        return res.status(403).json({
            success: false,
            error:
                "Only the MICC calendar owner can manage calendar rights"
        });
    }

    req.miccRequester =
        requester;

    next();
}

// ============================================================
// AUTHENTICATION
// ============================================================

function auth(req, res, next) {
    const suppliedSecret =
        req.headers["x-micc-secret"];

    if (
        !suppliedSecret ||
        suppliedSecret !== MICC_SECRET
    ) {
        return res.status(403).json({
            success: false,
            error: "Invalid MICC secret"
        });
    }

    next();
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "MICC Faction Status Relay",
        version: "0.9.10",
        members: Object.keys(database).length,
        message: "MICC relay is online"
    });
});

// ============================================================
// UPLOAD MEMBER STATUS
// ============================================================

app.post(
    "/api/micc/status",
    auth,
    (req, res) => {

        const {
            playerId,
            name,
            energy,
            energyMax,
            energyFullTime,
            drug,
            booster,
            medical
        } = req.body || {};

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "Missing playerId"
            });
        }

        if (!name) {
            return res.status(400).json({
                success: false,
                error: "Missing player name"
            });
        }

        const id = String(playerId);

        database[id] = {
            playerId: Number(playerId),
            name: String(name),
            energy: Number(energy) || 0,
            energyMax: Number(energyMax) || 0,
            energyFullTime: Number(energyFullTime) || 0,
            drug: Number(drug) || 0,
            booster: Number(booster) || 0,
            medical: Number(medical) || 0,
            updated: Date.now()
        };

        saveDatabase();

        console.log(
            `[MICC] Updated ${name} [${playerId}]`
        );

        console.log(
            `       Energy: ${database[id].energy}/${database[id].energyMax}`
        );

        console.log(
            `       Full E in: ${database[id].energyFullTime}s`
        );

        console.log(
            `       Drug CD: ${database[id].drug}s`
        );

        console.log(
            `       Booster CD: ${database[id].booster}s`
        );

        console.log(
            `       Medical CD: ${database[id].medical}s`
        );

        res.json({
            success: true,
            message: "MICC status updated"
        });
    }
);

// ============================================================
// DOWNLOAD MEMBER STATUSES
// ============================================================

app.get(
    "/api/micc/status",
    auth,
    (req, res) => {

        const now = Date.now();
        let databaseChanged = false;

        for (
            const [id, member]
            of Object.entries(database)
        ) {
            if (
                !member.updated ||
                now - Number(member.updated) >
                    MAX_STATUS_AGE
            ) {
                delete database[id];
                databaseChanged = true;

                console.log(
                    `[MICC] Removed stale member ${id}`
                );
            }
        }

        if (databaseChanged) {
            saveDatabase();
        }

        res.json({
            success: true,
            members: Object.values(database)
        });
    }
);

// ============================================================
// MICC FACTION CALENDAR
// ============================================================

app.get(
    "/api/micc/calendar",
    auth,
    (req, res) => {
        res.json({
            success: true,
            events:
                calendarDatabase.events,
            notes:
                calendarDatabase.notes,
            owner: {
                playerId: CALENDAR_OWNER_ID,
                name: "RobertHarvey"
            },
            editors:
                calendarDatabase.editors
        });
    }
);

app.post(
    "/api/micc/calendar/event",
    auth,
    requireCalendarEditor,
    (req, res) => {
        const {
            date,
            type,
            title,
            description
        } = req.body || {};

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
                String(date || "")
            ) ||
            !String(title || "").trim()
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Valid event date and title are required"
            });
        }

        const allowedTypes =
            new Set([
                "chain",
                "war",
                "important",
                "oc"
            ]);

        const normalizedType =
            allowedTypes.has(
                String(type || "")
                    .toLowerCase()
            )
                ? String(type)
                    .toLowerCase()
                : "important";

        const event = {
            id:
                makeId("evt"),
            date:
                String(date),
            type:
                normalizedType,
            title:
                String(title)
                    .trim()
                    .slice(0, 80),
            description:
                String(
                    description || ""
                )
                    .trim()
                    .slice(0, 500),
            createdById:
                req.miccRequester.id,
            createdByName:
                req.miccRequester.name ||
                `Player ${req.miccRequester.id}`,
            created:
                Date.now(),
            updated:
                Date.now()
        };

        calendarDatabase.events.push(
            event
        );

        saveCalendarDatabase();

        res.json({
            success: true,
            event
        });
    }
);

app.put(
    "/api/micc/calendar/event/:id",
    auth,
    requireCalendarEditor,
    (req, res) => {
        const event =
            calendarDatabase.events
                .find(item => {
                    return String(item.id) ===
                        String(req.params.id);
                });

        if (!event) {
            return res.status(404).json({
                success: false,
                error:
                    "Calendar event not found"
            });
        }

        const {
            date,
            type,
            title,
            description
        } = req.body || {};

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
                String(date || "")
            ) ||
            !String(title || "").trim()
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Valid event date and title are required"
            });
        }

        const allowedTypes =
            new Set([
                "chain",
                "war",
                "important",
                "oc"
            ]);

        event.date =
            String(date);

        event.type =
            allowedTypes.has(
                String(type || "")
                    .toLowerCase()
            )
                ? String(type)
                    .toLowerCase()
                : "important";

        event.title =
            String(title)
                .trim()
                .slice(0, 80);

        event.description =
            String(
                description || ""
            )
                .trim()
                .slice(0, 500);

        event.updatedById =
            req.miccRequester.id;

        event.updatedByName =
            req.miccRequester.name ||
            `Player ${req.miccRequester.id}`;

        event.updated =
            Date.now();

        saveCalendarDatabase();

        res.json({
            success: true,
            event
        });
    }
);

app.delete(
    "/api/micc/calendar/event/:id",
    auth,
    requireCalendarEditor,
    (req, res) => {
        const before =
            calendarDatabase.events.length;

        calendarDatabase.events =
            calendarDatabase.events
                .filter(item => {
                    return String(item.id) !==
                        String(req.params.id);
                });

        if (
            calendarDatabase.events.length ===
            before
        ) {
            return res.status(404).json({
                success: false,
                error:
                    "Calendar event not found"
            });
        }

        saveCalendarDatabase();

        res.json({
            success: true
        });
    }
);

app.post(
    "/api/micc/calendar/note",
    auth,
    requireCalendarIdentity,
    (req, res) => {
        const {
            date,
            text
        } = req.body || {};

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
                String(date || "")
            ) ||
            !String(text || "").trim()
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Valid note date and text are required"
            });
        }

        const note = {
            id:
                makeId("note"),
            date:
                String(date),
            text:
                String(text)
                    .trim()
                    .slice(0, 500),
            createdById:
                req.miccRequester.id,
            createdByName:
                req.miccRequester.name ||
                `Player ${req.miccRequester.id}`,
            created:
                Date.now()
        };

        calendarDatabase.notes.push(
            note
        );

        saveCalendarDatabase();

        res.json({
            success: true,
            note
        });
    }
);

app.delete(
    "/api/micc/calendar/note/:id",
    auth,
    requireCalendarIdentity,
    (req, res) => {
        const note =
            calendarDatabase.notes
                .find(item => {
                    return String(item.id) ===
                        String(req.params.id);
                });

        if (!note) {
            return res.status(404).json({
                success: false,
                error:
                    "Calendar note not found"
            });
        }

        const requesterId =
            req.miccRequester.id;

        const canDelete =
            String(
                note.createdById
            ) === requesterId ||
            isCalendarEditorId(
                requesterId
            );

        if (!canDelete) {
            return res.status(403).json({
                success: false,
                error:
                    "You can only delete your own notes"
            });
        }

        calendarDatabase.notes =
            calendarDatabase.notes
                .filter(item => {
                    return String(item.id) !==
                        String(req.params.id);
                });

        saveCalendarDatabase();

        res.json({
            success: true
        });
    }
);

app.post(
    "/api/micc/calendar/editor",
    auth,
    requireCalendarOwner,
    (req, res) => {
        const playerId =
            String(
                req.body?.playerId || ""
            ).trim();

        const name =
            String(
                req.body?.name || ""
            )
                .trim()
                .slice(0, 50);

        if (
            !/^\d+$/.test(
                playerId
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Valid Torn player ID required"
            });
        }

        if (
            playerId ===
            CALENDAR_OWNER_ID
        ) {
            return res.json({
                success: true,
                message:
                    "Calendar owner already has full rights"
            });
        }

        const existing =
            calendarDatabase.editors
                .find(editor => {
                    return String(
                        editor.playerId
                    ) === playerId;
                });

        if (existing) {
            existing.name =
                name ||
                existing.name;

        } else {
            calendarDatabase.editors.push({
                playerId,
                name:
                    name ||
                    `Player ${playerId}`,
                added:
                    Date.now()
            });
        }

        saveCalendarDatabase();

        res.json({
            success: true,
            editors:
                calendarDatabase.editors
        });
    }
);

app.delete(
    "/api/micc/calendar/editor/:id",
    auth,
    requireCalendarOwner,
    (req, res) => {
        calendarDatabase.editors =
            calendarDatabase.editors
                .filter(editor => {
                    return String(
                        editor.playerId
                    ) !==
                        String(req.params.id);
                });

        saveCalendarDatabase();

        res.json({
            success: true,
            editors:
                calendarDatabase.editors
        });
    }
);


// ============================================================
// MICC ACTIVITY TRACKER
// ============================================================

app.post(
    "/api/micc/activity/observe",
    auth,
    (req, res) => {
        const incoming =
            Array.isArray(
                req.body?.members
            )
                ? req.body.members
                : [];

        if (!incoming.length) {
            return res.status(400).json({
                success: false,
                error:
                    "No activity members supplied"
            });
        }

        if (incoming.length > 250) {
            return res.status(400).json({
                success: false,
                error:
                    "Too many members in one activity observation"
            });
        }

        const now =
            Date.now();

        const requestedObservedAt =
            Number(
                req.body?.observedAt ||
                now
            );

        const observedAt =
            Number.isFinite(
                requestedObservedAt
            )
                ? Math.min(
                    now + 60000,
                    Math.max(
                        now - 10 * 60 * 1000,
                        requestedObservedAt
                    )
                )
                : now;

        const bucket =
            Math.floor(
                observedAt /
                ACTIVITY_BUCKET_MS
            ) *
            ACTIVITY_BUCKET_MS;

        let accepted = 0;

        for (
            const incomingMember
            of incoming
        ) {
            const playerId =
                Number(
                    incomingMember?.playerId ??
                    incomingMember?.id
                );

            if (
                !Number.isFinite(playerId) ||
                playerId <= 0
            ) {
                continue;
            }

            const id =
                String(playerId);

            const name =
                String(
                    incomingMember?.name ||
                    `Player ${id}`
                )
                    .trim()
                    .slice(0, 64);

            const status =
                normalizeActivityStatus(
                    incomingMember?.status
                );

            const lastActionTimestamp =
                Number(
                    incomingMember
                        ?.lastActionTimestamp ||
                    0
                ) || 0;

            const isInOc =
                normalizeBooleanOrNull(
                    incomingMember?.isInOc
                );

            let member =
                activityDatabase
                    .members[id];

            if (!member) {
                member = {
                    playerId,
                    name,
                    observations: []
                };

                activityDatabase
                    .members[id] =
                    member;
            }

            member.playerId =
                playerId;

            member.name =
                name ||
                member.name ||
                `Player ${id}`;

            if (
                !Array.isArray(
                    member.observations
                )
            ) {
                member.observations = [];
            }

            const observation = {
                ts: bucket,
                status,
                lastActionTimestamp,
                isInOc
            };

            const last =
                member.observations[
                    member.observations.length -
                    1
                ];

            /*
               Multiple MICC members may upload the same faction
               during the same ten-minute bucket. Replace that
               bucket instead of creating duplicate samples.
            */
            if (
                last &&
                Number(last.ts) ===
                    bucket
            ) {
                member.observations[
                    member.observations.length -
                    1
                ] = observation;
            } else {
                member.observations.push(
                    observation
                );
            }

            accepted += 1;
        }

        pruneActivityDatabase(
            now
        );

        saveActivityDatabase();

        res.json({
            success: true,
            accepted,
            bucket,
            trackedMembers:
                Object.keys(
                    activityDatabase.members
                ).length
        });
    }
);

app.get(
    "/api/micc/activity/summary",
    auth,
    (req, res) => {
        const requestedDays =
            Number(
                req.query?.days ||
                7
            );

        const days =
            [7, 14, 30].includes(
                requestedDays
            )
                ? requestedDays
                : 7;

        const now =
            Date.now();

        const since =
            now -
            days *
            24 *
            60 *
            60 *
            1000;

        pruneActivityDatabase(
            now
        );

        const members =
            Object.values(
                activityDatabase.members
            )
                .map(
                    member =>
                        buildActivityMemberSummary(
                            member,
                            since,
                            now
                        )
                )
                .filter(Boolean);

        res.json({
            success: true,
            days,
            observedAt: now,
            pollMinutes:
                ACTIVITY_BUCKET_MS /
                60000,
            members
        });
    }
);


function ffscouterConfigured() {
    return (
        /^[A-Za-z0-9]{16}$/.test(
            FFSCOUTER_API_KEY
        )
    );
}

function safeActivityDays(value) {
    const days =
        Number(value || 7);

    return [7, 14, 30].includes(days)
        ? days
        : 7;
}

async function fetchFfscouterActivity(
    endpoint,
    params
) {
    const url =
        new URL(
            `https://ffscouter.com/api/v1/activity/${endpoint}`
        );

    url.searchParams.set(
        "key",
        FFSCOUTER_API_KEY
    );

    for (
        const [key, value]
        of Object.entries(params)
    ) {
        url.searchParams.set(
            key,
            String(value)
        );
    }

    const response =
        await fetch(
            url,
            {
                method: "GET",
                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );

    let data = null;

    try {
        data =
            await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const error =
            new Error(
                data?.error ||
                data?.message ||
                `FFScouter HTTP ${response.status}`
            );

        error.status =
            response.status;

        error.ffData =
            data;

        throw error;
    }

    return data;
}

app.get(
    "/api/micc/ffscouter/player/:id",
    auth,
    async (req, res) => {
        if (!ffscouterConfigured()) {
            return res.json({
                available: false,
                reason:
                    "No FFScouter Premium API key is configured on the MICC server."
            });
        }

        const playerId =
            Number(
                req.params?.id
            );

        if (
            !Number.isFinite(playerId) ||
            playerId <= 0
        ) {
            return res
                .status(400)
                .json({
                    available: false,
                    reason:
                        "Invalid player ID."
                });
        }

        const days =
            safeActivityDays(
                req.query?.days
            );

        const end =
            Math.floor(
                Date.now() /
                1000
            );

        const start =
            end -
            days *
            24 *
            60 *
            60;

        try {
            // 7/14 days fit under FFScouter's 5000-bucket cap at 5 minutes.
            // For 30 days, use 15-minute buckets to stay within the documented limit.
            const bucket =
                days === 30
                    ? 900
                    : 300;

            const data =
                await fetchFfscouterActivity(
                    "player",
                    {
                        target:
                            playerId,
                        start,
                        end,
                        bucket
                    }
                );

            return res.json({
                available: true,
                source:
                    "ffscouter",
                ...data
            });

        } catch (error) {
            return res.json({
                available: false,
                reason:
                    error?.message ||
                    "FFScouter request failed.",
                code:
                    error?.ffData?.code ??
                    null
            });
        }
    }
);

app.get(
    "/api/micc/ffscouter/faction",
    auth,
    async (req, res) => {
        if (!ffscouterConfigured()) {
            return res.json({
                available: false,
                reason:
                    "No FFScouter Premium API key is configured on the MICC server."
            });
        }

        if (
            !Number.isFinite(
                FFSCOUTER_FACTION_ID
            ) ||
            FFSCOUTER_FACTION_ID <= 0
        ) {
            return res.json({
                available: false,
                reason:
                    "FFSCOUTER_FACTION_ID is not configured on the MICC server."
            });
        }

        const days =
            safeActivityDays(
                req.query?.days
            );

        const end =
            Math.floor(
                Date.now() /
                1000
            );

        const start =
            end -
            days *
            24 *
            60 *
            60;

        try {
            const bucket =
                days === 30
                    ? 900
                    : 300;

            const data =
                await fetchFfscouterActivity(
                    "faction",
                    {
                        faction_id:
                            FFSCOUTER_FACTION_ID,
                        start,
                        end,
                        bucket
                    }
                );

            return res.json({
                available: true,
                source:
                    "ffscouter",
                ...data
            });

        } catch (error) {
            return res.json({
                available: false,
                reason:
                    error?.message ||
                    "FFScouter request failed.",
                code:
                    error?.ffData?.code ??
                    null
            });
        }
    }
);

app.get(
    "/api/micc/activity/member/:id",
    auth,
    (req, res) => {
        const requestedDays =
            Number(
                req.query?.days ||
                7
            );

        const days =
            [7, 14, 30].includes(
                requestedDays
            )
                ? requestedDays
                : 7;

        const playerId =
            Number(
                req.params?.id
            );

        if (
            !Number.isFinite(playerId) ||
            playerId <= 0
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Invalid player ID"
                });
        }

        const now =
            Date.now();

        const since =
            now -
            days *
            24 *
            60 *
            60 *
            1000;

        pruneActivityDatabase(
            now
        );

        const member =
            activityDatabase
                .members[
                    String(playerId)
                ];

        if (!member) {
            return res
                .status(404)
                .json({
                    error:
                        "No activity history found for this member"
                });
        }

        const summary =
            buildActivityMemberSummary(
                member,
                since,
                now
            );

        res.json({
            success: true,
            days,
            observedAt: now,
            member: {
                playerId,
                name:
                    String(
                        member.name ||
                        ""
                    ),
                summary,
                days:
                    buildActivityMemberDays(
                        member,
                        since,
                        now
                    )
            }
        });
    }
);

app.get(
    "/api/micc/activity/faction",
    auth,
    (req, res) => {
        const requestedDays =
            Number(
                req.query?.days ||
                7
            );

        const days =
            [7, 14, 30].includes(
                requestedDays
            )
                ? requestedDays
                : 7;

        const now =
            Date.now();

        const since =
            now -
            days *
            24 *
            60 *
            60 *
            1000;

        pruneActivityDatabase(
            now
        );

        const detail =
            buildFactionActivityDetail(
                since,
                now
            );

        res.json({
            success: true,
            days,
            observedAt: now,
            ...detail
        });
    }
);

app.get(
    "/api/micc/activity/debug",
    auth,
    (req, res) => {
        pruneActivityDatabase();

        let observations = 0;

        for (
            const member
            of Object.values(
                activityDatabase.members
            )
        ) {
            observations +=
                Array.isArray(
                    member.observations
                )
                    ? member.observations
                        .length
                    : 0;
        }

        res.json({
            success: true,
            trackedMembers:
                Object.keys(
                    activityDatabase.members
                ).length,
            observations,
            retentionDays:
                ACTIVITY_RETENTION_MS /
                (24 * 60 * 60 * 1000),
            pollMinutes:
                ACTIVITY_BUCKET_MS /
                60000
        });
    }
);



// ============================================================
// MICC ARMORY TRACKER
// ============================================================


function tornFactionApiConfigured() {
    return (
        TORN_FACTION_API_KEY.length >= 8
    );
}

function safeArmoryUsageDays(value) {
    const days =
        Number(value || 30);

    return [1, 7, 30].includes(days)
        ? days
        : 30;
}

function stripNewsText(value) {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function parseFactionArmoryUseNews(entry) {
    const text =
        stripNewsText(
            entry?.text ??
            entry?.news ??
            ""
        );

    if (!text) {
        return null;
    }

    // Current Torn faction armory usage wording:
    // "Player used one of the faction's Xanax items"
    // Also tolerate explicit quantities if Torn changes wording.
    let match =
        text.match(
            /^(.+?)\s+used\s+one\s+of\s+the\s+faction['’]s\s+(.+?)\s+items?\.?$/i
        );

    let quantity = 1;
    let actor = "";
    let itemName = "";

    if (match) {
        actor =
            String(match[1] || "").trim();
        itemName =
            String(match[2] || "").trim();
    } else {
        match =
            text.match(
                /^(.+?)\s+used\s+([\d,]+)\s+of\s+the\s+faction['’]s\s+(.+?)\s+items?\.?$/i
            );

        if (!match) {
            return null;
        }

        actor =
            String(match[1] || "").trim();

        quantity =
            Math.max(
                1,
                Number(
                    String(match[2] || "1")
                        .replace(/,/g, "")
                ) || 1
            );

        itemName =
            String(match[3] || "").trim();
    }

    if (
        !itemName ||
        /^points?$/i.test(itemName)
    ) {
        return null;
    }

    return {
        id:
            String(entry?.id || ""),
        timestamp:
            Number(entry?.timestamp || 0) || 0,
        actor,
        itemName,
        quantity,
        text
    };
}

function latestArmoryCategoryMap() {
    const snapshots =
        Array.isArray(armoryDatabase?.snapshots)
            ? armoryDatabase.snapshots
            : [];

    if (!snapshots.length) {
        return new Map();
    }

    const latest =
        snapshots
            .slice()
            .sort(
                (a, b) =>
                    Number(b?.ts || 0) -
                    Number(a?.ts || 0)
            )[0];

    const map =
        new Map();

    for (
        const item
        of Array.isArray(latest?.items)
            ? latest.items
            : []
    ) {
        const name =
            String(item?.name || "")
                .trim()
                .toLowerCase();

        const category =
            String(item?.category || "")
                .trim()
                .toLowerCase();

        if (
            name &&
            ["drugs", "medical", "temporary"].includes(category)
        ) {
            map.set(name, category);
        }
    }

    return map;
}

function inferConsumableCategory(
    itemName,
    categoryMap
) {
    const key =
        String(itemName || "")
            .trim()
            .toLowerCase();

    if (categoryMap.has(key)) {
        return categoryMap.get(key);
    }

    // High-confidence fallback for the key drug the user specifically wants.
    if (key === "xanax") {
        return "drugs";
    }

    return "other";
}

async function fetchTornFactionNewsPage({
    from,
    to,
    limit = 100,
    sort = "asc"
}) {
    const url =
        new URL(
            "https://api.torn.com/v2/faction/news"
        );

    url.searchParams.set(
        "cat",
        "armoryAction"
    );
    url.searchParams.set(
        "limit",
        String(limit)
    );
    url.searchParams.set(
        "sort",
        sort
    );
    url.searchParams.set(
        "from",
        String(from)
    );
    url.searchParams.set(
        "to",
        String(to)
    );
    url.searchParams.set(
        "stripTags",
        "true"
    );
    url.searchParams.set(
        "key",
        TORN_FACTION_API_KEY
    );

    const response =
        await fetch(
            url,
            {
                method: "GET",
                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );

    let data = null;

    try {
        data =
            await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const error =
            new Error(
                data?.error?.error ||
                data?.error ||
                data?.message ||
                `Torn HTTP ${response.status}`
            );

        error.status =
            response.status;
        error.tornData =
            data;

        throw error;
    }

    if (data?.error) {
        const error =
            new Error(
                data?.error?.error ||
                data?.error?.message ||
                "Torn API error"
            );

        error.tornData =
            data;

        throw error;
    }

    return data || {};
}

async function fetchFactionArmoryUseHistory(
    days
) {
    const end =
        Math.floor(
            Date.now() / 1000
        );

    const start =
        end -
        days *
        24 *
        60 *
        60;

    const seen =
        new Set();

    const rows = [];

    let cursor =
        start;

    // Safety cap: 30 days of a normal faction should be far below this.
    for (
        let page = 0;
        page < 250;
        page += 1
    ) {
        const data =
            await fetchTornFactionNewsPage({
                from: cursor,
                to: end,
                limit: 100,
                sort: "asc"
            });

        const news =
            Array.isArray(data?.news)
                ? data.news
                : (
                    data?.news &&
                    typeof data.news === "object"
                        ? Object.values(data.news)
                        : []
                );

        if (!news.length) {
            break;
        }

        let maxTimestamp =
            cursor;

        let addedThisPage =
            0;

        for (const entry of news) {
            const id =
                String(
                    entry?.id ||
                    `${entry?.timestamp || 0}:${entry?.text || entry?.news || ""}`
                );

            maxTimestamp =
                Math.max(
                    maxTimestamp,
                    Number(entry?.timestamp || 0) || 0
                );

            if (seen.has(id)) {
                continue;
            }

            seen.add(id);
            rows.push(entry);
            addedThisPage += 1;
        }

        if (
            news.length < 100 ||
            maxTimestamp >= end
        ) {
            break;
        }

        // Torn pagination can repeat the boundary item.
        // Advance one second and deduplicate IDs.
        const nextCursor =
            Math.max(
                cursor + 1,
                maxTimestamp + 1
            );

        if (nextCursor <= cursor) {
            break;
        }

        cursor =
            nextCursor;

        if (!addedThisPage) {
            break;
        }
    }

    return {
        start,
        end,
        news: rows
    };
}

app.get(
    "/api/micc/armory/news-usage",
    auth,
    async (req, res) => {
        if (!tornFactionApiConfigured()) {
            return res.json({
                available: false,
                source: "torn-faction-news",
                reason:
                    "TORN_FACTION_API_KEY is not configured on the MICC server."
            });
        }

        const days =
            safeArmoryUsageDays(
                req.query?.days
            );

        try {
            const history =
                await fetchFactionArmoryUseHistory(
                    days
                );

            const categoryMap =
                latestArmoryCategoryMap();

            const parsed =
                history.news
                    .map(
                        parseFactionArmoryUseNews
                    )
                    .filter(Boolean);

            const itemMap =
                new Map();

            const memberMap =
                new Map();

            let totalUsed = 0;

            const categories = {
                drugs: 0,
                medical: 0,
                temporary: 0,
                other: 0
            };

            for (const event of parsed) {
                const category =
                    inferConsumableCategory(
                        event.itemName,
                        categoryMap
                    );

                const itemKey =
                    event.itemName
                        .trim()
                        .toLowerCase();

                const item =
                    itemMap.get(itemKey) || {
                        name:
                            event.itemName,
                        category,
                        used: 0,
                        events: 0
                    };

                item.used +=
                    event.quantity;
                item.events += 1;

                if (
                    item.category === "other" &&
                    category !== "other"
                ) {
                    item.category =
                        category;
                }

                itemMap.set(
                    itemKey,
                    item
                );

                const actor =
                    event.actor || "Unknown";

                const member =
                    memberMap.get(actor) || {
                        name: actor,
                        used: 0,
                        xanax: 0
                    };

                member.used +=
                    event.quantity;

                if (
                    itemKey === "xanax"
                ) {
                    member.xanax +=
                        event.quantity;
                }

                memberMap.set(
                    actor,
                    member
                );

                totalUsed +=
                    event.quantity;

                categories[
                    Object.prototype.hasOwnProperty.call(
                        categories,
                        category
                    )
                        ? category
                        : "other"
                ] +=
                    event.quantity;
            }

            const items =
                [...itemMap.values()]
                    .sort(
                        (a, b) =>
                            Number(b.used || 0) -
                            Number(a.used || 0) ||
                            a.name.localeCompare(b.name)
                    );

            const members =
                [...memberMap.values()]
                    .sort(
                        (a, b) =>
                            Number(b.xanax || 0) -
                            Number(a.xanax || 0) ||
                            Number(b.used || 0) -
                            Number(a.used || 0) ||
                            a.name.localeCompare(b.name)
                    );

            const xanax =
                items.find(
                    item =>
                        item.name
                            .trim()
                            .toLowerCase() ===
                        "xanax"
                )?.used || 0;

            return res.json({
                available: true,
                source:
                    "torn-faction-news",
                days,
                from:
                    history.start,
                to:
                    history.end,
                rawNewsCount:
                    history.news.length,
                parsedUseEvents:
                    parsed.length,
                totalUsed,
                xanax,
                categories,
                items,
                members
            });

        } catch (error) {
            return res.json({
                available: false,
                source:
                    "torn-faction-news",
                reason:
                    error?.message ||
                    "Torn faction armory news request failed.",
                code:
                    error?.tornData?.error?.code ??
                    null
            });
        }
    }
);

app.post(
    "/api/micc/armory/snapshot",
    auth,
    (req, res) => {
        const incomingItems =
            Array.isArray(
                req.body?.items
            )
                ? req.body.items
                : [];

        if (!incomingItems.length) {
            return res.status(400).json({
                success: false,
                error:
                    "No armory items supplied"
            });
        }

        if (
            incomingItems.length >
            5000
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Too many armory rows in one snapshot"
            });
        }

        const items =
            incomingItems
                .map(
                    normalizeArmoryIncomingItem
                )
                .filter(Boolean);

        if (!items.length) {
            return res.status(400).json({
                success: false,
                error:
                    "No valid armory items supplied"
            });
        }

        const now =
            Date.now();

        const requestedObservedAt =
            Number(
                req.body?.observedAt ||
                now
            );

        const observedAt =
            Number.isFinite(
                requestedObservedAt
            )
                ? Math.min(
                    now + 60000,
                    Math.max(
                        now -
                        90 * 60 * 1000,
                        requestedObservedAt
                    )
                )
                : now;

        const sourceTimestamps =
            req.body?.sourceTimestamps &&
            typeof req.body
                .sourceTimestamps ===
                "object"
                ? Object.fromEntries(
                    Object.entries(
                        req.body
                            .sourceTimestamps
                    )
                        .slice(0, 20)
                        .map(
                            ([key, value]) => [
                                String(key)
                                    .slice(0, 30),
                                Number(
                                    value || 0
                                ) || 0
                            ]
                        )
                )
                : {};

        const key =
            armorySnapshotKey(
                sourceTimestamps,
                items
            );

        const snapshot = {
            ts:
                observedAt,
            key,
            sourceTimestamps,
            items
        };

        if (
            !Array.isArray(
                armoryDatabase.snapshots
            )
        ) {
            armoryDatabase
                .snapshots = [];
        }

        const last =
            armoryDatabase
                .snapshots[
                    armoryDatabase
                        .snapshots
                        .length - 1
                ];

        if (
            last &&
            String(last.key || "") ===
                key
        ) {
            // Same Torn cache snapshot: refresh it rather than
            // creating fake extra history points.
            armoryDatabase.snapshots[
                armoryDatabase
                    .snapshots
                    .length - 1
            ] = {
                ...snapshot,
                ts:
                    Number(
                        last.ts ||
                        observedAt
                    )
            };
        } else {
            armoryDatabase
                .snapshots
                .push(snapshot);
        }

        pruneArmoryDatabase(
            now
        );

        saveArmoryDatabase();

        res.json({
            success: true,
            snapshots:
                armoryDatabase
                    .snapshots.length,
            distinct:
                !last ||
                String(
                    last.key || ""
                ) !== key,
            metrics:
                getArmoryMetrics(
                    snapshot
                )
        });
    }
);

app.get(
    "/api/micc/armory/summary",
    auth,
    (req, res) => {
        const requestedDays =
            Number(
                req.query?.days ||
                7
            );

        const days =
            [1, 7, 30].includes(
                requestedDays
            )
                ? requestedDays
                : 7;

        const now =
            Date.now();

        pruneArmoryDatabase(
            now
        );

        const since =
            now -
            days *
            24 *
            60 *
            60 *
            1000;

        const snapshots =
            (Array.isArray(
                armoryDatabase
                    .snapshots
            )
                ? armoryDatabase
                    .snapshots
                : []
            )
                .filter(
                    snapshot =>
                        Number(
                            snapshot?.ts ||
                            0
                        ) >= since
                )
                .sort(
                    (a, b) =>
                        Number(
                            a.ts || 0
                        ) -
                        Number(
                            b.ts || 0
                        )
                );

        if (!snapshots.length) {
            return res.json({
                success: true,
                days,
                overview: {},
                collection: {
                    snapshotCount: 0,
                    spanMs: 0,
                    readyHistory: false,
                    readyAlerts: false
                },
                lowStock: [],
                recentChanges: [],
                alerts: [],
                usage: {
                    snapshotCount: 0,
                    spanMs: 0,
                    categories: {
                        drugs: 0,
                        medical: 0,
                        temporary: 0
                    },
                    addedCategories: {
                        drugs: 0,
                        medical: 0,
                        temporary: 0
                    },
                    items: []
                },
                history: [],
                forecast: {
                    xanax: {
                        ready: false,
                        consumptionPerDay: 0,
                        daysRemaining: null,
                        recommendedRestock: 0,
                        targetStock: 500
                    }
                },
                inventory: []
            });
        }

        const latest =
            snapshots[
                snapshots.length - 1
            ];

        const previous =
            snapshots.length >= 2
                ? snapshots[
                    snapshots.length - 2
                ]
                : null;

        const spanMs =
            Math.max(
                0,
                Number(
                    latest.ts || 0
                ) -
                Number(
                    snapshots[0]
                        ?.ts || 0
                )
            );

        const readyHistory =
            snapshots.length >= 3 &&
            spanMs >=
                2 *
                60 *
                60 *
                1000;

        const readyAlerts =
            snapshots.length >= 6 &&
            spanMs >=
                5 *
                60 *
                60 *
                1000;

        const history =
            snapshots.map(
                snapshot => ({
                    ts:
                        Number(
                            snapshot.ts ||
                            0
                        ),
                    metrics:
                        getArmoryMetrics(
                            snapshot
                        )
                })
            );

        const usage =
            buildArmoryConsumableUsage(
                snapshots
            );

        res.json({
            success: true,
            days,
            observedAt: now,
            overview:
                getArmoryMetrics(
                    latest
                ),
            collection: {
                snapshotCount:
                    snapshots.length,
                spanMs,
                readyHistory,
                readyAlerts,
                firstSnapshot:
                    Number(
                        snapshots[0]
                            ?.ts || 0
                    ),
                lastSnapshot:
                    Number(
                        latest?.ts || 0
                    )
            },
            lowStock:
                getArmoryLowStock(
                    latest,
                    usage
                ),
            recentChanges:
                buildArmoryRecentChanges(
                    latest,
                    previous
                ),
            usage,
            alerts:
                buildArmoryAlerts(
                    snapshots,
                    readyAlerts
                ),
            history,
            forecast:
                buildArmoryForecast(
                    snapshots
                ),
            inventory:
                buildArmoryInventoryRows(
                    latest
                )
        });
    }
);

app.get(
    "/api/micc/armory/debug",
    auth,
    (req, res) => {
        pruneArmoryDatabase();

        const snapshots =
            Array.isArray(
                armoryDatabase
                    .snapshots
            )
                ? armoryDatabase
                    .snapshots
                : [];

        res.json({
            success: true,
            snapshots:
                snapshots.length,
            retentionDays:
                ARMORY_RETENTION_MS /
                (
                    24 *
                    60 *
                    60 *
                    1000
                ),
            latestMetrics:
                snapshots.length
                    ? getArmoryMetrics(
                        snapshots[
                            snapshots.length - 1
                        ]
                    )
                    : {}
        });
    }
);


// ============================================================
// JSON 404
// ============================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "MICC route not found",
        method: req.method,
        path: req.path
    });
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
    console.error(
        "[MICC] Server error:",
        error
    );

    res.status(500).json({
        success: false,
        error: "MICC server error"
    });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("       MICC Faction Status Relay");
    console.log("======================================");
    console.log("");
    console.log(`Server: http://localhost:${PORT}`);
    console.log("");
    console.log("Routes:");
    console.log("  GET  /");
    console.log("  GET  /api/micc/status");
    console.log("  POST /api/micc/status");
    console.log("  GET  /api/micc/calendar");
    console.log("  POST /api/micc/calendar/event");
    console.log("  POST /api/micc/calendar/note");
    console.log("  POST /api/micc/activity/observe");
    console.log("  GET  /api/micc/activity/summary");
    console.log("  GET  /api/micc/activity/member/:id");
    console.log("  GET  /api/micc/activity/faction");
    console.log("  GET  /api/micc/ffscouter/player/:id");
    console.log("  GET  /api/micc/ffscouter/faction");
    console.log("  POST /api/micc/armory/snapshot");
    console.log("  GET  /api/micc/armory/summary");
    console.log("  GET  /api/micc/armory/news-usage");
    console.log("");
    console.log("MICC, Made by RobertHarvey.");
    console.log("");
});
