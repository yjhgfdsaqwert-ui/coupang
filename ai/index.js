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

  /*
   * 일반 HTTP 요청
   */
  async fetch(request, env) {

    const url =
      new URL(request.url);


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
            model: GEMINI_MODEL,
            automatic: true
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


    /*
     * 수동 시작용
     *
     * 이제 정상적인 경우에는
     * 직접 호출할 필요가 없다.
     */
    if (
      request.method === "GET" &&
      url.pathname === "/start"
    ) {

      await startBot(env);

      return new Response(
        JSON.stringify(
          {
            ok: true,
            message:
              "Discord AI Bot 시작 요청 완료"
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


    /*
     * 상태 확인
     */
    if (
      request.method === "GET" &&
      url.pathname === "/status"
    ) {

      const id =
        env.DISCORD_BOT.idFromName("main");

      const stub =
        env.DISCORD_BOT.get(id);


      const response =
        await stub.fetch(
          "https://discord-bot/status"
        );


      return response;
    }


    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  },


  /*
   * =======================================================
   * Cron
   *
   * 1분마다 실행해서 Discord Gateway가 살아있는지 확인한다.
   * =======================================================
   */
  async scheduled(event, env) {

    console.log(
      "[Cron] Discord Bot 상태 확인"
    );


    await startBot(env);
  }
};


/* =========================================================
   Bot 시작
========================================================= */

async function startBot(env) {

  const id =
    env.DISCORD_BOT.idFromName("main");


  const stub =
    env.DISCORD_BOT.get(id);


  await stub.fetch(
    "https://discord-bot/start"
  );
}


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
    this.heartbeatStartTimer = null;

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

    const url =
      new URL(request.url);


    /*
     * 자동 시작 / 재확인
     */
    if (
      url.pathname === "/start"
    ) {

      await this.startGateway();


      return new Response(
        JSON.stringify(
          {
            ok: true,
            connected: this.connected
          }
        ),
        {
          headers: {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );
    }


    /*
     * 상태
     */
    if (
      url.pathname === "/status"
    ) {

      return new Response(
        JSON.stringify(
          {
            connected:
              this.connected,

            gateway:
              this.gateway
                ? this.gateway.readyState
                : null,

            sessionId:
              this.sessionId
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
     Gateway 시작
  ======================================================= */

  async startGateway() {

    /*
     * 이미 연결되어 있으면 아무것도 하지 않는다.
     */
    if (
      this.gateway &&
      this.gateway.readyState ===
        WebSocket.OPEN &&
      this.connected
    ) {

      console.log(
        "[Discord] Gateway 이미 연결됨"
      );

      return;
    }


    /*
     * 이미 연결 작업 중이면 중복 실행 방지
     */
    if (this.starting) {

      return;
    }


    this.starting = true;


    try {

      this.clearReconnectTimers();


      console.log(
        "[Discord] Gateway 연결 시작"
      );


      /*
       * 기존 연결이 이상하게 남아있으면 닫는다.
       */
      if (this.gateway) {

        try {
          this.gateway.close();
        } catch {}
      }


      this.gateway = null;
      this.connected = false;


      /*
       * Discord Gateway 연결
       */
      const ws =
        new WebSocket(
          DISCORD_GATEWAY
        );


      this.gateway = ws;


      /*
       * WebSocket OPEN
       */
      ws.addEventListener(
        "open",
        () => {

          console.log(
            "[Discord] WebSocket 연결됨"
          );
        }
      );


      /*
       * 메시지 수신
       */
      ws.addEventListener(
        "message",
        (event) => {

          this.handleGatewayMessage(
            event.data
          ).catch(
            (error) => {

              console.error(
                "[Discord] Gateway 메시지 처리 오류:",
                error
              );
            }
          );
        }
      );


      /*
       * 연결 종료
       */
      ws.addEventListener(
        "close",
        (event) => {

          console.log(
            "[Discord] Gateway 종료:",
            event.code,
            event.reason
          );


          this.connected = false;

          this.gateway = null;

          this.clearHeartbeat();

          this.scheduleReconnect();
        }
      );


      /*
       * 오류
       */
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
     Gateway 메시지
  ======================================================= */

  async handleGatewayMessage(rawData) {

    let packet;


    try {

      packet =
        JSON.parse(rawData);

    } catch (error) {

      console.error(
        "[Discord] JSON 파싱 실패:",
        error
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
     * Sequence 저장
     */
    if (
      s !== null &&
      s !== undefined
    ) {

      this.sequence = s;
    }


    /*
     * =====================================================
     * HELLO
     * Opcode 10
     * =====================================================
     */

    if (op === 10) {

      console.log(
        "[Discord] Hello 수신"
      );


      const interval =
        d.heartbeat_interval;


      this.startHeartbeat(
        interval
      );


      this.identify();


      return;
    }


    /*
     * =====================================================
     * HEARTBEAT ACK
     * Opcode 11
     * =====================================================
     */

    if (op === 11) {

      return;
    }


    /*
     * =====================================================
     * HEARTBEAT REQUEST
     * Opcode 1
     * =====================================================
     */

    if (op === 1) {

      this.sendHeartbeat();

      return;
    }


    /*
     * =====================================================
     * RECONNECT
     * Opcode 7
     * =====================================================
     */

    if (op === 7) {

      console.log(
        "[Discord] Discord가 재연결을 요청함"
      );


      this.reconnect();


      return;
    }


    /*
     * =====================================================
     * INVALID SESSION
     * Opcode 9
     * =====================================================
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
     * =====================================================
     * DISPATCH
     * Opcode 0
     * =====================================================
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
     Dispatch
  ======================================================= */

  async handleDispatch(
    eventName,
    data
  ) {

    /*
     * READY
     */
    if (
      eventName === "READY"
    ) {

      this.connected = true;


      this.sessionId =
        data.session_id;


      console.log(
        "[Discord] ======================="
      );

      console.log(
        "[Discord] 로그인 성공"
      );

      console.log(
        "[Discord] 사용자:",
        data.user?.username
      );

      console.log(
        "[Discord] Session:",
        this.sessionId
      );

      console.log(
        "[Discord] ======================="
      );


      /*
       * 장시간 연결을 위한 주기적 재연결
       */
      this.scheduleProactiveReconnect();


      return;
    }


    /*
     * 일반 메시지
     */
    if (
      eventName === "MESSAGE_CREATE"
    ) {

      await this.handleDiscordMessage(
        data
      );


      return;
    }
  }


  /* =======================================================
     Identify
  ======================================================= */

  identify() {

    if (
      !this.gateway ||
      this.gateway.readyState !==
        WebSocket.OPEN
    ) {

      console.error(
        "[Discord] Identify 실패: WebSocket이 열려있지 않음"
      );

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

          browser:
            "cloudflare",

          device:
            "cloudflare"
        },

        intents:
          DISCORD_INTENTS
      }
    };


    try {

      this.gateway.send(
        JSON.stringify(packet)
      );


      console.log(
        "[Discord] Identify 전송 완료"
      );


    } catch (error) {

      console.error(
        "[Discord] Identify 전송 실패:",
        error
      );
    }
  }


  /* =======================================================
     Heartbeat
  ======================================================= */

  startHeartbeat(interval) {

    this.clearHeartbeat();


    /*
     * Discord 권장 방식에 맞춰
     * 첫 Heartbeat를 랜덤한 시점에 전송
     */
    const firstDelay =
      Math.random() * interval;


    this.heartbeatStartTimer =
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
      this.gateway.readyState !==
        WebSocket.OPEN
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
        "[Discord] Heartbeat 실패:",
        error
      );
    }
  }


  /* =======================================================
     Discord 메시지
  ======================================================= */

  async handleDiscordMessage(
    message
  ) {

    /*
     * 봇 메시지 무시
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


    /*
     * 지정된 두 채널 외에는 무시
     */
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
      "[Discord] 질문:",
      content
    );


    /*
     * Gemini
     */
    const answer =
      await this.askGemini(
        content
      );


    /*
     * Discord 답변
     */
    await this.sendDiscordMessage(
      channelId,
      answer
    );
  }


  /* =======================================================
     Gemini API
  ======================================================= */

  async askGemini(
    question
  ) {

    const apiKey =
      this.env.AI_coupang_api;


    if (!apiKey) {

      console.error(
        "[Gemini] AI_coupang_api가 없습니다."
      );


      return (
        "AI API 키가 설정되지 않았습니다."
      );
    }


    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;


    const body = {

      system_instruction: {

        parts: [

          {
            text:
              "너는 Discord AI 비서다. " +
              "사용자의 질문에 한국어로 정확하고 자연스럽게 답변한다. " +
              "불필요하게 장황하게 말하지 않는다. " +
              "사용자가 코드를 요청하면 복사해서 사용할 수 있는 완전한 코드를 제공한다."
          }

        ]
      },


      contents: [

        {

          role: "user",

          parts: [

            {
              text:
                question
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


      /*
       * API 오류
       */
      if (
        !response.ok
      ) {

        console.error(
          "[Gemini] API 오류:",
          response.status,
          result
        );


        return (
          "Gemini API 오류가 발생했습니다.\n" +
          `HTTP ${response.status}`
        );
      }


      /*
       * 답변 추출
       */
      const parts =
        result
          ?.candidates?.[0]
          ?.content?.parts;


      if (
        !Array.isArray(parts)
      ) {

        console.error(
          "[Gemini] 응답 형식 오류:",
          result
        );


        return (
          "Gemini가 답변을 생성하지 못했습니다."
        );
      }


      const answer =
        parts
          .map(
            part =>
              part.text || ""
          )
          .join("")
          .trim();


      if (!answer) {

        return (
          "Gemini가 빈 답변을 반환했습니다."
        );
      }


      return answer;


    } catch (error) {

      console.error(
        "[Gemini] 요청 실패:",
        error
      );


      return (
        "Gemini API 요청 중 오류가 발생했습니다."
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
     * Discord 메시지 길이 제한 대응
     */
    const chunks =
      this.splitMessage(
        content,
        1900
      );


    for (
      const chunk of chunks
    ) {

      try {

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
                JSON.stringify(
                  {
                    content:
                      chunk
                  }
                )
            }
          );


        if (
          !response.ok
        ) {

          const errorText =
            await response.text();


          console.error(
            "[Discord] 메시지 전송 실패:",
            response.status,
            errorText
          );
        }


      } catch (error) {

        console.error(
          "[Discord] 메시지 전송 요청 실패:",
          error
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
      text.length <=
      maxLength
    ) {

      return [text];
    }


    const result = [];

    let current = "";


    const lines =
      text.split("\n");


    for (
      const line of lines
    ) {

      if (
        current.length +
        line.length +
        1 <=
        maxLength
      ) {

        current +=
          (
            current
              ? "\n"
              : ""
          ) +
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

          current =
            line;
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
     자동 재연결
  ======================================================= */

  reconnect() {

    this.clearReconnectTimers();

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


    console.log(
      "[Discord] 5초 후 자동 재연결"
    );


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


  /* =======================================================
     주기적 재연결
  ======================================================= */

  scheduleProactiveReconnect() {

    if (
      this.proactiveReconnectTimer
    ) {

      clearTimeout(
        this.proactiveReconnectTimer
      );
    }


    /*
     * 장시간 연결 안정성을 위해
     * 9분마다 Gateway를 새로 연결한다.
     */
    this.proactiveReconnectTimer =
      setTimeout(
        () => {

          console.log(
            "[Discord] 자동 주기 재연결"
          );


          this.reconnect();

        },
        9 * 60 * 1000
      );
  }


  /* =======================================================
     Heartbeat 정리
  ======================================================= */

  clearHeartbeat() {

    if (
      this.heartbeatStartTimer
    ) {

      clearTimeout(
        this.heartbeatStartTimer
      );


      this.heartbeatStartTimer =
        null;
    }


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


  /* =======================================================
     재연결 타이머 정리
  ======================================================= */

  clearReconnectTimers() {

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
