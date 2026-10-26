import { IFilter } from './filter';
import { LogLevel } from './debug';
export interface initParams {
    sample?: number;
    logLevel?: LogLevel | undefined;
    pid: string;
    uid?: string;
    puid?: string;
    tag?: string;
    environment?: string;
    release?: string;
    dsn?: string;
    pkgList?: string | string[];
    pageFilter?: IFilter;
    errorFilter?: IFilter;
    apiFilter?: IFilter;
    hookFetch?: boolean;
    hookXHR?: boolean;
    traceKey?: string;
    enableNetWorkType?: boolean;
    enableCatchJSError?: boolean;
    enablePerformance?: boolean;
    enableJSBridge?: boolean;
    enableFID?: boolean;
    enableRemoteConfig?: boolean;
    enableBlankScreen?: boolean;
    sampleConfig?: {
        enable: boolean;
        sampleRate: number;
        rules?: Record<string, EventSampleRule>;
    };
    blankConfig: {
        blank_target: string;
        blank_timeout: number;
        screenshot?: boolean;
        X: number;
        Y: number;
    };
    xhrConfig: {
        enableReqBody: boolean;
    };
    fetchConfig: {
        enableReqBody: boolean;
    };
    enableCrypt?: boolean;
    enableScreenCrypt?: boolean;
    data2Encrypt?: Function;
    data2Decrypt?: Function;
}
export interface UserConfig {
    puid?: string;
    tag?: string;
    environment?: string;
    release?: string;
}
interface EventSampleRule {
    enable: boolean;
    sampleRate: number;
}
export declare function getConfig(): initParams;
export declare function setUserConfig(cfg: UserConfig): void;
export declare function setConfig(config: initParams | any): initParams;
export {};
