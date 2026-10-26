export declare enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}
export declare type ILogLevel = LogLevel | undefined;
export declare function setLogLevel(v: ILogLevel): void;
export declare function log(type: LogLevel, ...args: any): void;
export declare function error(...args: any): void;
export declare function warn(...args: any): void;
export declare function info(...args: any): void;
export declare function debug(...args: any): void;
