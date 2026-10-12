export function ticketLabel(number: number) {
  return `TM-${String(number).padStart(3, "0")}`;
}

export function nextTicketNumber(numbers: number[]) {
  return numbers.reduce((max, value) => Math.max(max, value), 0) + 1;
}
