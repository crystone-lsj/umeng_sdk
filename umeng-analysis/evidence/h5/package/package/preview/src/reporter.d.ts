export interface Action {
    type: string;
    payload?: any;
}
export declare function sendData(action: Action, immediate?: boolean | undefined): void;
export declare function clearQueue(): void;
export declare function dataPack(action: any): Action;
