export declare type matchRule = string | RegExp | Function;
export declare type matchRules = matchRule[];
export declare type RuleMode = 'match' | 'ignore';
export interface IFilter {
    mode: RuleMode;
    rules: matchRule | matchRules;
}
export declare function getPageFilter(): IFilter;
export declare function setPageFilter(f: IFilter): void;
export declare function filterData(href: string): any;
