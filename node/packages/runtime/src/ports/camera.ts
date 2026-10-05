export interface IRuntimeSubscription {
    unsubscribe(): void;
}

/** Pushes camera placement changes into the runtime. */
export interface ICameraEventSource<TCamera> {
    subscribe(listener: (camera: TCamera) => void): IRuntimeSubscription;
    current?(): TCamera | undefined;
}

/** Preferred name for a renderer camera source producing immutable runtime frames. */
export type ICameraFrameSource<TCameraFrame> = ICameraEventSource<TCameraFrame>;
