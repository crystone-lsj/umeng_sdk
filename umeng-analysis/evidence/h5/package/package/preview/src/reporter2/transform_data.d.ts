/**
 * 发送模块主要功能
 * 1. 限制请求并发
 * 2. 日志编组发送
 * 3. 限制日志成组数量
 * 4. 限制日志成组大小
 * 5. 日志缓冲区管理
 * 6. 零号日志阻塞回调
 * 7. 日志静默与永久限流
 * 8. 日志采集器启动与停用
 * 9. 错误日志聚合
 * 10. 请求qps限制
 */
import { LogData, HeaderLog } from './log_type';
export declare function getHeader(): HeaderLog;
export declare function compressData(data: LogData): string;
export declare function getHeaderString(headerData: any): string;
export declare function compressActions(actions: LogData[]): string;
export declare function filterLogs(log: LogData): any;
export declare function transFormLogQueue(dataQueue: LogData[], maxMergeSize: number, maxMergeLength: number, sendQueue: string[]): void;
export declare function aggregationErrorLogs(log: LogData, logs: LogData[]): boolean;
