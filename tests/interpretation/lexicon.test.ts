import { describe, expect, it } from 'vitest';
import { cashAccountAgreement, headingAgreement, roleAgreement, tokenAgreement } from '../../lib/interpretation/lexicon';

describe('heading and role vocabulary beyond English and Malay', () => {
    it('reads Indonesian statements and ledgers', () => {
        expect(roleAgreement('Bank Nusantara Timur - Rekening Koran \n Nama nasabah \n Saldo awal', 'BANK_STATEMENT')).toBe('AGREES');
        expect(roleAgreement('PT Contoh - Buku Besar \n Akun 1010 Kas', 'GENERAL_LEDGER')).toBe('AGREES');
        expect(headingAgreement('Debet', 'OUT')).toBe('AGREES');
        expect(headingAgreement('Kredit', 'OUT')).toBe('CONTRADICTS');
        expect(headingAgreement('Saldo', 'BALANCE')).toBe('AGREES');
        expect(headingAgreement('Tanggal', 'DATE')).toBe('AGREES');
        expect(cashAccountAgreement('1010 Kas - Rekening Giro')).toBe('AGREES');
        expect(cashAccountAgreement('4000 Pendapatan')).toBe('CONTRADICTS');
    });
    it('reads German statements and ledgers', () => {
        expect(roleAgreement('Tanjung Europa Bank - Kontoauszug \n Kontoinhaber', 'BANK_STATEMENT')).toBe('AGREES');
        expect(roleAgreement('Hauptbuch \n Sachkonto 1200 Bank', 'GENERAL_LEDGER')).toBe('AGREES');
        expect(headingAgreement('Soll', 'DEBIT')).toBe('AGREES');
        expect(headingAgreement('Haben', 'DEBIT')).toBe('CONTRADICTS');
        expect(headingAgreement('Buchungstag', 'DATE')).toBe('AGREES');
        expect(tokenAgreement(['S', 'H'], 'OUT', false)).toBe('CONTRADICTS');
        expect(tokenAgreement(['S'], 'OUT', false)).toBe('AGREES');
        expect(cashAccountAgreement('1800 Bank Darlehen')).toBe('CONTRADICTS');
    });
    it('still refuses to guess: a heading naming both sides, or neither, is opaque', () => {
        expect(headingAgreement('Debet / Kredit', 'OUT')).toBe('OPAQUE');
        expect(headingAgreement('Betrag', 'IN')).toBe('OPAQUE');
        expect(roleAgreement('Rekening Koran dan Buku Besar', 'BANK_STATEMENT')).toBe('OPAQUE');
    });
});
