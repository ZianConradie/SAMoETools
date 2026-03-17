const WARERA_BASE = "https://api2.warera.io/trpc";
const ENDPOINTS = {
  transaction: "transaction.getPaginatedTransactions",
  user: "user.getUserLite"
};

function withCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response("", { status: 204 }));
    }

    if (request.method !== "POST") {
      return withCors(new Response("Method not allowed.", { status: 405 }));
    }

    const allowlist = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (allowlist.length > 0) {
      const origin = request.headers.get("Origin") || "";
      if (!allowlist.includes(origin)) {
        return withCors(new Response("Forbidden.", { status: 403 }));
      }
    }

    const apiKey = env.WARERA_API_KEY;
    if (!apiKey) {
      return withCors(new Response("Server not configured.", { status: 500 }));
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return withCors(new Response("Invalid JSON.", { status: 400 }));
    }

    const { endpoint, input } = body || {};
    if (endpoint === "official") {
      const officialKey = env.OFFICIAL_KEY || "";
      const provided = (input && input.key) || "";
      const ok = officialKey && provided === officialKey;
      return withCors(
        new Response(JSON.stringify({ ok }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (endpoint && endpoint.startsWith("todo.")) {
      const officialKey = env.OFFICIAL_KEY || "";
      const provided = (input && input.key) || "";
      if (!officialKey || provided !== officialKey) {
        return withCors(new Response("Forbidden.", { status: 403 }));
      }

      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const raw = await env.TODOS.get("todos");
      const todos = raw ? JSON.parse(raw) : [];

      const prune = todos.filter((item) => {
        if (item.status !== "done") return true;
        if (!item.completedAt) return true;
        return now - item.completedAt <= weekMs;
      });

      const save = async (next) => {
        await env.TODOS.put("todos", JSON.stringify(next));
      };

      if (endpoint === "todo.list") {
        await save(prune);
        return withCors(
          new Response(JSON.stringify({ items: prune }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (endpoint === "todo.add") {
        const text = (input && input.text) || "";
        const status = (input && input.status) || "todo";
        const item = {
          id: crypto.randomUUID(),
          text,
          status,
          createdAt: now,
          completedAt: status === "done" ? now : null
        };
        const next = [item, ...prune];
        await save(next);
        return withCors(
          new Response(JSON.stringify({ item }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (endpoint === "todo.update") {
        const id = (input && input.id) || "";
        const status = (input && input.status) || "todo";
        const next = prune.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            status,
            completedAt: status === "done" ? now : null
          };
        });
        await save(next);
        return withCors(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (endpoint === "todo.delete") {
        const id = (input && input.id) || "";
        const next = prune.filter((item) => item.id !== id);
        await save(next);
        return withCors(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
    }

    const path = ENDPOINTS[endpoint];
    if (!path) {
      return withCors(new Response("Invalid endpoint.", { status: 400 }));
    }

    try {
      let upstream;
      if (endpoint === "user") {
        upstream = await fetch(`${WARERA_BASE}/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey
          },
          body: JSON.stringify(input || {})
        });
      } else {
        const params = new URLSearchParams({
          input: JSON.stringify(input || {})
        });
        upstream = await fetch(`${WARERA_BASE}/${path}?${params.toString()}`, {
          headers: { "X-API-Key": apiKey }
        });
      }

      const text = await upstream.text();
      const response = new Response(text, { status: upstream.status });
      return withCors(response);
    } catch (err) {
      return withCors(new Response("Upstream error.", { status: 502 }));
    }
  }
};
