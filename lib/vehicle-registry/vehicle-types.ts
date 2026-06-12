export const VEHICLE_TYPES = ["car", "motorcycle", "truck", "camper"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * Wizard profile options (6 choices). Heavy transport → truck; Other → car
 * (metadata preserves the profile label).
 */
export const VEHICLE_PROFILE_IDS = [
  "car",
  "motorcycle",
  "truck",
  "camper",
  "heavyTransport",
  "other",
] as const;
export type VehicleProfileId = (typeof VEHICLE_PROFILE_IDS)[number];

export function profileToVehicleType(p: VehicleProfileId): VehicleType {
  if (p === "heavyTransport") return "truck";
  if (p === "other") return "car";
  return p;
}

export function vehicleTypeToUint8(t: VehicleType): number {
  const map: Record<VehicleType, number> = {
    car: 0,
    motorcycle: 1,
    truck: 2,
    camper: 3,
  };
  return map[t];
}
