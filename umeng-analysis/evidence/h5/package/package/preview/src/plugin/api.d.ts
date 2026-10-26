export declare function hackXHR(): void;
export declare function hackFetch(): void;
interface Args {
    url: string;
    method: number;
    rt: number;
    rc: number;
    traceid?: string;
    req_query?: string;
    req_body?: string;
}
export declare function sendAPILog(args: Args): void;
export {};
