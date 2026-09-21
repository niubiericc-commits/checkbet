const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ODDS_API_KEY;

const API_BASE = "https://api.the-odds-api.com/v4";

app.use(express.json());

/*
========================================
服务器状态测试
========================================
*/

app.get("/api/status", (req, res) => {

    res.json({
        ok: true,
        server: "SPORTS+",
        apiKeyConfigured: !!API_KEY,
        time: new Date().toISOString()
    });

});


/*
========================================
体育项目
========================================
*/

app.get("/api/sports", async (req, res) => {

    if (!API_KEY) {

        return res.status(500).json({
            error: "没有配置 ODDS_API_KEY"
        });

    }

    try {

        const url =
            `${API_BASE}/sports/?apiKey=${encodeURIComponent(API_KEY)}`;

        const response =
            await fetch(url);

        const raw =
            await response.text();

        let data;

        try {

            data =
                JSON.parse(raw);

        } catch {

            return res.status(502).json({
                error:
                    "上游体育 API 返回非 JSON 内容",
                status:
                    response.status,
                preview:
                    raw.substring(0,300)
            });

        }


        if (!response.ok) {

            return res.status(
                response.status
            ).json({

                error:
                    data.message ||
                    data.error ||
                    "无法读取体育项目",

                details:
                    data

            });

        }


        res.json(data);

    }

    catch (error) {

        console.error(
            "SPORTS ERROR",
            error
        );

        res.status(500).json({
            error:
                error.message
        });

    }

});


/*
========================================
最终赔率
========================================
*/

function finalOdds(price) {

    const value =
        Number(price);

    if (!Number.isFinite(value)) {

        return null;

    }

    /*
      内部计算
    */

    const result =
        value * 0.85;

    return Number(
        Math.max(
            1.01,
            result
        ).toFixed(2)
    );

}


/*
========================================
赔率 API
========================================
*/

app.get(
    "/api/odds/:sport",
    async (req, res) => {

    if (!API_KEY) {

        return res.status(500).json({
            error:
                "服务器没有配置 ODDS_API_KEY"
        });

    }


    try {

        const sport =
            req.params.sport;


        console.log(
            "Requested sport:",
            sport
        );


        const params =
            new URLSearchParams({

                apiKey:
                    API_KEY,

                regions:
                    "us",

                markets:
                    "h2h,spreads,totals",

                oddsFormat:
                    "decimal",

                dateFormat:
                    "iso"

            });


        const upstreamURL =
            `${API_BASE}/sports/` +
            `${encodeURIComponent(sport)}` +
            `/odds/?` +
            params.toString();


        console.log(
            "Calling Odds API:",
            `${API_BASE}/sports/${sport}/odds/`
        );


        const response =
            await fetch(
                upstreamURL
            );


        const raw =
            await response.text();


        let data;


        try {

            data =
                JSON.parse(raw);

        }

        catch {

            console.error(
                "UPSTREAM NON JSON:",
                raw.substring(0,500)
            );


            return res
            .status(502)
            .json({

                error:
                    "赔率供应商返回异常",

                status:
                    response.status,

                response:
                    raw.substring(
                        0,
                        300
                    )

            });

        }


        if (!response.ok) {

            console.error(
                "ODDS API ERROR:",
                data
            );


            return res
            .status(
                response.status
            )
            .json({

                error:
                    data.message ||
                    data.error ||
                    "赔率供应商请求失败",

                details:
                    data,

                sport

            });

        }


        if (!Array.isArray(data)) {

            return res
            .status(502)
            .json({

                error:
                    "赔率供应商返回格式异常"

            });

        }


        const events =
            data.map(event => {

                const bookmakers =
                    Array.isArray(
                        event.bookmakers
                    )
                    ?
                    event.bookmakers
                    :
                    [];


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
                        bookmakers.map(
                            bookmaker => {

                            const markets =
                                Array.isArray(
                                    bookmaker.markets
                                )
                                ?
                                bookmaker.markets
                                :
                                [];


                            return {

                                key:
                                    bookmaker.key,

                                title:
                                    bookmaker.title,

                                last_update:
                                    bookmaker.last_update,


                                markets:
                                    markets.map(
                                        market => {

                                        const outcomes =
                                            Array.isArray(
                                                market.outcomes
                                            )
                                            ?
                                            market.outcomes
                                            :
                                            [];


                                        return {

                                            key:
                                                market.key,


                                            outcomes:
                                                outcomes
                                                .map(
                                                    outcome => {

                                                    const price =
                                                        finalOdds(
                                                            outcome.price
                                                        );


                                                    if (
                                                        price === null
                                                    ) {

                                                        return null;

                                                    }


                                                    return {

                                                        name:
                                                            outcome.name,

                                                        price,

                                                        point:
                                                            outcome.point
                                                            ?? null

                                                    };

                                                })
                                                .filter(
                                                    Boolean
                                                )

                                        };

                                    })

                            };

                        })

                };

            });


        res.json({

            success:
                true,

            sport,

            updated:
                new Date()
                .toISOString(),

            eventCount:
                events.length,

            requestsRemaining:
                response.headers.get(
                    "x-requests-remaining"
                ),

            requestsUsed:
                response.headers.get(
                    "x-requests-used"
                ),

            events

        });

    }

    catch (error) {

        console.error(
            "SERVER ODDS ERROR:",
            error
        );


        res
        .status(500)
        .json({

            error:
                "服务器获取赔率失败",

            details:
                error.message

        });

    }

});


/*
========================================
静态网页

注意：
必须放在 /api routes 后面
========================================
*/

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/*
========================================
API 404

非常重要：
如果 API route 写错，
现在会返回 JSON，
不会再只显示 Not Found。
========================================
*/

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            error:
                "API 地址不存在",

            requested:
                req.originalUrl

        });

    }
);


/*
========================================
网页 fallback
========================================
*/

app.get("*", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});


/*
========================================
启动
========================================
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "SPORTS+ SERVER STARTED"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "API KEY:",
            API_KEY
                ? "CONFIGURED"
                : "MISSING"
        );

        console.log(
            "================================"
        );

    }
);
