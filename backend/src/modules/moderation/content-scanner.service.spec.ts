import { ContentScannerService } from './content-scanner.service';

describe('ContentScannerService', () => {
  const s = new ContentScannerService();

  it('redact PAN valide (Luhn)', () => {
    const r = s.scan('Voici ma carte 4242 4242 4242 4242 pour la commande');
    expect(r.flags).toContain('pan');
    expect(r.cleaned).toContain('[REDACTED_PAN]');
    expect(r.cleaned).not.toMatch(/4242 4242/);
  });

  it('ne redact pas une suite de chiffres non-Luhn', () => {
    const r = s.scan('Ma référence est 1234567890123');
    expect(r.flags).not.toContain('pan');
  });

  it('redact IBAN FR', () => {
    const r = s.scan('IBAN FR7630006000011234567890189 merci');
    expect(r.flags).toContain('iban');
    expect(r.cleaned).toContain('[REDACTED_IBAN]');
  });

  it('redact CVV en contexte', () => {
    const r = s.scan('cvv: 123');
    expect(r.flags).toContain('cvv');
  });

  it('redact email + téléphone', () => {
    const r = s.scan('Contacte-moi sur john.doe@example.com ou 06 12 34 56 78');
    expect(r.flags).toContain('email');
    expect(r.flags).toContain('phone');
  });

  it('score augmente avec le nombre de flags', () => {
    const r1 = s.scan('email me at a@b.com');
    const r2 = s.scan('email a@b.com cvv: 999 IBAN FR7630006000011234567890189');
    expect(r2.score).toBeGreaterThan(r1.score);
  });

  it('texte propre = pas de flags', () => {
    const r = s.scan('Bonjour, où est ma commande ?');
    expect(r.hadSensitive).toBe(false);
    expect(r.cleaned).toBe('Bonjour, où est ma commande ?');
  });
});
