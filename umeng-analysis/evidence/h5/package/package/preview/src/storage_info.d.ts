export declare function getStorageKey(pid: string): string;
export declare function getStoreInfo(pid: string): string | null | undefined;
interface IStoreInfo {
    pid: string;
    uid: string;
}
export declare function saveStoreInfo(config: IStoreInfo): void;
export declare function getRemoteConfigFromStore(pid: string): {};
export declare function removeRemoteConfigFromStore(pid: string): void;
interface CFG {
    pid: string;
    sampleConfig: any;
}
export declare function saveRemoteConfigToStore(config: CFG): void;
export declare function getSilentInfo(pid: string): {};
interface SilentInfo {
    pid?: string;
    block: number;
}
export declare function saveSilentInfo(s: SilentInfo): void;
export {};
