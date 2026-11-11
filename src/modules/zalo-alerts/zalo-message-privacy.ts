/** Applied before persistence and again before HTTP, including older pending deliveries. */
export function redactCustomerContacts(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email ẩn]')
    .replace(/(?<!\w)\+?\d(?:[\s().-]*\d){7,14}(?!\w)/g, '[SĐT ẩn]');
}

export function privateZaloText(value: string): string {
  return value
    .split('\n')
    .map((part) => {
      // These lines are generated from validated internal UUIDs, never user content.
      if (
        /^Mã (?:tin|yêu cầu): (?:[0-9a-f-]{36}|[0-9a-f]{64})$/i.test(part) ||
        /^https:\/\/mocmaria\.com\/(?:quan-tri\/lich-hen|tin-nhan(?:\?(?:(?:thread=[0-9a-f-]{36}|inquiry=[0-9a-f]{64})(?:&support=1)?|support=1))?)$/i.test(
          part,
        )
      )
        return part;
      return redactCustomerContacts(part);
    })
    .join('\n');
}
