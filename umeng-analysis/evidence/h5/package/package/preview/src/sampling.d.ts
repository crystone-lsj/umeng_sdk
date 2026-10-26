export declare function setSample(s: number): void;
export declare function getSample(): number;
export declare function setSendStatus(v: string): void;
export declare function verifySend(): boolean | undefined;
export declare function initSamplingRate(cb: any): false | undefined;
export declare function reSampling(sampling: number): boolean;
export declare function getSampling(): {
    api: number;
    pv: number;
    error: number;
    perf: number;
    perf_fcp: number;
    perf_fid: number;
    blank: number;
};
export declare type YN = 'Y' | 'N';
export interface YN_MAP {
    api: YN;
    error: YN;
    pv: YN;
    perf: YN;
    blank: YN;
}
export declare function getYN(): YN_MAP;
export declare function setIsSampling2YNDone(b: boolean): void;
export declare function getConfigItem(actions: any, key: string): any;
export declare function sampling2YN(): void;
