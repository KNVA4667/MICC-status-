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

const DATA_FILE =
    path.join(__dirname, "micc-status.json");

const CALENDAR_FILE =
    path.join(__dirname, "micc-calendar.json");

const ACTIVITY_FILE =
    path.join(__dirname, "micc-activity.json");

const ACTIVITY_BUCKET_MS =
    10 * 60 * 1000;

const ACTIVITY_RETENTION_MS =
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
                : 0
    };
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
        version: "0.9.2",
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
    console.log("");
    console.log("MICC, Made by RobertHarvey.");
    console.log("");
});
