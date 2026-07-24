import { NextResponse } from "next/server";

import { createPhotonPlaceDirectory } from "@/lib/geo/adapters/photon";
import { parseGeoLangParam } from "@/lib/geo/http-query";
import { GeoError } from "@/lib/geo/types";

const directory = createPhotonPlaceDirectory();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number.parseFloat(searchParams.get("lat") ?? "");
  const lng = Number.parseFloat(searchParams.get("lng") ?? "");

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const langParsed = parseGeoLangParam(searchParams.get("lang"));
  if (!langParsed.ok) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    const place = await directory.reverse({
      lat,
      lng,
      ...(langParsed.lang ? { lang: langParsed.lang } : {}),
    });
    return NextResponse.json({ place });
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
