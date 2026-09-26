export interface IRuntimeSubscription {
    unsubscribe(): void;
}

/** Pushes camera placement changes into the runtime. */
export interface ICameraEventSource<TCamera> {
    subscribe(listener: (camera: TCamera) => void): IRuntimeSubscription;
    current?(): TCamera | undefined;
}
