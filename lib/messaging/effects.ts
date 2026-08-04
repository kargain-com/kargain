import type {
  BuildLocalResult,
  Clock,
  MessagingSessionPorts,
  SessionCommand,
  XmtpLocalClient,
} from "./ports";
import {
  BUILD_DEADLINE_MS,
  RECONCILING_HINT_MS,
  REVOKE_ALL_COOLDOWN_MS,
} from "./session-budgets";
import {
  createInitialMachineState,
  projectSnapshot,
  transitionMachine,
  type MachineState,
} from "./machine";
import {
  applyBuildResult,
  applyCreateResult,
  intentAfterDisable,
  intentAfterEnablePublish,
  reconcile,
  type ReconcilePlan,
} from "./reconcile";
import {
  markRevokeAllAt,
  readLastRevokeAllAt,
  type MessagingCachePort,
} from "./adapters/cache-adapter";
import { getMessagingXmtpEnv } from "./xmtp-env";
import { withEnableWalletSignatures } from "./snapshot-ui";

export type EffectsRunner = {
  start(): void;
  dispatch(command: SessionCommand): void;
  requestLocalClient(): void;
  releaseLocalClient(): void;
  onAddressChange(address: string): void;
  getState(): MachineState;
  getInFlightCount(): number;
  dispose(): void;
};

export type CreateEffectsRunnerInput = {
  address: string;
  ports: MessagingSessionPorts;
  clock: Clock;
  cache: MessagingCachePort;
  onChange: () => void;
  /** XMTP env for revoke-all cooldown key; defaults to getMessagingXmtpEnv(). */
  env?: string;
};

export function createEffectsRunner(input: CreateEffectsRunnerInput): EffectsRunner {
  const { ports, clock, cache, onChange } = input;
  const env = input.env ?? getMessagingXmtpEnv();
  let state = createInitialMachineState(input.address);
  let generation = 1;
  let inFlightCount = 0;
  let disposed = false;
  let abortController: AbortController | null = null;
  let createAbortController: AbortController | null = null;
  let loopScheduled = false;
  let ticking = false;

  function notify() {
    onChange();
  }

  function apply(event: Parameters<typeof transitionMachine>[1]) {
    state = transitionMachine(state, event);
    notify();
  }

  function isStale(opGeneration: number): boolean {
    return opGeneration !== generation;
  }

  /**
   * Sole owner of published-client teardown.
   * Clear ownership + notify first (unless alreadyDetached); destroy after one
   * macrotask so consumers that key streams on `client` can detach. Completion
   * is observed via the adapter release queue (`whenLocalIdle`).
   */
  function abandonOwnedClient(
    client: XmtpLocalClient,
    opts: { defer: boolean; alreadyDetached?: boolean },
  ) {
    if (!opts.alreadyDetached && state.localClient === client) {
      apply({ type: "local_client_set", client: null });
    }
    const release = () => {
      void ports.xmtp.closeLocal(client);
    };
    if (opts.defer) {
      void clock.sleep(0).then(release);
    } else {
      release();
    }
  }

  function abortInFlight() {
    abortController?.abort();
    abortController = null;
  }

  function beginInFlight(): AbortController {
    abortInFlight();
    const controller = new AbortController();
    abortController = controller;
    inFlightCount = 1;
    return controller;
  }

  function endInFlight() {
    abortController = null;
    inFlightCount = 0;
    apply({ type: "effect_cleared" });
  }

  function deadlineFor(op: ReconcilePlan & { kind: "run" }): number {
    const now = clock.nowMs();
    if (op.effect === "build") return now + BUILD_DEADLINE_MS;
    // sdk / create / publish / revoke: no wall deadline
    return Number.MAX_SAFE_INTEGER;
  }

  function formatUnknownCause(err: unknown): string {
    if (err instanceof Error) return err.message || err.name;
    return String(err);
  }

  function closeOrphanBuildResult(result: BuildLocalResult | "timeout" | undefined): void {
    if (result && result !== "timeout" && result.ok) {
      void ports.xmtp.closeLocal(result.client);
    }
  }

  /**
   * Race work against a clock sleep that is NOT tied to the op AbortSignal
   * (aborting the op must not cancel the deadline timer via reject).
   * On timeout/stale, a later-ok build client is closed (abandoned init).
   */
  async function runWithDeadline(
    opGeneration: number,
    deadlineMs: number,
    signal: AbortSignal,
    fn: () => Promise<BuildLocalResult>,
  ): Promise<BuildLocalResult | "timeout"> {
    const remaining = deadlineMs - clock.nowMs();
    if (remaining <= 0) return "timeout";

    const work = fn().then(
      (value) => ({ kind: "ok" as const, value }),
      (err: unknown) => ({ kind: "err" as const, err }),
    );
    const timeout = clock.sleep(remaining).then(() => ({ kind: "timeout" as const }));

    const raced = await Promise.race([work, timeout]);

    if (raced.kind === "timeout") {
      abortController?.abort();
      void work.then((outcome) => {
        if (outcome.kind === "ok") closeOrphanBuildResult(outcome.value);
      });
      return "timeout";
    }
    if (raced.kind === "err") {
      if (signal.aborted || isAbortError(raced.err)) return "timeout";
      throw raced.err;
    }
    // Return the value even when stale so the caller can closeLocal an orphan
    // that never entered machine state (address change mid-build/create).
    return raced.value;
  }

  function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === "AbortError";
  }

  function isRevokeAllInCooldown(): boolean {
    const last = readLastRevokeAllAt(env, state.address);
    if (last === undefined) return false;
    return clock.nowMs() - last < REVOKE_ALL_COOLDOWN_MS;
  }

  async function executePlan(plan: ReconcilePlan) {
    if (plan.kind !== "run" || disposed) return;

    const opGeneration = generation;

    if (plan.effect === "create") {
      const deadlineMs = deadlineFor(plan);
      apply({
        type: "effect_started",
        op: plan.effect,
        deadlineMs,
        generation: opGeneration,
      });
      createAbortController?.abort();
      createAbortController = new AbortController();
      const createSignal = createAbortController.signal;
      inFlightCount = 1;
      // Consume mint authorisation before any irreversible work — one enable /
      // reset stage yields at most one create attempt.
      const fromReset = state.resetChain === "create";
      apply({ type: "enable_cleared" });
      apply({ type: "registration_set", status: "unknown" });
      if (fromReset) {
        apply({ type: "reset_cleared" });
      }
      try {
        await ports.xmtp.whenLocalIdle();
        if (isStale(opGeneration) || createSignal.aborted) {
          apply({ type: "awaiting_signature_set", reason: "create_cancelled" });
          return;
        }
        await ports.wallet.waitUntilReady(createSignal);
        if (isStale(opGeneration) || createSignal.aborted) {
          apply({ type: "awaiting_signature_set", reason: "create_cancelled" });
          return;
        }
        if (state.storageDurable === null) {
          const durableResult = await ports.xmtp.ensureDurableStorage(createSignal);
          if (isStale(opGeneration) || createSignal.aborted) {
            apply({ type: "awaiting_signature_set", reason: "create_cancelled" });
            return;
          }
          apply({ type: "storage_durable_set", durable: durableResult.durable });
        }
        const result = await ports.xmtp.createWithSigner(state.address, createSignal);
        if (isStale(opGeneration)) {
          if (result.ok) void ports.xmtp.closeLocal(result.client);
          return;
        }
        if (createSignal.aborted && !result.ok) {
          apply({ type: "awaiting_signature_set", reason: "create_cancelled" });
          return;
        }
        settleCreate(result);
      } catch (err) {
        if (!isStale(opGeneration)) {
          apply({
            type: "awaiting_signature_set",
            reason: isAbortError(err) ? "create_cancelled" : "build_failed",
          });
        }
      } finally {
        createAbortController = null;
        endInFlight();
      }
      return;
    }

    if (plan.effect === "build") {
      // Idle wait is outside the wall deadline — held handles must not burn it.
      const signal = beginInFlight().signal;
      try {
        apply({
          type: "effect_started",
          op: "build",
          deadlineMs: Number.MAX_SAFE_INTEGER,
          generation: opGeneration,
        });
        await ports.xmtp.whenLocalIdle();
        if (isStale(opGeneration) || signal.aborted) return;
        const deadlineMs = clock.nowMs() + BUILD_DEADLINE_MS;
        apply({
          type: "effect_started",
          op: "build",
          deadlineMs,
          generation: opGeneration,
        });
        const result = await runWithDeadline(opGeneration, deadlineMs, signal, () =>
          ports.xmtp.buildLocal(state.address, signal),
        );
        if (isStale(opGeneration)) {
          closeOrphanBuildResult(result);
          return;
        }
        if (result === "timeout") {
          apply({ type: "last_error_set", reason: "timeout" });
          return;
        }
        const mapped = applyBuildResult(result);
        if (mapped.registrationStatus) {
          apply({ type: "registration_set", status: mapped.registrationStatus });
        }
        if (mapped.client) {
          apply({ type: "local_client_set", client: mapped.client });
        } else {
          apply({
            type: "local_client_set",
            client: null,
            reason: mapped.reason ?? undefined,
          });
          // Park on awaiting unless enable already holds a not_registered
          // answer — shouldCreate runs on the next tick (positive answer only).
          const deferToCreate =
            mapped.awaiting === "not_registered" && state.enableRequested;
          if (mapped.awaiting && !deferToCreate) {
            apply({ type: "awaiting_signature_set", reason: mapped.awaiting });
          }
          if (mapped.lastError) {
            apply({ type: "last_error_set", reason: mapped.lastError });
          }
        }
      } catch (err) {
        if (!isStale(opGeneration)) {
          if (isAbortError(err)) {
            // Cancelled mid-op — do not pretend timeout.
          } else {
            apply({
              type: "last_error_set",
              reason: "unknown",
              cause: formatUnknownCause(err),
            });
          }
        }
      } finally {
        endInFlight();
      }
      return;
    }

    const deadlineMs = deadlineFor(plan);
    apply({
      type: "effect_started",
      op: plan.effect,
      deadlineMs,
      generation: opGeneration,
    });

    const signal = beginInFlight().signal;

    try {
      switch (plan.effect) {
        case "sdk": {
          try {
            await ports.xmtp.ensureModule(signal);
          } catch (err) {
            if (isStale(opGeneration)) return;
            if (signal.aborted || isAbortError(err)) {
              // User cancelled the download — idle until retry/enable.
              break;
            }
            apply({
              type: "last_error_set",
              reason: "unknown",
              cause: formatUnknownCause(err),
            });
          }
          break;
        }
        case "publish": {
          const enabled = plan.publishValue === true;
          const result = await ports.nostr.publishIntent(state.address, enabled, signal);
          if (isStale(opGeneration)) return;
          if (result.ok) {
            apply({ type: "publish_error_set", error: null });
            apply({ type: "publish_pending_set", pending: false });
            if (enabled) {
              apply({ type: "intent_loaded", intent: intentAfterEnablePublish() });
              cache.set(state.address, { intent: true });
              apply({ type: "enable_cleared" });
            } else {
              // Amendment C: keep local client so inbox stays readable after opt-out.
              apply({ type: "intent_loaded", intent: intentAfterDisable() });
              apply({ type: "disable_cleared" });
              cache.set(state.address, { intent: false });
            }
          } else if (result.reason === "signature_declined") {
            // Retry-inviting: clear sticky hard failure; keep pending if enable
            // already built a client so publish-only retry works.
            apply({ type: "publish_error_set", error: null });
            if (enabled) {
              apply({
                type: "publish_pending_set",
                pending: state.localClient != null,
              });
              apply({ type: "enable_cleared" });
            } else {
              apply({ type: "disable_cleared" });
            }
          } else if (enabled) {
            apply({ type: "publish_pending_set", pending: true });
            apply({ type: "publish_error_set", error: "publish_failed" });
            apply({ type: "enable_cleared" });
          } else {
            apply({ type: "publish_error_set", error: "publish_failed" });
            apply({ type: "disable_cleared" });
          }
          break;
        }
        case "revoke": {
          const mode = state.revokeMode ?? "others";
          if (mode === "all") {
            // Publish intent false before revoke so peers never see reachable
            // with zero installations if create is declined/fails.
            const published = await ports.nostr.publishIntent(state.address, false, signal);
            if (isStale(opGeneration)) return;
            if (!published.ok) {
              if (published.reason === "signature_declined") {
                apply({ type: "publish_error_set", error: null });
              } else {
                apply({ type: "publish_error_set", error: "publish_failed" });
              }
              apply({ type: "reset_cleared" });
              break;
            }
            apply({ type: "intent_loaded", intent: false });
            cache.set(state.address, { intent: false });

            const result = await ports.xmtp.revokeAllInstallations(state.address, signal);
            if (isStale(opGeneration)) return;
            if (!result.ok) {
              apply({ type: "revoke_all_cooldown_set", blocked: true });
              apply({ type: "reset_cleared" });
              apply({ type: "awaiting_signature_set", reason: "installation_limit" });
              break;
            }
            markRevokeAllAt(env, state.address, clock.nowMs());
            const owned = state.localClient;
            if (owned) {
              abandonOwnedClient(owned, { defer: true });
            } else {
              apply({ type: "local_client_set", client: null });
            }
            apply({ type: "reset_chain_set", stage: "create" });
            break;
          }
          const others = await ports.xmtp.revokeOtherInstallations(
            state.address,
            signal,
            state.localClient,
          );
          if (isStale(opGeneration)) return;
          if (!others.ok) {
            // Preserve-current refused — user must use full revoke.
            apply({ type: "reset_cleared" });
            apply({ type: "awaiting_signature_set", reason: "installation_limit" });
            break;
          }
          apply({ type: "reset_chain_set", stage: "create" });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      if (!isStale(opGeneration)) {
        if (isAbortError(err)) {
          // Cancelled mid-op — do not pretend timeout.
        } else {
          apply({
            type: "last_error_set",
            reason: "unknown",
            cause: formatUnknownCause(err),
          });
        }
      }
    } finally {
      endInFlight();
    }
  }

  function settleCreate(
    result:
      | { ok: true; client: XmtpLocalClient }
      | {
          ok: false;
          reason:
            | "installation_limit"
            | "opfs_lock"
            | "create_cancelled"
            | "build_failed";
        },
  ) {
    const mapped = applyCreateResult(result);
    if (mapped.client) {
      apply({ type: "local_client_set", client: mapped.client });
      apply({ type: "reset_cleared" });
      if (mapped.registrationStatus) {
        apply({ type: "registration_set", status: mapped.registrationStatus });
      }
      apply({ type: "enable_cleared" });
      apply({ type: "publish_pending_set", pending: true });
      apply({ type: "revoke_all_cooldown_set", blocked: false });
      return;
    }
    if (mapped.awaiting) {
      apply({ type: "awaiting_signature_set", reason: mapped.awaiting });
      apply({ type: "enable_cleared" });
      apply({ type: "reset_cleared" });
    }
    if (mapped.lastError) {
      apply({ type: "last_error_set", reason: mapped.lastError });
      apply({ type: "enable_cleared" });
      apply({ type: "reset_cleared" });
    }
  }

  function scheduleLoop() {
    if (loopScheduled || disposed) return;
    loopScheduled = true;
    queueMicrotask(() => {
      loopScheduled = false;
      if (disposed) return;
      void tick();
    });
  }

  async function tick() {
    if (ticking || disposed) return;
    ticking = true;
    try {
      while (!disposed) {
        if (state.inFlight) return;
        const kind = ports.wallet.getAccountKind();
        if (kind === "contract" || !ports.wallet.getAddress()) {
          notify();
          return;
        }
        const plan = reconcile({
          state,
          nowMs: clock.nowMs(),
          moduleReady: ports.xmtp.isModuleReady(),
        });
        if (plan.kind === "await_signature") {
          apply({ type: "awaiting_signature_set", reason: plan.reason });
          return;
        }
        if (plan.kind === "run") {
          await executePlan(plan);
          continue;
        }
        notify();
        return;
      }
    } finally {
      ticking = false;
    }
  }

  async function loadIntent() {
    if (state.intentLoaded || disposed) return;
    if (ports.wallet.getAccountKind() === "contract" || !ports.wallet.getAddress()) {
      return;
    }
    const memo = cache.get(state.address);
    if (memo?.intent !== undefined) {
      apply({ type: "intent_loaded", intent: memo.intent });
      scheduleLoop();
      return;
    }
    const opGeneration = generation;
    apply({
      type: "effect_started",
      op: "intent",
      deadlineMs: clock.nowMs() + RECONCILING_HINT_MS,
      generation: opGeneration,
    });
    try {
      const result = await ports.nostr.readIntent(state.address);
      if (isStale(opGeneration)) return;
      if (result.status === "unanswered") {
        apply({ type: "intent_unanswered" });
        scheduleLoop();
        return;
      }
      apply({ type: "intent_loaded", intent: result.intent });
      cache.set(state.address, { intent: result.intent });
      void ports.nostr.probeAttestationValid(state.address).then(() => {
        if (!disposed && !isStale(opGeneration)) notify();
      });
      scheduleLoop();
    } catch {
      if (!isStale(opGeneration)) {
        apply({ type: "intent_unanswered" });
        scheduleLoop();
      }
    } finally {
      if (!isStale(opGeneration)) {
        apply({ type: "effect_cleared" });
      }
    }
  }

  return {
    start() {
      void (async () => {
        await ports.wallet.ensureAccountKindProbed();
        if (disposed) return;
        notify();
        await loadIntent();
      })();
    },
    dispatch(command) {
      if (disposed) return;
      switch (command.type) {
        case "enable":
          apply({ type: "last_error_set", reason: null });
          apply({ type: "awaiting_signature_set", reason: null });
          apply({ type: "publish_error_set", error: null });
          apply({ type: "revoke_all_cooldown_set", blocked: false });
          apply({ type: "enable_requested" });
          scheduleLoop();
          break;
        case "disable":
          apply({ type: "disable_requested" });
          scheduleLoop();
          break;
        case "resetIdentity":
          apply({ type: "awaiting_signature_set", reason: null });
          apply({ type: "last_error_set", reason: null });
          apply({ type: "revoke_all_cooldown_set", blocked: false });
          apply({ type: "revoke_mode_set", mode: "others" });
          apply({ type: "reset_requested" });
          apply({ type: "reset_chain_set", stage: "revoke" });
          scheduleLoop();
          break;
        case "revokeAllInstallations":
          apply({ type: "awaiting_signature_set", reason: null });
          apply({ type: "last_error_set", reason: null });
          if (isRevokeAllInCooldown()) {
            apply({ type: "revoke_all_cooldown_set", blocked: true });
            apply({ type: "awaiting_signature_set", reason: "installation_limit" });
            break;
          }
          apply({ type: "revoke_all_cooldown_set", blocked: false });
          apply({ type: "revoke_mode_set", mode: "all" });
          apply({ type: "reset_requested" });
          apply({ type: "reset_chain_set", stage: "revoke" });
          scheduleLoop();
          break;
        case "retry":
          apply({ type: "awaiting_signature_set", reason: null });
          apply({ type: "last_error_set", reason: null });
          apply({ type: "revoke_all_cooldown_set", blocked: false });
          if (state.publishPending || state.publishError) {
            apply({ type: "publish_error_set", error: null });
            apply({ type: "publish_pending_set", pending: true });
          } else {
            apply({ type: "enable_requested" });
          }
          scheduleLoop();
          break;
        case "cancel": {
          const createInFlight =
            createAbortController !== null ||
            state.inFlight?.op === "create";
          createAbortController?.abort();
          createAbortController = null;
          abortInFlight();
          if (state.inFlight) endInFlight();
          if (createInFlight) {
            apply({ type: "awaiting_signature_set", reason: "create_cancelled" });
            apply({ type: "enable_cleared" });
          }
          scheduleLoop();
          break;
        }
        default:
          break;
      }
    },
    requestLocalClient() {
      if (disposed) return;
      apply({ type: "client_demand_delta", delta: 1 });
      scheduleLoop();
    },
    releaseLocalClient() {
      if (disposed) return;
      apply({ type: "client_demand_delta", delta: -1 });
      scheduleLoop();
    },
    onAddressChange(address: string) {
      if (address.toLowerCase() === state.address.toLowerCase()) return;
      const previousClient = state.localClient;
      abortInFlight();
      createAbortController?.abort();
      createAbortController = null;
      generation += 1;
      cache.invalidate(state.address);
      state = {
        ...createInitialMachineState(address),
        generation,
      };
      inFlightCount = 0;
      notify();
      if (previousClient) {
        abandonOwnedClient(previousClient, { defer: true, alreadyDetached: true });
      }
      void loadIntent();
    },
    getState() {
      return state;
    },
    getInFlightCount() {
      return inFlightCount;
    },
    dispose() {
      disposed = true;
      const owned = state.localClient;
      if (owned) {
        abandonOwnedClient(owned, { defer: true });
      }
      abortInFlight();
      createAbortController?.abort();
      createAbortController = null;
    },
  };
}

export function getSessionSnapshot(
  state: MachineState,
  ports: MessagingSessionPorts,
  nowMs?: number,
) {
  const base = projectSnapshot(
    state,
    ports.wallet.getAddress(),
    ports.wallet.getAccountKind(),
    nowMs ?? Date.now(),
  );
  return withEnableWalletSignatures(base, {
    keyHeld: ports.nostr.isKeyHeld(),
    attestationValidCached: ports.nostr.getAttestationValidCached(),
    hasLocalClient: state.localClient != null,
  });
}
