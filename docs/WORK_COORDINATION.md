# Quy tắc phối hợp Mộc Maria

Nguồn trạng thái: Plan/99_PROJECT_STATUS.txt (đầu file), 13_TASK_LEDGER.json. Checklist [-] nghĩa là đã có một phần; không viết lại module trước khi đọc source.

## Nhận việc

1. Đọc Git status ở cả hai repo, tracker, task và file yêu cầu liên quan.
2. Ghi claim trong Plan/14_ACTIVE_WORK.json: agent, task IDs, branch/worktree, danh sách file/module sẽ sửa, trạng thái ACTIVE. Nếu phạm vi trùng claim ACTIVE hoặc thấy thay đổi không rõ chủ sở hữu, liên hệ chủ việc trước khi sửa. Không tự lấy claim dựa vào giờ hết hạn.
3. Dùng branch codex/ và worktree riêng. Code cùng module cần được chia rõ hoặc một người sở hữu. Worktree tránh ghi đè file, nhưng không tự ngăn conflict khi merge; phải review diff và API contract.
4. Không reset/clean/force push; không stage toàn bộ repo; chỉ commit file của nhóm việc. Không ghi secrets vào tracker/log. Không sửa Giang Xá.

## Tích hợp và migration

- GitHub main FE lấy SHA hiện tại từ 99_PROJECT_STATUS.txt; Desktop FE vẫn d27c1c0 để giữ checkout UI cũ. Code tích hợp nằm C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe. Không coi Desktop cũ là code hiện tại hoặc checkout/reset để đồng bộ.
- BE active checkout C:/Users/User/Desktop/Mộc maria/moc_maria_be, branch codex/production-integration. Không chạy song song writer trên checkout này.
- Một người tích hợp release/migrations tại một thời điểm. Trước push main: fetch, kiểm tra ancestry, review những commit mới; không force. Trước migration: isolated DB tests, backup/rollback và kiểm tra migrations đã chạy.
- Thay đổi DTO/API thêm field bắt buộc phải có kế hoạch deploy BE/FE tương thích. Không để FE đang chạy gửi request bị từ chối vì backend mới.
- Không publish sample price/provider/review/booking lên production. QA fixtures chỉ database cô lập, dọn sau test.

## Bàn giao mỗi chặng

Ghi riêng CODE / TEST / COMMIT / DEPLOY / BUSINESS_DATA. Có code/build PASS không tự có nghĩa DONE. Cập nhật phase checklist + ledger + 99 status + docs/state ở repo. Ghi source SHA, URL, migration và test thực tế. Claim chuyển RELEASED hoặc DONE sau bàn giao; không xóa lịch sử claim.

## Phân chia hiện tại

Codex ở chat này sở hữu BE providers/training/identity liên quan và FE marketplace/auth QA fixes, tracker và release. AI khác có thể nhận phần riêng sau khi ghi claim: SEO metadata/sitemap/OG hoặc nội dung/visual trong worktree riêng; phải giữ API/route contract và tránh app/layout, homepage, marketplace CSS đang có chủ việc. Chưa có claim từ AI khác được xác nhận trong file, không suy ra họ đã dừng làm.
