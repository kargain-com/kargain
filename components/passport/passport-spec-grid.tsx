import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";

type SpecRow = {
  label: string;
  value: string;
};

function formatMileage(km: number): string {
  return `${km.toLocaleString()} km`;
}

function buildRows(metadata: PassportMetadata): SpecRow[] {
  const rows: SpecRow[] = [];

  if (metadata.vin) {
    rows.push({ label: "VIN", value: metadata.vin });
  }
  if (metadata.mileageKm != null && metadata.mileageKm >= 0) {
    rows.push({ label: "Mileage", value: formatMileage(metadata.mileageKm) });
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
