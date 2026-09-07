export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // =========================
    // OPTIONS
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================
    // 대리구매 신청
    // POST /api
    // =========================
    if (request.method === "POST" && url.pathname === "/api") {
      try {
        const data = await request.json();

        // 입력값 확인
        if (
          !data.name ||
          !data.phone ||
          !data.address ||
          !data.product ||
          !data.code
        ) {
          return new Response("모든 항목을 입력해주세요.", {
            status: 400,
            headers: corsHeaders
          });
        }

        // Discord 메시지
        const message = {
          content:
`**새로운 대리구매 신청**

**이름**
${data.name}

**연락받을 전화번호**
${data.phone}

**주소**
${data.address}

**상품 링크**
${data.product}

**기프트카드 코드**
${data.code}`
        };

        // Discord Webhook 전송
        const discordResponse = await fetch(
          env.DISCORD_WEBHOOK_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(message)
          }
        );

        if (!discordResponse.ok) {
          return new Response("Discord 전송에 실패했습니다.", {
            status: 500,
            headers: corsHeaders
          });
        }

        return new Response(
          "신청이 정상적으로 접수되었습니다.",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/plain; charset=UTF-8"
            }
          }
        );

      } catch (error) {
        console.error(error);

        return new Response("서버 오류가 발생했습니다.", {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // =========================
    // 문의
    // POST /api/inquiry
    // =========================
    if (
      request.method === "POST" &&
      url.pathname === "/api/inquiry"
    ) {
      try {
        const data = await request.json();

        // 문의 내용 확인
        if (!data.inquiry) {
          return new Response("문의 내용을 입력해주세요.", {
            status: 400,
            headers: corsHeaders
          });
        }

        // Discord 메시지
        const message = {
          content:
`**새로운 문의**

**문의 내용**
${data.inquiry}`
        };

        // Discord Webhook 전송
        const discordResponse = await fetch(
          env.DISCORD_WEBHOOK_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(message)
          }
        );

        if (!discordResponse.ok) {
          return new Response("Discord 전송에 실패했습니다.", {
            status: 500,
            headers: corsHeaders
          });
        }

        return new Response(
          "문의가 정상적으로 접수되었습니다.",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/plain; charset=UTF-8"
            }
          }
        );

      } catch (error) {
        console.error(error);

        return new Response("서버 오류가 발생했습니다.", {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // =========================
    // 다른 POST 요청
    // =========================
    if (request.method === "POST") {
      return new Response("잘못된 요청입니다.", {
        status: 404,
        headers: corsHeaders
      });
    }

    // =========================
    // GET 요청
    // 사이트 파일 제공
    // =========================
    if (request.method === "GET") {
      return env.ASSETS.fetch(request);
    }

    // =========================
    // 그 외 메서드
    // =========================
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }
};
