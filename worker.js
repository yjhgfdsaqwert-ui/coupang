export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // ========================================
    // OPTIONS
    // ========================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // ========================================
    // 대리구매 신청
    // POST /api/apply
    // Webhook: APPLY
    // ========================================
    if (
      request.method === "POST" &&
      url.pathname === "/api/apply"
    ) {
      try {
        if (!env.APPLY) {
          console.error("APPLY Secret이 설정되지 않았습니다.");

          return new Response(
            "대리구매 신청 웹후크가 설정되지 않았습니다.",
            {
              status: 500,
              headers: corsHeaders
            }
          );
        }

        const data = await request.json();

        // 입력값 확인
        if (
          !data.name ||
          !data.phone ||
          !data.address ||
          !data.product ||
          !data.code
        ) {
          return new Response(
            "모든 항목을 입력해주세요.",
            {
              status: 400,
              headers: corsHeaders
            }
          );
        }

        // Discord 메시지
        const messageContent =
          "**대리구매 신청**\n\n" +
          "**이름**\n" +
          data.name +
          "\n\n" +
          "**연락받을 전화번호**\n" +
          data.phone +
          "\n\n" +
          "**주소**\n" +
          data.address +
          "\n\n" +
          "**상품 링크**\n" +
          data.product +
          "\n\n" +
          "**기프트카드 코드**\n" +
          data.code;

        const message = {
          content: messageContent
        };

        // APPLY 웹후크로 전송
        const discordResponse = await fetch(
          env.APPLY,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(message)
          }
        );

        if (!discordResponse.ok) {
          const discordText =
            await discordResponse.text();

          console.error(
            "APPLY Discord 오류:",
            discordResponse.status,
            discordText
          );

          return new Response(
            "Discord 전송에 실패했습니다.",
            {
              status: 500,
              headers: corsHeaders
            }
          );
        }

        return new Response(
          "신청이 정상적으로 접수되었습니다.",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type":
                "text/plain; charset=UTF-8"
            }
          }
        );

      } catch (error) {
        console.error(
          "대리구매 신청 오류:",
          error
        );

        return new Response(
          "서버 오류가 발생했습니다.",
          {
            status: 500,
            headers: corsHeaders
          }
        );
      }
    }

    // ========================================
    // 문의
    // POST /api/inquiry
    // Webhook: INQUIRY
    // ========================================
    if (
      request.method === "POST" &&
      url.pathname === "/api/inquiry"
    ) {
      try {
        if (!env.INQUIRY) {
          console.error(
            "INQUIRY Secret이 설정되지 않았습니다."
          );

          return new Response(
            "문의 웹후크가 설정되지 않았습니다.",
            {
              status: 500,
              headers: corsHeaders
            }
          );
        }

        const data = await request.json();

        // 입력값 확인
        if (!data.inquiry) {
          return new Response(
            "문의 내용을 입력해주세요.",
            {
              status: 400,
              headers: corsHeaders
            }
          );
        }

        // Discord 메시지
        const messageContent =
          "**문의**\n" +
          data.inquiry;

        const message = {
          content: messageContent
        };

        // INQUIRY 웹후크로 전송
        const discordResponse = await fetch(
          env.INQUIRY,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(message)
          }
        );

        if (!discordResponse.ok) {
          const discordText =
            await discordResponse.text();

          console.error(
            "INQUIRY Discord 오류:",
            discordResponse.status,
            discordText
          );

          return new Response(
            "Discord 전송에 실패했습니다.",
            {
              status: 500,
              headers: corsHeaders
            }
          );
        }

        return new Response(
          "문의가 정상적으로 접수되었습니다.",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type":
                "text/plain; charset=UTF-8"
            }
          }
        );

      } catch (error) {
        console.error(
          "문의 처리 오류:",
          error
        );

        return new Response(
          "서버 오류가 발생했습니다.",
          {
            status: 500,
            headers: corsHeaders
          }
        );
      }
    }

    // ========================================
    // API가 아닌 POST
    // ========================================
    if (request.method === "POST") {
      return new Response(
        "잘못된 API 요청입니다.",
        {
          status: 404,
          headers: corsHeaders
        }
      );
    }

    // ========================================
    // GET → 정적 파일
    // ========================================
    if (request.method === "GET") {
      return env.ASSETS.fetch(request);
    }

    // ========================================
    // 그 외 Method
    // ========================================
    return new Response(
      "Method Not Allowed",
      {
        status: 405,
        headers: corsHeaders
      }
    );
  }
};
```
