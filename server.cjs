const express = require("express");
const fs = require("fs");
const path = require("path");

// ============================================================
// MICC FACTION STATUS RELAY
// Made by RobertHarvey
// ============================================================

const app = express();

const PORT = 3002;
const MICC_SECRET = "MICC-r8K42-xP91-2026";

const DATA_FILE = path.join(__dirname, "micc-status.json");

// Remove members who haven't updated for 24 hours.
const MAX_STATUS_AGE = 24 * 60 * 60 * 1000;

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
        "GET, POST, OPTIONS"
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

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

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
        version: "0.7.2",
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
            drug,
            booster
        } = req.body || {};

        // ----------------------------------------
        // Validate player
        // ----------------------------------------

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

        // ----------------------------------------
        // Store status
        // ----------------------------------------

        database[id] = {
            playerId: Number(playerId),

            name: String(name),

            energy:
                Number(energy) || 0,

            energyMax:
                Number(energyMax) || 0,

            drug:
                Number(drug) || 0,

            booster:
                Number(booster) || 0,

            updated:
                Date.now()
        };

        saveDatabase();

        console.log(
            `[MICC] Updated ${name} [${playerId}]`
        );

        console.log(
            `       Energy: ${database[id].energy}/${database[id].energyMax}`
        );

        console.log(
            `       Drug CD: ${database[id].drug}s`
        );

        console.log(
            `       Booster CD: ${database[id].booster}s`
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

        // ----------------------------------------
        // Remove expired entries
        // ----------------------------------------

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

        // ----------------------------------------
        // Return faction statuses
        // ----------------------------------------

        res.json({
            success: true,
            members: Object.values(database)
        });
    }
);

// ============================================================
// JSON 404
// Prevent Express from returning HTML errors
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
    console.log("");
    console.log("MICC, Made by RobertHarvey.");
    console.log("");
});