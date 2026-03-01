export type RtkConfig = {
  enabled: boolean;
  binary: string;
  allIntercept: string[];
  selective: Record<string, string[]>;
  remapped: Record<string, string>;
  skip: string[];
};
