export declare function testRule(page: string, rule: any, d: any): any;
export declare function testRules(page: string, rules: any, d: any): any;
export declare type matchRule = string | RegExp | Function;
export declare type matchRules = matchRule[];
export interface IFilter {
    mode: 'match' | 'ignore';
    rules: matchRule | matchRules;
}
export declare function getPageFilter(): IFilter;
export declare function setPageFilter(f: IFilter): void;
export declare function filterData(fields: string, filter: IFilter, d: any): any;
export declare function setApiFilter(f: IFilter): void;
export declare function getApiFilter(): IFilter;
export declare function setErrorFilter(f: IFilter): void;
export declare function getErrorFilter(): IFilter;
export declare function pageFilter(str: string, d: any): any;
export declare function apiFilter(str: string, d: any): any;
export declare function errorFilter(str: string, d: any): any;
