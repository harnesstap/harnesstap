declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
  }

  type PicomatchMatcher = (input: string) => boolean;

  export default function picomatch(
    pattern: string,
    options?: PicomatchOptions,
  ): PicomatchMatcher;
}
