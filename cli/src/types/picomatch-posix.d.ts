declare module 'picomatch/posix' {
    type PicomatchOptions = {
        dot?: boolean;
        posix?: boolean;
        nocase?: boolean;
        windows?: boolean;
        [key: string]: unknown;
    };
    type Matcher = ((str: string) => boolean) & {
        test?: (str: string) => boolean;
    };
    function picomatch(glob: string | string[], options?: PicomatchOptions, returnState?: boolean): Matcher;
    export default picomatch;
}
