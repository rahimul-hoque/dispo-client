async function forward(request, { params }) {
    const path = (await params).path.join("/");
    const cookie = request.headers.get("cookie") || "";
    const search = new URL(request.url).search; // e.g. "?deviceId=abc123" — was previously dropped entirely
  
    const init = {
      method: request.method,
      headers: { cookie, "Content-Type": "application/json" },
    };
  
    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      init.body = await request.text();
    }
  
    // Points at the deployed Express backend in production; falls back to
    // localhost for local dev. This runs server-side (inside the Next.js
    // Route Handler), never in the browser, so this is a plain server-to-
    // server fetch — no CORS involved regardless of the deployed domains.
    const apiBase = process.env.EXPRESS_API_URL || "http://localhost:8000";
    try {
      const res = await fetch(`${apiBase}/api/${path}${search}`, init);

      // Binary responses (product images) pass straight through, keeping
      // the backend's caching headers so the browser caches them.
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && !contentType.includes("application/json")) {
        const headers = { "Content-Type": contentType };
        const cacheControl = res.headers.get("cache-control");
        if (cacheControl) headers["Cache-Control"] = cacheControl;
        return new Response(await res.arrayBuffer(), { status: res.status, headers });
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // Backend answered with something that isn't JSON (a platform
        // error page, a crashed function) — surface what it was rather
        // than throwing an empty 500.
        console.error(`[proxy] non-JSON ${res.status} from ${path}:`, text.slice(0, 300));
        return Response.json(
          { error: "Backend returned an unexpected response", upstreamStatus: res.status },
          { status: 502 }
        );
      }
      return Response.json(data, { status: res.status });
    } catch (error) {
      console.error(`[proxy] request to ${path} failed:`, error);
      return Response.json({ error: "Couldn't reach the backend" }, { status: 502 });
    }
  }
  
  export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
