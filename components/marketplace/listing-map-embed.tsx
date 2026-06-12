type Props = {
  lat: number;
  lng: number;
  title: string;
};

/** OpenStreetMap embed (no extra deps). Bounding box ~ neighborhood scale. */
export function ListingMapEmbed({ lat, lng, title }: Props) {
  const pad = 0.03;
  const left = lng - pad;
  const right = lng + pad;
  const bottom = lat - pad;
  const top = lat + pad;
  const bbox = `${left},${bottom},${right},${top}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lng}`;

  return (
    <iframe
      title={title}
      src={src}
      className="h-64 w-full rounded-md border border-border-default bg-bg-surface"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
