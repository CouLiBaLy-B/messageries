import { Injectable } from '@nestjs/common';

export interface ScanResult {
  cleaned: string;          // texte avec valeurs sensibles remplacées par [REDACTED]
  flags: string[];          // ex: ['pan','iban','phone','email']
  score: number;            // 0..1 (heuristique)
  hadSensitive: boolean;
}

/**
 * Scanner heuristique :
 *  - PAN (13–19 digits + Luhn)
 *  - IBAN (FR/EU)
 *  - CVV à 3-4 chiffres uniquement si contexte "cvv/cvc"
 *  - emails, téléphones (anti-désintermédiation marketplace)
 * Tout détecté est masqué côté serveur AVANT chiffrement.
 */
@Injectable()
export class ContentScannerService {
  scan(input: string): ScanResult {
    let cleaned = input;
    const flags = new Set<string>();

    // --- PAN (carte) ---
    cleaned = cleaned.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return m;
      if (this.luhn(digits)) {
        flags.add('pan');
        return '[REDACTED_PAN]';
      }
      return m;
    });

    // --- IBAN (jusqu'à 34 caractères, commence par 2 lettres + 2 chiffres) ---
    cleaned = cleaned.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, () => {
      flags.add('iban');
      return '[REDACTED_IBAN]';
    });

    // --- CVV en contexte ---
    cleaned = cleaned.replace(/\b(cvv|cvc|cv2)\s*[:=]?\s*(\d{3,4})\b/gi, () => {
      flags.add('cvv');
      return '[REDACTED_CVV]';
    });

    // --- Email ---
    cleaned = cleaned.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => {
      flags.add('email');
      return '[REDACTED_EMAIL]';
    });

    // --- Téléphone (heuristique large : 8–15 digits avec séparateurs) ---
    cleaned = cleaned.replace(
      /\b(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?){2,5}\d{2,4}\b/g,
      (m) => {
        const digits = m.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) {
          flags.add('phone');
          return '[REDACTED_PHONE]';
        }
        return m;
      },
    );

    const arr = Array.from(flags);
    const score = Math.min(1, arr.length * 0.3);
    return { cleaned, flags: arr, score, hadSensitive: arr.length > 0 };
  }

  private luhn(num: string): boolean {
    let sum = 0;
    let alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = parseInt(num[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }
}
