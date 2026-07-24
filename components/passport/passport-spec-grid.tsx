import { InstrumentFrame } from "@/components/ui/instrument-frame";
import { serialLabel } from "@/lib/design/instrument-classes";
import { formatMileage } from "@/lib/passport/format-mileage";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";

type SpecRow = {
  label: string;
  value: string;
};

function formatLocation(metadata: PassportMetadata): string | null {
  const { location } = metadata;
  if (!location) return null;
  if (location.label?.trim()) return location.label.trim();
  const city = location.city?.trim();
  const country = location.countryCode?.trim();
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return null;
}

function buildRows(metadata: PassportMetadata): SpecRow[] {
  const rows: SpecRow[] = [];

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
  if (rows.length === 0 && !metadata.vin) {
    return (
      <p className="font-sans text-sm text-text-secondary">
        Vehicle details unavailable
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {metadata.vin ? (
        <div>
          <p className={serialLabel}>VIN</p>
          <InstrumentFrame className="mt-2 w-fit max-w-full">
            <p className="px-3 py-2 font-mono text-sm font-normal tabular-nums text-text-primary">
              {metadata.vin}
            </p>
          </InstrumentFrame>
        </div>
      ) : null}
      {rows.length > 0 ? (
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
      ) : null}
    </div>
  );
}
