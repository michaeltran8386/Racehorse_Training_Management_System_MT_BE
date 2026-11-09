// Luật Họ tên — giống FE (src/shared/lib/name.ts): chỉ chữ cái (kể cả có dấu tiếng Việt) và khoảng trắng.
const NAME_RE = /^[\p{L}\p{M} ]+$/u;
const NAME_MIN = 2;
const NAME_MAX = 100;

// Trả về câu lỗi, hoặc "" nếu hợp lệ.
export function fullNameError(name: string): string {
  const v = name.trim();
  if (!v) return 'Full name is required.';
  if (v.length < NAME_MIN || v.length > NAME_MAX) return 'Full name must be 2 to 100 characters.';
  if (!NAME_RE.test(v)) return 'Full name can only contain letters and spaces.';
  return '';
}
