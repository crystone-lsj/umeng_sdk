export declare function setMaxGetSize(v: number): void;
export declare function getMaxGetSize(): number;
/**
 *
 * @returns 获取数据发送地址
 */
export declare function getSenderUrl(type: string): string;
export declare function sendBeaconPing(data: any, header: any): boolean;
export declare function supportSendBeacon(): false | {
    new (blobParts?: BlobPart[] | undefined, options?: BlobPropertyBag | undefined): Blob;
    prototype: Blob;
};
export declare function request(data: string): void;
interface ReqOpt {
    method?: string;
    url: string;
    data?: any;
    success?: Function;
    error?: Function;
}
export declare function ajax(option: ReqOpt): void;
export declare function imagePing(data: any, callback: any): void;
export declare function readSilent(): void;
export {};
