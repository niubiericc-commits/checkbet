const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.ODDS_API_KEY;

const API_BASE = "https://api.the-odds-api.com/v4";
const REGION = "eu";

/*
 * 页面允许使用的体育项目。
 */
const SPORTS = {
    soccer_epl: "英超",
    soccer_spain_la_liga: "西甲",
    soccer_germany_bundesliga: "德甲",
    soccer_italy_serie_a: "意甲",
    soccer_france_ligue_one: "法甲",
    soccer_usa_mls: "MLS"
};


/*
 * 前端 sportsbook 分类需要的盘口。
 *
 * API 某场比赛没有的盘口不会伪造，
 * 只返回真实存在的数据。
 */
const REQUESTED_MARKETS = [
    // Popular / Goals
    "h2h",
    "spreads",
    "alternate_spreads",
    "totals",
    "alternate_totals",
    "btts",
    "double_chance",
    "draw_no_bet",
    "team_totals",
    "alternate_team_totals",

    // Halves
    "h2h_h1",
    "spreads_h1",
    "totals_h1",
    "btts_h1",
    "correct_score_h1",
    "halftime_fulltime",

    // Score / Game Props
    "correct_score",

    // Corners
    "corners",
    "alternate_corners",
    "team_corners",
    "alternate_team_corners",

    // Cards / Specials
    "cards",
    "alternate_cards",

    // Goalscorers
    "player_goal_scorer_anytime",
    "player_goal_scorer_first",
    "player_goal_scorer_last",

    // Player Props / Shots
    "player_shots",
    "player_shots_on_target",
    "player_assists",
    "player_cards",
    "player_to_receive_card",
    "player_to_receive_red_card"
];


/*
 * 简单内存缓存。
 */
const cache = new Map();

function getCache(key) {
    const item = cache.get(key);

    if (!item) {
        return null;
    }

    if (Date.now() > item.expires) {
        cache.delete(key);
        return null;
    }

    return item.value;
}

function setCache(key, value, ttl = 60000) {
    cache.set(key, {
        value,
        expires: Date.now() + ttl
    });
}


/*
 * 内部显示赔率转换。
 */
function convertOdds(price) {
    const number = Number(price);

    if (!Number.isFinite(number)) {
        return price;
    }

    return Number(
        Math.max(1.01, number * 0.85).toFixed(2)
    );
}


/*
 * 把 event 中所有 bookmaker 的赔率转换。
 */
function transformEvent(event) {
    if (!event || typeof event !== "object") {
        return event;
    }

    return {
        ...event,

        bookmakers: Array.isArray(event.bookmakers)
            ? event.bookmakers.map(bookmaker => ({
                ...bookmaker,

                markets: Array.isArray(bookmaker.markets)
                    ? bookmaker.markets.map(market => ({
                        ...market,

                        outcomes: Array.isArray(market.outcomes)
                            ? market.outcomes.map(outcome => ({
                                ...outcome,
                                price: convertOdds(outcome.price)
                            }))
                            : []
                    }))
                    : []
            }))
            : []
    };
}


/*
 * 请求 The Odds API。
 */
async function upstream(url) {
    const response = await fetch(url);

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Odds API 返回非 JSON 内容，HTTP ${response.status}`
        );
    }

    const quota = {
        remaining:
            response.headers.get("x-requests-remaining"),

        used:
            response.headers.get("x-requests-used"),

        last:
            response.headers.get("x-requests-last")
    };

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            `Odds API HTTP ${response.status}`;

        const error = new Error(message);
        error.status = response.status;
        error.quota = quota;

        throw error;
    }

    return {
        data,
        quota
    };
}


/* ============================================================
   STATUS
============================================================ */

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        server: "SPORTS+ BOOK",
        apiKeyConfigured: Boolean(API_KEY),
        time: new Date().toISOString()
    });
});


/* ============================================================
   SPORTS
============================================================ */

app.get("/api/sports", (req, res) => {
    res.json({
        sports: Object.entries(SPORTS).map(
            ([key, title]) => ({
                key,
                title
            })
        )
    });
});


/* ============================================================
   EVENTS
============================================================ */

app.get("/api/events/:sport", async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(500).json({
                error: "ODDS_API_KEY 未配置"
            });
        }

        const sport = req.params.sport;

        if (!SPORTS[sport]) {
            return res.status(400).json({
                error: "不支持的联赛"
            });
        }

        const cacheKey = `events:${sport}`;

        const cached = getCache(cacheKey);

        if (cached) {
            return res.json({
                ...cached,
                cached: true
            });
        }

        const url =
            `${API_BASE}/sports/${encodeURIComponent(sport)}/events` +
            `?apiKey=${encodeURIComponent(API_KEY)}` +
            `&dateFormat=iso`;

        const result = await upstream(url);

        const events = Array.isArray(result.data)
            ? result.data
            : [];

        const payload = {
            sport,
            events,
            quota: result.quota
        };

        setCache(cacheKey, payload, 60000);

        res.json(payload);

    } catch (error) {
        console.error("EVENTS ERROR:", error);

        res.status(error.status || 500).json({
            error: error.message || "读取比赛失败",
            quota: error.quota || null
        });
    }
});


/* ============================================================
   AVAILABLE MARKETS FOR ONE EVENT
============================================================ */

app.get(
    "/api/event/:sport/:eventId/markets",
    async (req, res) => {
        try {
            if (!API_KEY) {
                return res.status(500).json({
                    error: "ODDS_API_KEY 未配置"
                });
            }

            const {
                sport,
                eventId
            } = req.params;

            if (!SPORTS[sport]) {
                return res.status(400).json({
                    error: "不支持的联赛"
                });
            }

            const cacheKey =
                `markets:${sport}:${eventId}`;

            const cached =
                getCache(cacheKey);

            if (cached) {
                return res.json({
                    ...cached,
                    cached: true
                });
            }

            const url =
                `${API_BASE}/sports/${encodeURIComponent(sport)}` +
                `/events/${encodeURIComponent(eventId)}/markets` +
                `?apiKey=${encodeURIComponent(API_KEY)}` +
                `&regions=${encodeURIComponent(REGION)}` +
                `&dateFormat=iso`;

            const result =
                await upstream(url);

            const event =
                result.data || {};

            const available =
                new Set();

            const bookmakers =
                Array.isArray(event.bookmakers)
                    ? event.bookmakers
                    : [];

            bookmakers.forEach(bookmaker => {
                const markets =
                    Array.isArray(bookmaker.markets)
                        ? bookmaker.markets
                        : [];

                markets.forEach(market => {
                    if (market?.key) {
                        available.add(market.key);
                    }
                });
            });

            const markets =
                [...available];

            const payload = {
                sport,
                eventId,
                markets,
                quota: result.quota
            };

            setCache(
                cacheKey,
                payload,
                120000
            );

            res.json(payload);

        } catch (error) {
            console.error(
                "MARKETS ERROR:",
                error
            );

            res.status(error.status || 500).json({
                error:
                    error.message ||
                    "读取盘口列表失败",

                quota:
                    error.quota ||
                    null
            });
        }
    }
);


/* ============================================================
   ODDS FOR ONE EVENT
============================================================ */

app.get(
    "/api/event/:sport/:eventId/odds",
    async (req, res) => {
        try {
            if (!API_KEY) {
                return res.status(500).json({
                    error: "ODDS_API_KEY 未配置"
                });
            }

            const {
                sport,
                eventId
            } = req.params;

            if (!SPORTS[sport]) {
                return res.status(400).json({
                    error: "不支持的联赛"
                });
            }

            /*
             * 前端可以指定 markets。
             *
             * 如果没指定，则使用我们 sportsbook
             * 需要的盘口集合。
             */
            let requestedMarkets = [];

            if (req.query.markets) {
                requestedMarkets =
                    String(req.query.markets)
                        .split(",")
                        .map(x => x.trim())
                        .filter(Boolean);
            }

            if (!requestedMarkets.length) {
                requestedMarkets =
                    [...REQUESTED_MARKETS];
            }

            /*
             * 去重。
             */
            requestedMarkets =
                [...new Set(requestedMarkets)];

            /*
             * 只允许我们认可的盘口，
             * 防止前端乱传。
             */
            requestedMarkets =
                requestedMarkets.filter(
                    key =>
                        REQUESTED_MARKETS.includes(key)
                );

            if (!requestedMarkets.length) {
                return res.status(400).json({
                    error: "没有可请求的盘口"
                });
            }

            const cacheKey =
                `odds:${sport}:${eventId}:` +
                requestedMarkets.sort().join(",");

            const cached =
                getCache(cacheKey);

            if (cached) {
                return res.json({
                    ...cached,
                    cached: true
                });
            }

            const url =
                `${API_BASE}/sports/${encodeURIComponent(sport)}` +
                `/events/${encodeURIComponent(eventId)}/odds` +
                `?apiKey=${encodeURIComponent(API_KEY)}` +
                `&regions=${encodeURIComponent(REGION)}` +
                `&markets=${encodeURIComponent(requestedMarkets.join(","))}` +
                `&oddsFormat=decimal` +
                `&dateFormat=iso`;

            const result =
                await upstream(url);

            const transformed =
                transformEvent(result.data);

            const payload = {
                sport,
                eventId,
                requestedMarkets,
                event: transformed,
                quota: result.quota
            };

            setCache(
                cacheKey,
                payload,
                45000
            );

            res.json(payload);

        } catch (error) {
            console.error(
                "ODDS ERROR:",
                error
            );

            res.status(error.status || 500).json({
                error:
                    error.message ||
                    "读取赔率失败",

                quota:
                    error.quota ||
                    null
            });
        }
    }
);


/* ============================================================
   API 404
============================================================ */

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "API 地址不存在"
    });
});


/* ============================================================
   FRONTEND
============================================================ */

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


/* ============================================================
   START
============================================================ */

app.listen(PORT, () => {
    console.log("SPORTS+ BOOK SERVER");
    console.log("PORT:", PORT);
    console.log(
        "ODDS API KEY:",
        API_KEY ? "YES" : "NO"
    );
});
