/** Shared select options for passport wizards and marketplace filters. */

export const FUEL_TYPE_OPTIONS = ["Petrol", "Diesel", "Electric", "Hybrid", "Other"] as const;
export const BODY_TYPE_OPTIONS = [
  "Sedan",
  "SUV",
  "Hatchback",
  "Coupe",
  "Van",
  "Truck",
  "Other",
] as const;
export const TRANSMISSION_OPTIONS = ["Manual", "Automatic"] as const;
export const VEHICLE_TYPE_OPTIONS = [
  "Car",
  "Motorcycle",
  "Truck",
  "Camper",
  "Other",
] as const;
export const CONDITION_OPTIONS = ["Excellent", "Good", "Fair", "Needs work", "For parts"] as const;
