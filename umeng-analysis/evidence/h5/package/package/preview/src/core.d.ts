export interface ITracker {
    name: string;
    fields: any;
    argsList: [];
    config: any;
}
export declare function getTracker(name?: string): any;
export declare function startup(win: any | Window): any;
