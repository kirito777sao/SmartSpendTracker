# T-S07 — Danh sách file đã sửa/thêm mới

## File MỚI
| File | Nội dung |
|---|---|
| `src/context/ToastContext.tsx` | Hệ thống toast toàn cục (viết từ đầu, không cài thêm lib) — dùng cho "Hoàn tác" khi xoá giao dịch. |
| `check_list_tests/checklist-T-S07.md` | Checklist test tay (8 mục A–H). |

## File ĐÃ SỬA
| File | Đổi gì |
|---|---|
| `src/hooks/useTransactions.ts` | Thêm `onMutate`/`onError` optimistic cho `useCreateTransaction` + `useSoftDeleteTransaction`. |
| `src/main.tsx` | Nối `<ToastProvider>` vào root. |
| `src/components/TransactionHistory.tsx` | `handleDeleteOne`/`handleBulkDelete` dùng toast + nút Hoàn tác thay `alert()` cũ. |
| `TASKS.md` | T-S07: ⚪→🟡 (code xong, chờ verify). |
| `CHANGELOG.md` | Entry mới "T-S07 — code xong, chờ verify". |

**Không có migration mới** — RPC `restore_transaction` đã có sẵn từ trước
(0004/0006), chỉ chưa được UI dùng tới.

Test theo `check_list_tests/checklist-T-S07.md`, báo lại kết quả để đóng
task và tiếp tục T-S12.
