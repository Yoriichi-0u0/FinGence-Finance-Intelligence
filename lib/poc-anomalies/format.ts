/** Display form of an exact decimal string with thousands separators; digits are never rounded. */
export function groupDigits(value: string) {
    const [whole, fraction] = value.replace('-', '').split('.');
    return `${value.startsWith('-') ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : '.' + fraction}`;
}
