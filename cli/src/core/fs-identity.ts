/** Node bigint stats encode uint64 inodes as signed; observable iff unsigned 64-bit ≠ 0. */
export function isObservableInode(ino: bigint): boolean {
    return BigInt.asUintN(64, ino) !== 0n;
}

/** Raw Node bigint encoding for identity strings/digests — never asUintN. */
export function inodeIdentityFragment(ino: bigint): string {
    return ino.toString();
}
