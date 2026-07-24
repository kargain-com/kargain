import { NextResponse } from "next/server";

import { createPhotonPlaceDirectory } from "@/lib/geo/adapters/photon";
import { parseGeoLangParam } from "@/lib/geo/http-query";
import { GeoError } from "@/lib/geo/types";

const directory = createPhotonPlaceDirectory();

const MAX_Q = 80;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > MAX_Q) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const langParsed = parseGeoLangParam(searchParams.get("lang"));
  if (!langParsed.ok) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    const places = await directory.suggest({
      q,
      ...(langParsed.lang ? { lang: langParsed.lang } : {}),
      limit: 8,
    });
    return NextResponse.json({ places });
  } catch (err) {
    return mapUpstreamError(err);
  }
}

function mapUpstreamError(err: unknown): NextResponse {
  if (err instanceof GeoError && err.code === "invalid_query") {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  return NextResponse.json({ error: "upstream" }, { status: 502 });
}
