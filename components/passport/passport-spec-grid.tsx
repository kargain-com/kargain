import type { PassportMetadata } from "@/lib/passport/metadata-schema";

type SpecRow = {
  label: string;
  value: string;
};

function formatMileage(km: number): string {
  return `${km.toLocaleString()} km`;
}

function formatLocation(metadata: PassportMetadata): string | null {
  const { location } = metadata;
  if (!location) return null;
  const parts: string[] = [];
  if (location.label) parts.push(location.label);
  if (location.lat != null && location.lng != null) {
    parts.push(`${location.lat}, ${location.lng}`);
  } else if (location.lat != null) {
    parts.push(String(location.lat));
  } else if (location.lng != null) {
    parts.push(String(location.lng));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildRows(metadata: PassportMetadata): SpecRow[] {
  const rows: SpecRow[] = [];

  if (metadata.vin) {
    rows.push({ label: "VIN", value: metadata.vin });
  }
  if (metadata.year != null) {
    rows.push({ label: "Year", value: String(metadata.year) });
  }
  if (metadata.mileageKm != null && metadata.mileageKm >= 0) {
    rows.push({ label: "Mileage", value: formatMileage(metadata.mileageKm) });
  }
  if (metadata.type) {
    rows.push({ label: "Type", value: metadata.type });
  }
  if (metadata.vehicleType) {
    rows.push({ label: "Vehicle type", value: metadata.vehicleType });
  }
  if (metadata.modelVariant) {
    rows.push({ label: "Variant", value: metadata.modelVariant });
  }
  if (metadata.colour) {
    rows.push({ label: "Colour", value: metadata.colour });
  }
  if (metadata.power) {
    rows.push({ label: "Power", value: metadata.power });
  }
  if (metadata.evBatteryKwh != null) {
    rows.push({ label: "EV battery", value: `${metadata.evBatteryKwh} kWh` });
  }
  if (metadata.engine) {
    rows.push({ label: "Engine", value: metadata.engine });
  }
  if (metadata.fuelType) {
    rows.push({ label: "Fuel", value: metadata.fuelType });
  }
  if (metadata.bodyType) {
    rows.push({ label: "Body", value: metadata.bodyType });
  }
  if (metadata.transmission) {
    rows.push({ label: "Transmission", value: metadata.transmission });
  }
  if (metadata.condition) {
    rows.push({ label: "Condition", value: metadata.condition });
  }
  if (metadata.features?.length) {
    rows.push({ label: "Features", value: metadata.features.join(", ") });
  }
  const location = formatLocation(metadata);
  if (location) {
    rows.push({ label: "Location", value: location });
  }

  return rows;
}

type Props = {
  metadata: PassportMetadata | null;
  metadataError?: boolean;
};

export function PassportSpecGrid({ metadata, metadataError }: Props) {
  if (metadataError || !metadata) {
    return (
      <p className="font-sans text-sm text-text-secondary">
        Vehicle details unavailable
      </p>
    );
  }

  const rows = buildRows(metadata);
  if (rows.length === 0) {
    return (
      <p className="font-sans text-sm text-text-secondary">
        Vehicle details unavailable
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
            {row.label}
          </dt>
          <dd className="mt-1 font-mono text-sm font-normal text-text-primary">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
