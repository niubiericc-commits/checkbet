const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ODDS_API_KEY;

app.use(express.static(path.join(__dirname, "public")));

const API_BASE = "https://api.the-odds-api.com/v4";

// 内部赔率处理
function finalOdds(decimalOdds) {
    const n = Number(decimalOdds);

    if (!Number.isFinite(n)) return null;

    return Number(
        Math.max(1.01, n * 0.85).toFixed(2)
    );
}

function transformOutcome(outcome) {
    return {
        name: outcome.name,
        price: finalOdds(outcome.price),
        point: outcome.point ?? null
    };
}

function transformBookmaker(bookmaker) {
    return {
        key: bookmaker.key,
        title: bookmaker.title,

        markets: bookmaker.markets.map(market => ({
            key: market.key,

            outcomes: market.outcomes
                .map(transformOutcome)
                .filter(x => x.price !== null)
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

        bookmakers:
            (event.bookmakers || [])
                .map(transformBookmaker)
    };
}

// 获取支持的体育项目
app.get("/api/sports", async (req, res) => {

    if (!API_KEY) {
        return res.status(500).json({
            error: "服务器没有配置 ODDS_API_KEY"
        });
    }

    try {

        const url =
            `${API_BASE}/sports/?apiKey=${API_KEY}`;

        const response = await fetch(url);

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "无法获取体育项目"
        });
    }
});

// 获取某个体育项目赛事
app.get("/api/odds/:sport", async (req, res) => {

    if (!API_KEY) {
        return res.status(500).json({
            error: "服务器没有配置 ODDS_API_KEY"
        });
    }

    try {

        const sport = encodeURIComponent(req.params.sport);

        const markets =
            req.query.markets ||
            "h2h,spreads,totals";

        const url =
            `${API_BASE}/sports/${sport}/odds/` +
            `?apiKey=${API_KEY}` +
            `&regions=us,uk,eu` +
            `&markets=${encodeURIComponent(markets)}` +
            `&oddsFormat=decimal` +
            `&dateFormat=iso`;

        const response = await fetch(url);

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const transformed =
            data.map(transformEvent);

        res.json({
            updated: new Date().toISOString(),

            remaining:
                response.headers.get(
                    "x-requests-remaining"
                ),

            events: transformed
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "获取赔率失败"
        });
    }
});

// 首页
app.get("*", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
