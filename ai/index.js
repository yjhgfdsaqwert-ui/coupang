import { DurableObject } from "cloudflare:workers";

const DISCORD_GATEWAY =
    "wss://gateway.discord.gg/?v=10&encoding=json";

const DISCORD_API =
    "https://discord.com/api/v10";

// Discord Gateway Intents
const GUILDS = 1 << 0;
const GUILD_MESSAGES = 1 << 9;
const MESSAGE_CONTENT = 1 << 15;

const INTENTS =
    GUILDS |
    GUILD_MESSAGES |
    MESSAGE_CONTENT;


export default {
    async fetch(request, env) {

        const url = new URL(request.url);

        /*
         * 서버 상태 확인
         */
        if (url.pathname === "/") {
            return new Response(
                "Coupang Discord AI is running.",
                {
                    status: 200
                }
            );
        }

        /*
         * Discord 봇 시작
         */
        if (url.pathname === "/start") {

            const id =
                env.DISCORD_AI_BOT.idFromName(
                    "coupang-discord-ai"
                );

            const bot =
                env.DISCORD_AI_BOT.get(id);

            return bot.fetch(
                new Request(
                    "https://internal/start"
                )
            );
        }

        return new Response(
            "Not Found",
            {
                status: 404
            }
        );
    }
};


/*
 * Discord Gateway를 계속 유지하는 Durable Object
 */
export class DiscordAIBot extends DurableObject {

    constructor(ctx, env) {

        super(ctx, env);

        this.ctx = ctx;
        this.env = env;

        this.socket = null;

        this.sequence = null;
        this.sessionId = null;
        this.resumeGatewayUrl = null;

        this.heartbeatTimer = null;
        this.reconnectTimer = null;

        this.connected = false;
    }


    async fetch(request) {

        const url = new URL(request.url);

        if (url.pathname !== "/start") {

            return new Response(
                "Not Found",
                {
                    status: 404
                }
            );
        }

        /*
         * 이미 연결되어 있으면
         * 다시 연결하지 않는다.
         */
        if (
            this.socket &&
            this.socket.readyState === WebSocket.OPEN
        ) {

            return new Response(
                "Discord bot is already running."
            );
        }

        await this.connect();

        return new Response(
            "Discord bot started."
        );
    }


    /*
     * Discord Gateway 연결
     */
    async connect() {

        try {

            let gateway =
                this.resumeGatewayUrl ||
                DISCORD_GATEWAY;

            console.log(
                "Discord Gateway connecting..."
            );


            const ws =
                new WebSocket(gateway);

            this.socket = ws;


            ws.addEventListener(
                "open",
                () => {

                    console.log(
                        "Discord Gateway connected."
                    );
                }
            );


            ws.addEventListener(
                "message",
                event => {

                    this.ctx.waitUntil(
                        this.handlePacket(
                            event.data
                        )
                    );
                }
            );


            ws.addEventListener(
                "close",
                event => {

                    console.log(
                        "Discord Gateway closed:",
                        event.code,
                        event.reason
                    );

                    this.stopHeartbeat();

                    this.socket = null;

                    this.scheduleReconnect();
                }
            );


            ws.addEventListener(
                "error",
                error => {

                    console.error(
                        "Discord Gateway error:",
                        error
                    );
                }
            );


        } catch (error) {

            console.error(
                "Discord connection failed:",
                error
            );

            this.scheduleReconnect();
        }
    }


    /*
     * Gateway 패킷 처리
     */
    async handlePacket(rawData) {

        let packet;

        try {

            packet =
                JSON.parse(rawData);

        } catch {

            console.error(
                "Discord packet JSON error."
            );

            return;
        }


        /*
         * Sequence 저장
         */
        if (
            packet.s !== null &&
            packet.s !== undefined
        ) {

            this.sequence =
                packet.s;
        }


        /*
         * Hello
         */
        if (packet.op === 10) {

            const interval =
                packet.d.heartbeat_interval;

            this.startHeartbeat(
                interval
            );


            /*
             * 세션 재개
             */
            if (
                this.sessionId &&
                this.resumeGatewayUrl
            ) {

                this.send({

                    op: 6,

                    d: {

                        token:
                            this.env[
                                "AI_coupang_discord"
                            ],

                        session_id:
                            this.sessionId,

                        seq:
                            this.sequence
                    }
                });

            } else {

                this.identify();
            }

            return;
        }


        /*
         * Discord가 Heartbeat를 요구
         */
        if (packet.op === 1) {

            this.heartbeat();

            return;
        }


        /*
         * Discord에서 재연결 요청
         */
        if (packet.op === 7) {

            console.log(
                "Discord requested reconnect."
            );

            this.closeSocket();

            this.scheduleReconnect();

            return;
        }


        /*
         * Invalid Session
         */
        if (packet.op === 9) {

            console.log(
                "Discord invalid session."
            );

            this.sessionId = null;
            this.sequence = null;

            this.closeSocket();

            this.scheduleReconnect();

            return;
        }


        /*
         * Dispatch
         */
        if (packet.op === 0) {

            await this.handleDispatch(
                packet.t,
                packet.d
            );
        }
    }


    /*
     * Discord 봇 로그인
     */
    identify() {

        const token =
            this.env[
                "AI_coupang_discord"
            ];


        if (!token) {

            console.error(
                "AI_coupang_discord is missing."
            );

            return;
        }


        this.send({

            op: 2,

            d: {

                token,

                intents:
                    INTENTS,

                properties: {

                    os:
                        "cloudflare",

                    browser:
                        "coupang-ai",

                    device:
                        "coupang-ai"
                }
            }
        });
    }


    /*
     * Discord 이벤트
     */
    async handleDispatch(
        eventName,
        data
    ) {

        /*
         * 봇 로그인 완료
         */
        if (
            eventName === "READY"
        ) {

            this.sessionId =
                data.session_id;

            this.resumeGatewayUrl =
                data.resume_gateway_url;

            this.connected = true;

            console.log(
                "Discord AI bot READY."
            );

            console.log(
                "Bot:",
                data.user?.username
            );

            return;
        }


        /*
         * 새로운 메시지
         */
        if (
            eventName ===
            "MESSAGE_CREATE"
        ) {

            await this.handleMessage(
                data
            );
        }
    }


    /*
     * Discord 메시지 처리
     */
    async handleMessage(message) {

        /*
         * 봇이 보낸 메시지는 무시
         */
        if (
            message.author?.bot
        ) {

            return;
        }


        /*
         * 채널 ID
         */
        const channelId =
            message.channel_id;


        /*
         * 개발자 채널
         */
        const developerChannel =
            this.env[
                "AI_coupang_discord_dev_channel"
            ];


        /*
         * 사용자 채널
         */
        const userChannel =
            this.env[
                "AI_coupang_discord_user_channel"
            ];


        /*
         * 지정한 두 채널이 아니면 무시
         */
        if (
            channelId !== developerChannel &&
            channelId !== userChannel
        ) {

            return;
        }


        const question =
            message.content?.trim();


        if (!question) {

            return;
        }


        console.log(
            "Discord question:",
            question
        );


        /*
         * AI API 호출
         */
        const answer =
            await this.askAI(
                question,
                channelId,
                message.author
            );


        /*
         * Discord 답변
         */
        await this.sendMessage(
            channelId,
            answer
        );
    }


    /*
     * AI 호출
     */
    async askAI(
        question,
        channelId,
        author
    ) {

        try {

            /*
             * 현재 AI_coupang_api는
             * Cloudflare 환경변수/바인딩으로
             * 등록되어 있다고 가정한다.
             *
             * 실제 API 형식에 맞게 이 부분을
             * 다음 단계에서 조정할 수 있다.
             */

            const api =
                this.env[
                    "AI_coupang_api"
                ];


            /*
             * AI_coupang_api가 URL 문자열인 경우
             */
            if (
                typeof api === "string"
            ) {

                const response =
                    await fetch(
                        api,
                        {

                            method:
                                "POST",

                            headers: {

                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({

                                    messages: [

                                        {
                                            role:
                                                "system",

                                            content:
                                                "너는 Discord에서 작동하는 AI다. 사용자의 질문에 한국어로 자연스럽고 정확하게 답변한다."
                                        },

                                        {
                                            role:
                                                "user",

                                            content:
                                                question
                                        }
                                    ]
                                })
                        }
                    );


                if (!response.ok) {

                    console.error(
                        "AI API error:",
                        await response.text()
                    );

                    return "AI API 호출 중 오류가 발생했습니다.";
                }


                const result =
                    await response.json();


                /*
                 * 일반적인 OpenAI 호환 응답
                 */
                const answer =
                    result
                        ?.choices?.[0]
                        ?.message?.content;


                if (answer) {

                    return answer;
                }


                /*
                 * 다른 일반적인 응답 형태
                 */
                if (
                    typeof result?.answer ===
                    "string"
                ) {

                    return result.answer;
                }


                if (
                    typeof result?.response ===
                    "string"
                ) {

                    return result.response;
                }


                return "AI가 답변을 생성하지 못했습니다.";
            }


            /*
             * AI 바인딩인 경우
             *
             * 현재 AI_coupang_api의 실제 바인딩
             * 종류에 따라 이 부분을 맞춰야 한다.
             */
            if (
                api &&
                typeof api.run === "function"
            ) {

                const result =
                    await api.run(
                        question
                    );


                if (
                    typeof result ===
                    "string"
                ) {

                    return result;
                }


                if (
                    typeof result?.response ===
                    "string"
                ) {

                    return result.response;
                }


                return JSON.stringify(
                    result
                );
            }


            return (
                "AI_coupang_api 설정을 확인해주세요."
            );


        } catch (error) {

            console.error(
                "AI error:",
                error
            );

            return (
                "AI 처리 중 오류가 발생했습니다."
            );
        }
    }


    /*
     * Discord 메시지 전송
     */
    async sendMessage(
        channelId,
        content
    ) {

        /*
         * Discord 메시지 제한을 고려해
         * 1900자씩 나눈다.
         */
        const chunks =
            splitMessage(
                content,
                1900
            );


        for (
            const chunk of chunks
        ) {

            try {

                const response =
                    await fetch(

                        `${DISCORD_API}/channels/` +
                        `${channelId}/messages`,

                        {

                            method:
                                "POST",

                            headers: {

                                "Authorization":
                                    `Bot ${this.env[
                                        "AI_coupang_discord"
                                    ]}`,

                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({

                                    content:
                                        chunk
                                })
                        }
                    );


                if (!response.ok) {

                    console.error(
                        "Discord message error:",
                        await response.text()
                    );
                }

            } catch (error) {

                console.error(
                    "Discord send error:",
                    error
                );
            }
        }
    }


    /*
     * Gateway 전송
     */
    send(data) {

        if (
            !this.socket ||
            this.socket.readyState !==
                WebSocket.OPEN
        ) {

            return;
        }


        this.socket.send(
            JSON.stringify(data)
        );
    }


    /*
     * Heartbeat
     */
    heartbeat() {

        this.send({

            op: 1,

            d:
                this.sequence
        });
    }


    /*
     * Heartbeat 시작
     */
    startHeartbeat(
        interval
    ) {

        this.stopHeartbeat();


        /*
         * 첫 Heartbeat
         */
        const firstDelay =
            Math.random() *
            interval;


        this.heartbeatTimer =
            setTimeout(
                () => {

                    this.heartbeat();


                    this.heartbeatTimer =
                        setInterval(
                            () => {

                                this.heartbeat();

                            },
                            interval
                        );

                },
                firstDelay
            );
    }


    /*
     * Heartbeat 종료
     */
    stopHeartbeat() {

        if (
            this.heartbeatTimer
        ) {

            clearTimeout(
                this.heartbeatTimer
            );

            clearInterval(
                this.heartbeatTimer
            );

            this.heartbeatTimer =
                null;
        }
    }


    /*
     * WebSocket 종료
     */
    closeSocket() {

        this.stopHeartbeat();


        if (
            this.socket
        ) {

            try {

                this.socket.close();

            } catch {}

            this.socket =
                null;
        }
    }


    /*
     * 재연결
     */
    scheduleReconnect() {

        if (
            this.reconnectTimer
        ) {

            return;
        }


        this.reconnectTimer =
            setTimeout(
                () => {

                    this.reconnectTimer =
                        null;

                    this.connect();

                },
                5000
            );
    }
}


/*
 * Discord 메시지 길이 분할
 */
function splitMessage(
    text,
    maxLength
) {

    const chunks = [];


    for (
        let i = 0;
        i < text.length;
        i += maxLength
    ) {

        chunks.push(
            text.slice(
                i,
                i + maxLength
            )
        );
    }


    return chunks;
}
