declare module "opencc-js" {
  export function Converter(opts: { from: string; to: string }): (input: string) => string;
  export function CustomConverter(dict: [string, string][]): (input: string) => string;
}
