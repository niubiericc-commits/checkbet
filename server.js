const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.ODDS_API_KEY;
const API_BASE = "https://api.the-odds-api.com/v4";

app.use(express.json());

/* =========================================================
   基础设置
========================================================= */

const REGION = "eu";

/*
  只允许前端请求 API 实际报告存在的 market。
  不自己虚构盘口。
*/
const MARKET_LIMIT = 28;

/*
  简单内存缓存。
  Render 重启后自动清空。
*/
const cache = new Map();

function getCache(key) {
    const item = cache.get(key);

    if (!item) return null;

    if (Date.now() > item.expires) {
        cache.delete(key);
        return null;
    }

    return item.data;
}

function setCache(key, data, ttl) {
    cache.set(key, {
        data,
        expires: Date.now() + ttl
    });
}

/* =========================================================
   赔率处理
========================================================= */

function convertOdds(price) {
    const n = Number(price);

    if (!Number.isFinite(n)) {
        return null;
    }

    return Number(
        Math.max(1.01, n * 0.85).toFixed(2)
    );
}

function transformOutcome(outcome) {
    const price = convertOdds(outcome.price);

    if (price === null) return null;

    return {
        name: outcome.name || "",
        description: outcome.description || "",
        point: outcome.point ?? null,
        price
    };
}

function transformBookmaker(bookmaker) {
    return {
        key: bookmaker.key,
        title: bookmaker.title,

        markets: (bookmaker.markets || []).map(market => ({
            key: market.key,
            last_update: market.last_update || null,

            outcomes: (market.outcomes || [])
                .map(transformOutcome)
                .filter(Boolean)
        }))
    };
}

function transformEvent(event) {
    return {
        id: event.id,
        sport_key: event.sport_key,
        sport_title: event.sport_title,
        commence_time: event.commence_time,
        home_team: event.home_team,
        away_team: event.away_team,

        bookmakers: (event.bookmakers || [])
            .map(transformBookmaker)
    };
}

/* =========================================================
   通用上游请求
========================================================= */

async function upstream(url) {
    const response = await fetch(url);

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `上游返回非 JSON。HTTP ${response.status}: ` +
            text.substring(0, 180)
        );
    }

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            JSON.stringify(data);

        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return {
        data,

        quota: {
            remaining:
                response.headers.get("x-requests-remaining"),

            used:
                response.headers.get("x-requests-used"),

            last:
                response.headers.get("x-requests-last")
        }
    };
}

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        server: "SPORTS+ DETAIL",
        apiKeyConfigured: Boolean(API_KEY),
        time: new Date().toISOString()
    });
});

/* =========================================================
   SPORTS
========================================================= */

app.get("/api/sports", async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({
            error: "ODDS_API_KEY 没有配置"
        });
    }

    try {
        const cacheKey = "sports";

        const cached = getCache(cacheKey);

        if (cached) {
            return res.json(cached);
        }

        const params = new URLSearchParams({
            apiKey: API_KEY
        });

        const result = await upstream(
            `${API_BASE}/sports/?${params}`
        );

        const sports = (result.data || [])
            .filter(x => x.active)
            .filter(x => !x.has_outrights);

        const payload = {
            success: true,
            sports
        };

        setCache(
            cacheKey,
            payload,
            30 * 60 * 1000
        );

        res.json(payload);

    } catch (error) {
        console.error("SPORTS:", error);

        res.status(error.status || 500).json({
            error: error.message
        });
    }
});

/* =========================================================
   获取某联赛比赛
   /events 不需要先加载所有赔率
========================================================= */

app.get("/api/events/:sport", async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({
            error: "ODDS_API_KEY 没有配置"
        });
    }

    try {
        const sport = req.params.sport;

        const cacheKey = `events:${sport}`;

        const cached = getCache(cacheKey);

        if (cached) {
            return res.json(cached);
        }

        const params = new URLSearchParams({
            apiKey: API_KEY,
            dateFormat: "iso"
        });

        const result = await upstream(
            `${API_BASE}/sports/` +
            `${encodeURIComponent(sport)}/events?${params}`
        );

        const events = (result.data || []).map(event => ({
            id: event.id,
            sport_key: event.sport_key,
            sport_title: event.sport_title,
            commence_time: event.commence_time,
            home_team: event.home_team,
            away_team: event.away_team
        }));

        const payload = {
            success: true,
            sport,
            events,
            quota: result.quota
        };

        setCache(
            cacheKey,
            payload,
            60 * 1000
        );

        res.json(payload);

    } catch (error) {
        console.error("EVENTS:", error);

        res.status(error.status || 500).json({
            error: error.message
        });
    }
});

/* =========================================================
   获取单场目前存在的盘口
========================================================= */

app.get(
    "/api/event/:sport/:eventId/markets",
    async (req, res) => {

        if (!API_KEY) {
            return res.status(500).json({
                error: "ODDS_API_KEY 没有配置"
            });
        }

        try {
            const { sport, eventId } = req.params;

            const cacheKey =
                `markets:${sport}:${eventId}`;

            const cached = getCache(cacheKey);

            if (cached) {
                return res.json(cached);
            }

            const params = new URLSearchParams({
                apiKey: API_KEY,
                regions: REGION,
                dateFormat: "iso"
            });

            const result = await upstream(
                `${API_BASE}/sports/` +
                `${encodeURIComponent(sport)}/events/` +
                `${encodeURIComponent(eventId)}/markets?${params}`
            );

            /*
              汇总所有 bookmaker 的 market keys
            */

            const marketSet = new Set();

            const bookmakers =
                result.data?.bookmakers || [];

            bookmakers.forEach(bookmaker => {
                (bookmaker.markets || [])
                    .forEach(market => {
                        if (market.key) {
                            marketSet.add(market.key);
                        }
                    });
            });

            const markets =
                Array.from(marketSet);

            const payload = {
                success: true,
                event: {
                    id: result.data?.id,
                    sport_key:
                        result.data?.sport_key,
                    sport_title:
                        result.data?.sport_title,
                    commence_time:
                        result.data?.commence_time,
                    home_team:
                        result.data?.home_team,
                    away_team:
                        result.data?.away_team
                },
                markets,
                bookmakerCount:
                    bookmakers.length,
                quota:
                    result.quota
            };

            setCache(
                cacheKey,
                payload,
                90 * 1000
            );

            res.json(payload);

        } catch (error) {
            console.error(
                "EVENT MARKETS:",
                error
            );

            res.status(
                error.status || 500
            ).json({
                error: error.message
            });
        }
    }
);

/* =========================================================
   获取单场详细赔率
========================================================= */

app.get(
    "/api/event/:sport/:eventId/odds",
    async (req, res) => {

        if (!API_KEY) {
            return res.status(500).json({
                error: "ODDS_API_KEY 没有配置"
            });
        }

        try {
            const { sport, eventId } = req.params;

            let markets = String(
                req.query.markets || "h2h"
            )
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);

            /*
              防止一次请求无限 markets
            */
            markets = [
                ...new Set(markets)
            ].slice(0, MARKET_LIMIT);

            if (!markets.length) {
                markets = ["h2h"];
            }

            const marketString =
                markets.join(",");

            const cacheKey =
                `odds:${sport}:${eventId}:${marketString}`;

            const cached = getCache(cacheKey);

            if (cached) {
                return res.json(cached);
            }

            const params = new URLSearchParams({
                apiKey: API_KEY,
                regions: REGION,
                markets: marketString,
                oddsFormat: "decimal",
                dateFormat: "iso"
            });

            const result = await upstream(
                `${API_BASE}/sports/` +
                `${encodeURIComponent(sport)}/events/` +
                `${encodeURIComponent(eventId)}/odds?${params}`
            );

            const event =
                transformEvent(result.data);

            const payload = {
                success: true,
                event,
                requestedMarkets: markets,
                quota: result.quota
            };

            /*
              赔率只缓存 30 秒
            */
            setCache(
                cacheKey,
                payload,
                30 * 1000
            );

            res.json(payload);

        } catch (error) {
            console.error(
                "EVENT ODDS:",
                error
            );

            res.status(
                error.status || 500
            ).json({
                error: error.message
            });
        }
    }
);

/* =========================================================
   API 404
========================================================= */

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "API 地址不存在",
        path: req.originalUrl
    });
});

/* =========================================================
   STATIC
========================================================= */

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.get("/", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log("==============================");
    console.log("SPORTS+ DETAIL SERVER");
    console.log("PORT:", PORT);
    console.log(
        "ODDS API KEY:",
        API_KEY ? "YES" : "NO"
    );
    console.log("==============================");
});
