export type FetchRequestOptions = RequestInit & {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  path: string;
  method: string;
  search: string;
  headers: Record<string, string>;
  timeout: number;
};
export type ModifyRequestFunction = (options: FetchRequestOptions) => void;
