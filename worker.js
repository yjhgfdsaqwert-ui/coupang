export default {
  async fetch(request, env) {

    // CORS 처리
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // POST만 허용
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    try {
      const data = await request.json();

      // 입력값 확인
      if (!data.name || !data.phone || !data.address || !data.product || !data.code) {
        return new Response("모든 항목을 입력해주세요.", {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*"
          }
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

      // Discord Webhook으로 전송
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
          headers: {
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      return new Response("신청이 정상적으로 접수되었습니다.", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain; charset=UTF-8"
        }
      });

    } catch (error) {

      console.error(error);

      return new Response("서버 오류가 발생했습니다.", {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};
