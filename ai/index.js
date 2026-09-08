import { DurableObject } from "cloudflare:workers";

const DISCORD_GATEWAY =
  "wss://gateway.discord.gg/?v=10&encoding=json";

const DISCORD_API =
  "https://discord.com/api/v10";

const GEMINI_MODEL =
  "gemini-3.1-flash-lite";

const MESSAGE_CONTENT_INTENT = 1 << 15;
const GUILDS_INTENT = 1 << 0;
const GUILD_MESSAGES_INTENT = 1 << 9;

const DISCORD_INTENTS =
  GUILDS_INTENT |
  GUILD_MESSAGES_INTENT |
  MESSAGE_CONTENT_INTENT;


/* =========================================================
   메인 Worker
========================================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * 봇 시작
     *
     * https://YOUR-WORKER/start
     */
    if (
      request.method === "GET" &&
      url.pathname === "/start"
    ) {
      const id = env.DISCORD_BOT.idFromName("main");

      const stub =
        env.DISCORD_BOT.get(id);

      const response =
        await stub.fetch(
          "https://discord-bot/start"
        );

      return response;
    }


    /*
     * 상태 확인
     */
    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: "Discord AI Bot",
            model: GEMINI_MODEL
          },
          null,
          2
        ),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          }
        }
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


/* =========================================================
   Discord Durable Object
========================================================= */

export class DiscordBot extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    this.gateway = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.proactiveReconnectTimer = null;

    this.sequence = null;
    this.sessionId = null;

    this.connected = false;
    this.starting = false;
  }


  /* =======================================================
     HTTP
  ======================================================= */

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start") {

      await this.startGateway();

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Discord Gateway 시작 요청 완료"
        }),
        {
          headers: {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );
    }


    if (url.pathname === "/status") {

      return new Response(
        JSON.stringify(
          {
            connected: this.connected,
            sessionId: this.sessionId
          },
          null,
          2
        ),
        {
          headers: {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );
    }


    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }


  /* =======================================================
     Discord Gateway 시작
  ======================================================= */

  async startGateway() {

    if (this.starting) {
      return;
    }

    if (
      this.gateway &&
      this.connected
    ) {
      return;
    }

    this.starting = true;

    this.clearTimers();

    try {

      console.log(
        "[Discord] Gateway 연결 시작"
      );

      const ws =
        new WebSocket(
          DISCORD_GATEWAY
        );

      this.gateway = ws;

      ws.addEventListener(
        "open",
        () => {
          console.log(
            "[Discord] WebSocket 연결됨"
          );
        }
      );


      ws.addEventListener(
        "message",
        (event) => {

          this.handleGatewayMessage(
            event.data
          ).catch(
            (error) => {
              console.error(
                "[Discord] 메시지 처리 오류:",
                error
              );
            }
          );
        }
      );


      ws.addEventListener(
        "close",
        (event) => {

          console.log(
            "[Discord] Gateway 연결 종료:",
            event.code,
            event.reason
          );

          this.connected = false;
          this.gateway = null;

          this.clearHeartbeat();

          this.scheduleReconnect();
        }
      );


      ws.addEventListener(
        "error",
        (error) => {

          console.error(
            "[Discord] WebSocket 오류:",
            error
          );
        }
      );

    } catch (error) {

      console.error(
        "[Discord] Gateway 연결 실패:",
        error
      );

      this.scheduleReconnect();

    } finally {

      this.starting = false;
    }
  }


  /* =======================================================
     Gateway 메시지 처리
  ======================================================= */

  async handleGatewayMessage(rawData) {

    let packet;

    try {

      packet =
        JSON.parse(rawData);

    } catch {

      console.error(
        "[Discord] JSON 파싱 실패"
      );

      return;
    }


    const {
      op,
      d,
      s,
      t
    } = packet;


    /*
     * Sequence
     */

    if (s !== null && s !== undefined) {
      this.sequence = s;
    }


    /*
     * Opcode 10
     * Hello
     */

    if (op === 10) {

      console.log(
        "[Discord] Hello 수신"
      );

      const heartbeatInterval =
        d.heartbeat_interval;

      this.startHeartbeat(
        heartbeatInterval
      );

      this.identify();

      return;
    }


    /*
     * Opcode 11
     * Heartbeat ACK
     */

    if (op === 11) {

      return;
    }


    /*
     * Opcode 1
     * Heartbeat 요청
     */

    if (op === 1) {

      this.sendHeartbeat();

      return;
    }


    /*
     * Opcode 7
     * Reconnect
     */

    if (op === 7) {

      console.log(
        "[Discord] Discord가 재연결 요청"
      );

      this.reconnect();

      return;
    }


    /*
     * Opcode 9
     * Invalid Session
     */

    if (op === 9) {

      console.log(
        "[Discord] Invalid Session"
      );

      this.sessionId = null;
      this.sequence = null;

      setTimeout(
        () => {
          this.reconnect();
        },
        5000
      );

      return;
    }


    /*
     * Opcode 0
     * Dispatch
     */

    if (op === 0) {

      await this.handleDispatch(
        t,
        d
      );

      return;
    }
  }


  /* =======================================================
     Dispatch 처리
  ======================================================= */

  async handleDispatch(eventName, data) {

    /*
     * READY
     */

    if (eventName === "READY") {

      this.connected = true;

      this.sessionId =
        data.session_id;

      console.log(
        "[Discord] 로그인 완료"
      );

      console.log(
        "[Discord] 사용자:",
        data.user?.username
      );

      console.log(
        "[Discord] session_id:",
        this.sessionId
      );

      /*
       * Cloudflare Durable Object의
       * outbound WebSocket은 최대 수명 제한이 있으므로
       * 미리 재연결한다.
       */

      this.scheduleProactiveReconnect();

      return;
    }


    /*
     * MESSAGE_CREATE
     */

    if (eventName === "MESSAGE_CREATE") {

      await this.handleDiscordMessage(
        data
      );

      return;
    }
  }


  /* =======================================================
     Discord Identify
  ======================================================= */

  identify() {

    if (!this.gateway) {
      return;
    }


    const token =
      this.env.AI_coupang_discord;


    if (!token) {

      console.error(
        "[Discord] AI_coupang_discord 환경변수가 없습니다."
      );

      return;
    }


    const packet = {

      op: 2,

      d: {

        token,

        properties: {
          os: "linux",
          browser: "cloudflare",
          device: "cloudflare"
        },

        intents:
          DISCORD_INTENTS
      }
    };


    this.gateway.send(
      JSON.stringify(packet)
    );


    console.log(
      "[Discord] Identify 전송"
    );
  }


  /* =======================================================
     Heartbeat
  ======================================================= */

  startHeartbeat(interval) {

    this.clearHeartbeat();


    /*
     * Discord 권장 방식:
     * 첫 heartbeat를 약간 랜덤하게 보낸다.
     */

    const firstDelay =
      Math.random() * interval;


    setTimeout(
      () => {

        this.sendHeartbeat();

        this.heartbeatTimer =
          setInterval(
            () => {
              this.sendHeartbeat();
            },
            interval
          );

      },
      firstDelay
    );
  }


  sendHeartbeat() {

    if (
      !this.gateway ||
      this.gateway.readyState !== WebSocket.OPEN
    ) {
      return;
    }


    const packet = {

      op: 1,

      d: this.sequence
    };


    try {

      this.gateway.send(
        JSON.stringify(packet)
      );

    } catch (error) {

      console.error(
        "[Discord] Heartbeat 전송 실패:",
        error
      );
    }
  }


  /* =======================================================
     Discord 메시지 처리
  ======================================================= */

  async handleDiscordMessage(message) {

    /*
     * 봇 메시지는 무시
     */

    if (
      message.author?.bot
    ) {
      return;
    }


    /*
     * 허용 채널
     */

    const devChannel =
      this.env.AI_coupang_discord_dev_channel;

    const userChannel =
      this.env.AI_coupang_discord_user_channel;


    const channelId =
      message.channel_id;


    if (
      channelId !== devChannel &&
      channelId !== userChannel
    ) {
      return;
    }


    const content =
      message.content?.trim();


    if (!content) {
      return;
    }


    console.log(
      "[Discord] 메시지:",
      content
    );


    /*
     * AI 응답 생성
     */

    const answer =
      await this.askGemini(
        content
      );


    /*
     * Discord에 답변
     */

    await this.sendDiscordMessage(
      channelId,
      answer
    );
  }


  /* =======================================================
     Gemini API
  ======================================================= */

  async askGemini(question) {

    const apiKey =
      this.env.AI_coupang_api;


    if (!apiKey) {

      console.error(
        "[Gemini] AI_coupang_api가 없습니다."
      );

      return "AI API 키가 설정되지 않았습니다.";
    }


    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;


    const body = {

      system_instruction: {

        parts: [

          {
            text:
              "너는 Discord에서 사용되는 AI 비서다. " +
              "사용자의 질문에 한국어로 자연스럽고 정확하게 답변한다. " +
              "불필요하게 장황하게 설명하지 말고 질문에 직접 답한다."
          }

        ]
      },


      contents: [

        {

          role: "user",

          parts: [

            {
              text: question
            }

          ]
        }

      ],


      generationConfig: {

        temperature: 0.7,

        maxOutputTokens: 2048
      }
    };


    try {

      const response =
        await fetch(
          url,
          {

            method: "POST",

            headers: {

              "Content-Type":
                "application/json",

              "x-goog-api-key":
                apiKey
            },

            body:
              JSON.stringify(body)
          }
        );


      const result =
        await response.json();


      if (!response.ok) {

        console.error(
          "[Gemini] API 오류:",
          response.status,
          result
        );

        return (
          "AI API 오류가 발생했습니다.\n" +
          `HTTP ${response.status}`
        );
      }


      const parts =
        result
          ?.candidates?.[0]
          ?.content
          ?.parts;


      if (
        !Array.isArray(parts)
      ) {

        console.error(
          "[Gemini] 응답 형식 오류:",
          result
        );

        return "AI가 답변을 생성하지 못했습니다.";
      }


      const answer =
        parts
          .map(
            part => part.text || ""
          )
          .join("")
          .trim();


      if (!answer) {

        return "AI가 빈 답변을 반환했습니다.";
      }


      return answer;


    } catch (error) {

      console.error(
        "[Gemini] 요청 실패:",
        error
      );

      return (
        "AI API 요청 중 오류가 발생했습니다."
      );
    }
  }


  /* =======================================================
     Discord 메시지 전송
  ======================================================= */

  async sendDiscordMessage(
    channelId,
    content
  ) {

    if (!content) {
      return;
    }


    /*
     * Discord 메시지 최대 길이 2000자.
     * 길면 여러 메시지로 나눈다.
     */

    const chunks =
      this.splitMessage(
        content,
        1900
      );


    for (const chunk of chunks) {

      const response =
        await fetch(
          `${DISCORD_API}/channels/${channelId}/messages`,
          {

            method: "POST",

            headers: {

              "Authorization":
                `Bot ${this.env.AI_coupang_discord}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                content: chunk
              })
          }
        );


      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          "[Discord] 메시지 전송 실패:",
          response.status,
          errorText
        );
      }
    }
  }


  /* =======================================================
     긴 메시지 분할
  ======================================================= */

  splitMessage(
    text,
    maxLength
  ) {

    if (
      text.length <= maxLength
    ) {
      return [text];
    }


    const result = [];

    let current = "";


    const lines =
      text.split("\n");


    for (const line of lines) {

      if (
        current.length +
        line.length +
        1 <=
        maxLength
      ) {

        current +=
          (current ? "\n" : "") +
          line;

      } else {

        if (current) {

          result.push(
            current
          );
        }


        /*
         * 한 줄 자체가 너무 긴 경우
         */

        if (
          line.length >
          maxLength
        ) {

          for (
            let i = 0;
            i < line.length;
            i += maxLength
          ) {

            result.push(
              line.slice(
                i,
                i + maxLength
              )
            );
          }

          current = "";

        } else {

          current = line;
        }
      }
    }


    if (current) {

      result.push(
        current
      );
    }


    return result;
  }


  /* =======================================================
     재연결
  ======================================================= */

  reconnect() {

    this.clearTimers();

    this.connected = false;

    if (this.gateway) {

      try {

        this.gateway.close();

      } catch {}
    }


    this.gateway = null;

    setTimeout(
      () => {

        this.startGateway();

      },
      2000
    );
  }


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

          this.startGateway();

        },
        5000
      );
  }


  /*
   * Cloudflare Durable Object의
   * outbound WebSocket은 장시간 연결에 제한이 있으므로
   * 약 9분마다 미리 재연결한다.
   */

  scheduleProactiveReconnect() {

    if (
      this.proactiveReconnectTimer
    ) {
      clearTimeout(
        this.proactiveReconnectTimer
      );
    }


    this.proactiveReconnectTimer =
      setTimeout(
        () => {

          console.log(
            "[Discord] 주기적 Gateway 재연결"
          );

          this.reconnect();

        },
        9 * 60 * 1000
      );
  }


  /* =======================================================
     타이머 정리
  ======================================================= */

  clearHeartbeat() {

    if (
      this.heartbeatTimer
    ) {

      clearInterval(
        this.heartbeatTimer
      );

      this.heartbeatTimer =
        null;
    }
  }


  clearTimers() {

    this.clearHeartbeat();


    if (
      this.reconnectTimer
    ) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;
    }


    if (
      this.proactiveReconnectTimer
    ) {

      clearTimeout(
        this.proactiveReconnectTimer
      );

      this.proactiveReconnectTimer =
        null;
    }
  }
}
