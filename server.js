const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ODDS_API_KEY;

const API_BASE = "https://api.the-odds-api.com/v4";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* =========================
   赔率处理
========================= */

function finalOdds(value) {

    const odds = Number(value);

    if (!Number.isFinite(odds)) {
        return null;
    }

    return Number(
        Math.max(1.01, odds * 0.85).toFixed(2)
    );
}


/* =========================
   测试服务器
========================= */

app.get("/api/status", (req, res) => {

    res.json({
        status: "ok",
        apiKeyConfigured: Boolean(API_KEY),
        time: new Date().toISOString()
    });

});


/* =========================
   获取当前可用体育项目
========================= */

app.get("/api/sports", async (req, res) => {

    if (!API_KEY) {

        return res.status(500).json({
            error: "Render 尚未配置 ODDS_API_KEY"
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
                error: "赔率服务器返回了无法识别的数据",
                status: response.status,
                response: text.slice(0, 300)
            });

        }


        if (!response.ok) {

            return res.status(response.status).json({
                error:
                    data.message ||
                    data.error ||
                    "无法读取体育项目",
                details: data
            });

        }


        res.json(data);

    }

    catch (error) {

        console.error(error);

        res.status(500).json({
            error: "服务器连接赔率 API 失败",
            details: error.message
        });

    }

});


/* =========================
   获取赔率
========================= */

app.get("/api/odds/:sport", async (req, res) => {

    if (!API_KEY) {

        return res.status(500).json({
            error: "Render 尚未配置 ODDS_API_KEY"
        });

    }


    try {

        const sport =
            req.params.sport;


        /*
          先只请求三个基础盘口。

          这是最稳定的一组：
          h2h
          spreads
          totals

          高级盘口之后单独做。
        */

        const params =
            new URLSearchParams({

                apiKey: API_KEY,

                regions: "us",

                markets:
                    "h2h,spreads,totals",

                oddsFormat:
                    "decimal",

                dateFormat:
                    "iso"

            });


        const url =
            `${API_BASE}/sports/` +
            `${encodeURIComponent(sport)}` +
            `/odds/?${params.toString()}`;


        console.log(
            "Requesting:",
            `${API_BASE}/sports/${sport}/odds/`
        );


        const response =
            await fetch(url);


        /*
          关键修改：

          不再直接 response.json()

          先读取 text。

          所以即使对方返回
          Not Found
          也不会导致整个 Node route 崩掉。
        */

        const text =
            await response.text();


        let data;


        try {

            data =
                JSON.parse(text);

        }

        catch {

            return res
                .status(502)
                .json({

                    error:
                        "赔率 API 返回了非 JSON 内容",

                    httpStatus:
                        response.status,

                    response:
                        text.slice(0, 500),

                    requestedSport:
                        sport

                });

        }


        if (!response.ok) {

            return res
                .status(response.status)
                .json({

                    error:
                        data.message ||
                        data.error ||
                        "赔率 API 请求失败",

                    details:
                        data,

                    requestedSport:
                        sport

                });

        }


        /*
          数据转换
        */

        const events =
            data.map(event => {

                return {

                    id:
                        event.id,

                    sport_key:
                        event.sport_key,

                    sport_title:
                        event.sport_title,

                    commence_time:
                        event.commence_time,

                    home_team:
                        event.home_team,

                    away_team:
                        event.away_team,


                    bookmakers:
                        (
                            event.bookmakers ||
                            []
                        )
                        .map(bookmaker => {

                            return {

                                key:
                                    bookmaker.key,

                                title:
                                    bookmaker.title,

                                last_update:
                                    bookmaker.last_update,

                                markets:
                                    (
                                        bookmaker.markets ||
                                        []
                                    )
                                    .map(market => {

                                        return {

                                            key:
                                                market.key,

                                            outcomes:
                                                (
                                                    market.outcomes ||
                                                    []
                                                )
                                                .map(outcome => {

                                                    return {

                                                        name:
                                                            outcome.name,

                                                        point:
                                                            outcome.point
                                                            ?? null,

                                                        price:
                                                            finalOdds(
                                                                outcome.price
                                                            )

                                                    };

                                                })
                                                .filter(
                                                    outcome =>
                                                        outcome.price !== null
                                                )

                                        };

                                    })

                            };

                        })

                };

            });


        res.json({

            updated:
                new Date()
                .toISOString(),

            requestsRemaining:
                response.headers.get(
                    "x-requests-remaining"
                ),

            requestsUsed:
                response.headers.get(
                    "x-requests-used"
                ),

            eventCount:
                events.length,

            events

        });

    }

    catch (error) {

        console.error(
            "ODDS ERROR:",
            error
        );


        res.status(500).json({

            error:
                "获取赔率失败",

            details:
                error.message

        });

    }

});


/* =========================
   所有其他网页
========================= */

app.get("*", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});


/* =========================
   启动
========================= */

app.listen(PORT, () => {

    console.log(
        `SPORTS server running on port ${PORT}`
    );

});
