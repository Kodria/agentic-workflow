import { inodeIdentityFragment, isObservableInode } from '../../src/core/fs-identity';

const HIGH_BIT_INO = -9223372036854775716n;
const UNSIGNED_INO = 9223372036854775900n; // equals BigInt.asUintN(64, HIGH_BIT_INO)
const HIGH_BIT_INO_AGAIN = -9223372036854775716n;

describe('fs-identity', () => {
    it('rejects zero inode (RF-1.1, RF-1.3)', () => {
        expect(isObservableInode(0n)).toBe(false);
    });

    it('accepts ordinary positive inodes (RF-1.1)', () => {
        expect(isObservableInode(1n)).toBe(true);
        expect(isObservableInode(8n)).toBe(true);
    });

    it('accepts high-bit inodes that Node surfaces as negative BigInt (RF-1.1, RF-1.5)', () => {
        expect(BigInt.asUintN(64, HIGH_BIT_INO)).toBe(UNSIGNED_INO);
        expect(isObservableInode(HIGH_BIT_INO)).toBe(true);
    });

    it('keeps raw identity fragment distinct from unsigned for high-bit inodes (RF-1.4, RF-1.6)', () => {
        expect(inodeIdentityFragment(HIGH_BIT_INO)).toBe('-9223372036854775716');
        expect(inodeIdentityFragment(HIGH_BIT_INO)).not.toBe(BigInt.asUintN(64, HIGH_BIT_INO).toString());
    });

    it('raw equality matches for identical high-bit values after observability (RF-1.5)', () => {
        expect(isObservableInode(HIGH_BIT_INO)).toBe(true);
        expect(isObservableInode(HIGH_BIT_INO_AGAIN)).toBe(true);
        expect(HIGH_BIT_INO === HIGH_BIT_INO_AGAIN).toBe(true);
    });
});
