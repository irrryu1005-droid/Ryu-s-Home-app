import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT_SLUG: Record<string, string> = {
  "Soccer":     "football",
  "Baseball":   "baseball",
  "Basketball": "basketball",
  "Tennis":     "tennis",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const url   = new URL(req.url);
    const sport = url.searchParams.get("sport"); // "Soccer" など
    const date  = url.searchParams.get("date");  // "2026-05-21"

    if (!sport || !date) {
      return new Response(
        JSON.stringify({ error: "sport and date are required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const slug = SPORT_SLUG[sport] ?? sport.toLowerCase();
    const apiUrl = `https://sofascore.p.rapidapi.com/sport/${slug}/scheduled-events/${date}`;

    const apiKey = Deno.env.get("RAPIDAPI_KEY");
    if (!apiKey) throw new Error("RAPIDAPI_KEY not set");

    const res = await fetch(apiUrl, {
      headers: {
        "x-rapidapi-key":  apiKey,
        "x-rapidapi-host": "sofascore.p.rapidapi.com",
        "Content-Type":    "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: `API returned ${res.status}`, detail: text }),
        { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
