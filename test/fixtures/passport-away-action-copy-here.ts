/**
 * Type-level plant: passportAwayActionCopy must not accept `here`.
 * Under @ts-expect-error so pnpm typecheck stays green while the expect-error
 * remains required. Policy suite strips the directive → tsc red.
 */
import { passportAwayActionCopy } from "@/lib/passport/presence";

// @ts-expect-error — here must not be accepted by passportAwayActionCopy
passportAwayActionCopy({ status: "here" });
