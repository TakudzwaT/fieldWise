/** E.164 with a +, or a Malawi number starting 0 (0991234567 -> +265991234567). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  const phone = /^0\d{9}$/.test(digits) ? `+265${digits.slice(1)}` : digits;
  return /^\+\d{8,15}$/.test(phone) ? phone : null;
}
