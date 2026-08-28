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
        version: "0.9.0",
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
    console.log("");
    console.log("MICC, Made by RobertHarvey.");
    console.log("");
});
