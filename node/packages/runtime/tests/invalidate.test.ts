import type { ITileset } from "@spacexr/3d-tiles-core";
import { describe, expect, it } from "vitest";

import { CameraChangeFlags, TileRuntime, type IRuntimeAdapter, type ITileActivationContext } from "../src";

interface ICamera {
    value: number;
}

interface ISpatial {
    value: number;
}

interface IHandle {
    id: string;
    version: number;
}

const tileset: ITileset = {
    asset: { version: "1.1" },
    geometricError: 0,
    root: {
        boundingVolume: { sphere: [0, 0, 0, 1] },
        geometricError: 0,
        content: { uri: "grid://root" },
    },
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

const spatial: IRuntimeAdapter<ICamera, ISpatial, IHandle, never>["spatial"] = {
    derive: () => ({ value: 1 }),
    isVisible: () => true,
    screenSpaceError: () => 0,
};

/** Pipeline ports logging presentation calls; refreshes wait for `gate` and report a new handle unless `inPlace`. */
function pipeline(options: { inPlace?: boolean } = {}) {
    const log: string[] = [];
    const presented = new Set<string>();
    const contexts: Array<ITileActivationContext<ISpatial, IHandle, never>> = [];
    let version = 0;
    let gate: Promise<void> = Promise.resolve();
    const adapter: IRuntimeAdapter<ICamera, ISpatial, IHandle, never> = {
        tilesets: { load: async () => ({ tileset }) },
        spatial,
        activation: {
            activate: async (context) => {
                contexts.push(context);
                if (context.refresh) await gate;
                for (const content of context.pendingContents) {
                    const handle = options.inPlace && content.handle ? content.handle : { id: content.id, version: ++version };
                    if (options.inPlace && content.handle) handle.version = ++version;
                    await context.readiness.ready(content.id, { kind: "renderable", handle });
                }
            },
            deactivate: () => undefined,
        },
        presentation: {
            present: (context) => {
                for (const { handle } of context.resources) {
                    if (!presented.has(`${handle.version}`)) log.push(`present ${handle.version}`);
                    presented.add(`${handle.version}`);
                }
            },
            hide: (context) => {
                for (const { handle } of context.resources) {
                    presented.delete(`${handle.version}`);
                    log.push(`hide ${handle.version}`);
                }
            },
            release: (context) => {
                for (const { handle } of context.resources) log.push(`release ${handle.version}`);
            },
        },
    };
    return {
        adapter,
        log,
        presented,
        contexts,
        hold: () => {
            const gateDeferred = deferred();
            gate = gateDeferred.promise;
            return gateDeferred.resolve;
        },
    };
}

async function frame(runtime: TileRuntime<ICamera, ISpatial, IHandle, never>): Promise<void> {
    runtime.onCameraChanged({ value: 1 }, CameraChangeFlags.All);
    await runtime.processFrame();
}

describe("content invalidation", () => {
    it("keeps the stale handle presented until its reload is ready, then swaps it between two frames", async () => {
        const ports = pipeline();
        const runtime = new TileRuntime({ id: "invalidate", uri: "memory://tileset.json", adapter: ports.adapter });
        await frame(runtime);
        await runtime.whenIdle();
        expect(ports.log).toEqual(["present 1"]);

        const release = ports.hold();
        await expect(runtime.invalidate(() => true)).resolves.toBe(1);
        const content = runtime.root!.contents[0]!;
        expect(content.stale).toBe(true);
        await frame(runtime);
        await frame(runtime);
        // The reload waits: the stale handle is still the one presented.
        expect(ports.contexts.at(-1)?.refresh).toBe(true);
        expect(ports.presented).toEqual(new Set(["1"]));
        expect(content.handle?.version).toBe(1);

        release();
        await runtime.whenIdle();
        expect(ports.log).toEqual(["present 1", "hide 1", "release 1", "present 2"]);
        expect(content.handle?.version).toBe(2);
        expect(content.stale).toBe(false);
        expect(content.attached).toBe(true);
        expect(runtime.root!.selected).toBe(true);
        await runtime.dispose();
        expect(ports.log.at(-1)).toBe("release 2");
    });

    it("accepts a handle refreshed in place without hiding it", async () => {
        const ports = pipeline({ inPlace: true });
        const runtime = new TileRuntime({ id: "in-place", uri: "memory://tileset.json", adapter: ports.adapter });
        await frame(runtime);
        await runtime.whenIdle();
        await runtime.invalidate(() => true);
        await frame(runtime);
        await runtime.whenIdle();
        const content = runtime.root!.contents[0]!;
        expect(ports.log).toEqual(["present 1"]);
        expect(content.handle?.version).toBe(2);
        expect(content.stale).toBe(false);
        await runtime.dispose();
    });

    it("leaves the tiles the predicate rejects untouched", async () => {
        const ports = pipeline();
        const runtime = new TileRuntime({ id: "predicate", uri: "memory://tileset.json", adapter: ports.adapter });
        await frame(runtime);
        await runtime.whenIdle();
        await expect(runtime.invalidate((tile) => tile.id !== runtime.root!.id)).resolves.toBe(0);
        await frame(runtime);
        await runtime.whenIdle();
        expect(ports.contexts.some((context) => context.refresh)).toBe(false);
        expect(ports.log).toEqual(["present 1"]);
        await runtime.dispose();
    });

    it("reloads again when invalidated during a reload", async () => {
        const ports = pipeline();
        const runtime = new TileRuntime({ id: "again", uri: "memory://tileset.json", adapter: ports.adapter });
        await frame(runtime);
        await runtime.whenIdle();
        const release = ports.hold();
        await runtime.invalidate(() => true);
        await frame(runtime);
        await runtime.invalidate(() => true);
        release();
        await runtime.whenIdle();
        const content = runtime.root!.contents[0]!;
        // The first reload answers the first invalidation only: a second one follows.
        expect(ports.contexts.filter((context) => context.refresh)).toHaveLength(2);
        expect(content.handle?.version).toBe(3);
        expect(content.stale).toBe(false);
        expect(ports.log).toEqual(["present 1", "hide 1", "release 1", "present 2", "hide 2", "release 2", "present 3"]);
        await runtime.dispose();
    });

    it("keeps the presented handle when its reload fails", async () => {
        const ports = pipeline();
        const errors: string[] = [];
        let fail = false;
        const activate = ports.adapter.activation!.activate;
        ports.adapter.activation!.activate = async (context) => {
            if (context.refresh && fail) {
                for (const content of context.pendingContents) await context.readiness.failed(content.id, new Error("offline"));
                return;
            }
            await activate(context);
        };
        const runtime = new TileRuntime({ id: "failure", uri: "memory://tileset.json", adapter: ports.adapter, maxLoadAttempts: 1 });
        runtime.events.subscribe((event) => {
            if (event.type === "error") errors.push(event.phase);
        });
        await frame(runtime);
        await runtime.whenIdle();
        fail = true;
        await runtime.invalidate(() => true);
        await frame(runtime);
        await runtime.whenIdle();
        const content = runtime.root!.contents[0]!;
        expect(errors).toEqual(["content.refresh"]);
        expect(content.handle?.version).toBe(1);
        expect(content.stale).toBe(false);
        expect(ports.presented).toEqual(new Set(["1"]));
        await runtime.dispose();
    });

    it("swaps the contents of a legacy content adapter", async () => {
        const log: string[] = [];
        let version = 0;
        const adapter: IRuntimeAdapter<ICamera, ISpatial, IHandle, never> = {
            tilesets: { load: async () => ({ tileset }) },
            spatial,
            content: {
                load: async (context) => ({ kind: "renderable", handle: { id: context.contentId, version: ++version } }),
                attach: (context) => void log.push(`attach ${context.handle.version}`),
                detach: (context) => void log.push(`detach ${context.handle.version}`),
                dispose: (context) => void log.push(`dispose ${context.handle.version}`),
            },
        };
        const runtime = new TileRuntime({ id: "legacy", uri: "memory://tileset.json", adapter });
        await frame(runtime);
        await runtime.whenIdle();
        await runtime.invalidate(() => true);
        await frame(runtime);
        await runtime.whenIdle();
        expect(log).toEqual(["attach 1", "detach 1", "dispose 1", "attach 2"]);
        expect(runtime.root!.contents[0]!.stale).toBe(false);
        await runtime.dispose();
    });
});
