const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.ODDS_API_KEY;

const API_BASE = "https://api.the-odds-api.com/v4";

app.use(express.json());


// ===============================
// 测试服务器
// ===============================

app.get("/api/status", (req, res) => {
    res.status(200).json({
        ok: true,
        server: "SPORTS+",
        apiKeyConfigured: Boolean(API_KEY),
        time: new Date().toISOString()
    });
});


// ===============================
// 获取体育项目
// ===============================

app.get("/api/sports", async (req, res) => {

    if (!API_KEY) {
        return res.status(500).json({
            error: "ODDS_API_KEY 没有配置"
        });
    }

    try {

        const url =
            `${API_BASE}/sports/?apiKey=${encodeURIComponent(API_KEY)}`;

        const response = await fetch(url);

        const text = await response.text();

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            return res.status(502).json({
                error: "赔率服务器返回的不是 JSON",
                status: response.status,
                response: text.substring(0, 300)
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                error:
                    data.message ||
                    data.error ||
                    "体育项目 API 请求失败",
                details: data
            });
        }

        return res.json(data);

    } catch (error) {

        console.error("SPORTS API ERROR:", error);

        return res.status(500).json({
            error: "无法连接赔率服务器",
            details: error.message
        });
    }
});


// ===============================
// 内部赔率处理
// ===============================

function convertOdds(price) {

    const number = Number(price);

    if (!Number.isFinite(number)) {
        return null;
    }

    return Number(
        Math.max(
            1.01,
            number * 0.85
        ).toFixed(2)
    );
}


// ===============================
// 获取比赛赔率
// ===============================

app.get("/api/odds/:sport", async (req, res) => {

    if (!API_KEY) {
        return res.status(500).json({
            error: "ODDS_API_KEY 没有配置"
        });
    }

    const sport = req.params.sport;

    try {

        console.log("Loading sport:", sport);

        const params = new URLSearchParams({
            apiKey: API_KEY,
            regions: "us",
            markets: "h2h,spreads,totals",
            oddsFormat: "decimal",
            dateFormat: "iso"
        });

        const url =
            `${API_BASE}/sports/${encodeURIComponent(sport)}/odds/?${params}`;

        const response = await fetch(url);

        const text = await response.text();

        let data;

        try {
            data = JSON.parse(text);
        } catch {

            console.error(
                "NON JSON RESPONSE:",
                text.substring(0, 300)
            );

            return res.status(502).json({
                error: "赔率服务器返回异常",
                httpStatus: response.status,
                response: text.substring(0, 300)
            });
        }


        if (!response.ok) {

            console.error(
                "UPSTREAM ERROR:",
                data
            );

            return res.status(response.status).json({
                error:
                    data.message ||
                    data.error ||
                    "赔率 API 请求失败",
                details: data,
                sport: sport
            });
        }


        if (!Array.isArray(data)) {
            return res.status(502).json({
                error: "赔率 API 数据格式不正确"
            });
        }


        const events = data.map(event => {

            const bookmakers =
                Array.isArray(event.bookmakers)
                    ? event.bookmakers
                    : [];


            return {

                id: event.id,

                sport_key: event.sport_key,

                sport_title: event.sport_title,

                commence_time: event.commence_time,

                home_team: event.home_team,

                away_team: event.away_team,


                bookmakers: bookmakers.map(bookmaker => {

                    const markets =
                        Array.isArray(bookmaker.markets)
                            ? bookmaker.markets
                            : [];


                    return {

                        key: bookmaker.key,

                        title: bookmaker.title,

                        last_update: bookmaker.last_update,


                        markets: markets.map(market => {

                            const outcomes =
                                Array.isArray(market.outcomes)
                                    ? market.outcomes
                                    : [];


                            return {

                                key: market.key,

                                outcomes: outcomes
                                    .map(outcome => {

                                        const price =
                                            convertOdds(
                                                outcome.price
                                            );

                                        if (price === null) {
                                            return null;
                                        }

                                        return {

                                            name:
                                                outcome.name,

                                            point:
                                                outcome.point ?? null,

                                            price:
                                                price
                                        };

                                    })
                                    .filter(Boolean)
                            };

                        })
                    };

                })
            };

        });


        return res.status(200).json({

            success: true,

            sport: sport,

            updated:
                new Date().toISOString(),

            eventCount:
                events.length,

            events:
                events
        });


    } catch (error) {

        console.error(
            "ODDS ROUTE ERROR:",
            error
        );

        return res.status(500).json({
            error: "服务器内部错误",
            details: error.message
        });
    }
});


// ===============================
// API 404
// ===============================

app.use("/api", (req, res) => {

    return res.status(404).json({
        error: "API 地址不存在",
        path: req.originalUrl
    });

});


// ===============================
// 网站静态文件
// ===============================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ===============================
// 首页
// ===============================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});


// ===============================
// 启动
// ===============================

app.listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("==============================");
    console.log("SPORTS+ SERVER IS RUNNING");
    console.log("PORT:", PORT);
    console.log(
        "ODDS API KEY:",
        API_KEY ? "YES" : "NO"
    );
    console.log("==============================");
    console.log("");

});
