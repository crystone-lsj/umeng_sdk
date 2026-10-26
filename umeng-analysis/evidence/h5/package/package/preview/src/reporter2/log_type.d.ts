export interface HeaderLog {
    js_ver: string;
    pid: string;
    sid?: string;
    uid?: string;
    puid?: string;
    tag?: string;
    release?: string;
    environment?: string;
    cna?: string;
    [k: string]: any;
}
export interface CommonLog {
    t: string | 'pv' | 'api' | 'error' | 'perf' | 'blank' | 'end';
    page?: string;
    times: number;
    sampling?: number;
    pv_id: string;
    ct?: string;
    sr: string;
    vp: string;
    auto: 'Y' | 'N';
    ctime: number | string;
    cusp?: string;
    [k: string]: any;
}
export interface ErrorLog {
    name?: string;
    msg?: string;
    stack: string;
    file?: string;
    line?: number;
    col?: number;
    [k: string]: any;
}
export interface ApiLog {
    url: string;
    method: 'GET' | 'POST' | 'OPTIONS' | 'HEAD' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT';
    rt: number;
    rc: string | number;
    type: 1 | 2;
    traceid: string;
    req_query: string;
    req_body: string;
    [k: string]: any;
}
export interface StartLog {
    enable_api?: 'Y' | 'N';
    enable_error?: 'Y' | 'N';
    enable_perf?: 'Y' | 'N';
    [k: string]: any;
}
export interface PerfLog {
    enable_api?: 'Y' | 'N';
    enable_error?: 'Y' | 'N';
    enable_perf?: 'Y' | 'N';
    [k: string]: any;
}
export interface LogData {
    common: CommonLog;
    log: StartLog | ErrorLog | ApiLog | BlankLog | EndLog;
}
export interface BlankLog {
    score?: number;
    blank_timeout?: number;
    blank_target?: string;
    blank_domready?: 'Y' | 'N';
    screen_id: string;
    [k: string]: any;
}
export interface EndLog {
    error_count: number;
    page_duration: number;
}
