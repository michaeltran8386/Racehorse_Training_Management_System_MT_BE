# EquiFlow — hướng dẫn dùng AI sau bàn giao

Hướng dẫn chung cho AGY, Codex và Claude khi cùng làm việc trong workspace EquiFlow. Đây là tài liệu workflow, không phải approval, START, task mới hay quyền deploy. `AGENTS.md`, plan được duyệt và lệnh trực tiếp của Human vẫn quyết định quyền thực thi. Không đóng băng trạng thái dự án trong prompt; luôn đọc `STATE.md` hiện tại.

## Prompt mở chat mới — sao chép nguyên khối

```text
Bạn đang hỗ trợ dự án EquiFlow cho một người dùng phổ thông.
Workspace: E:\01_Academic_FPT\Courses\Se_5_Active\SWP391\MINH_Racehorse_Branch

Đọc AGENTS.md tại root và hướng dẫn canonical:
Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/MAINTENANCE.md
Sau đó đọc các workflow/report liên quan và kiểm tra Git cả ba repo.
Nếu có skill human-gated-task, áp dụng; nếu không có cơ chế skill,
đọc trực tiếp .agents/skills/human-gated-task/SKILL.md.

Tự xác định trạng thái và quyền hiện có; đừng dựa vào lịch sử chat khác.
Tôi sẽ mô tả lỗi hoặc nhu cầu bằng lời thông thường.
Bạn tự phân tích, đề xuất phạm vi và đưa sẵn lệnh tiếp theo để tôi xác nhận.
Chỉ hỏi thông tin thật sự thiếu sau khi đã kiểm tra repository.
Prompt này không phải START, approval hay quyền commit/push/deploy.
Chưa sửa application code hoặc chạy task cho đến khi đủ gate.

Nhu cầu của tôi: [viết lỗi hoặc việc muốn làm ở đây]
```

Không cần upload lại toàn bộ lịch sử chat nếu AI đọc được workspace. Nếu AI không truy cập được file, phải nói rõ và yêu cầu đúng phần tài liệu cần đọc; không tự tuyên bố đã kiểm tra repository. Prompt này có thể dán vào ba công cụ; không giả định cả ba tự nhận diện hoặc tự cài skill.

Nếu clone khác không có `.agents/skills/human-gated-task/SKILL.md`, đọc hướng dẫn này cùng `AGENTS.md` thay thế; thiếu cơ chế skill không cấp thêm quyền và không bắt buộc cài plugin. Root `AGENTS.md` và skill local nằm ngoài ba repository con, nên không mặc định có mặt khi member chỉ pull BE/FE/SIM. Hướng dẫn canonical chỉ đến máy khác sau khi được commit/push đúng quyền; các file hướng dẫn mới không tự thuộc manifest commit TASK-019 đã duyệt.

## Người dùng chỉ cần làm gì?

Bạn mô tả vấn đề, xem bản đề xuất ngắn, gửi lệnh AI chuẩn bị sẵn, rồi kiểm tra kết quả khi AI dừng ở Human QA. AI tự lo việc tra số task/CR, tìm file, đọc diff, kiểm tra ảnh hưởng, chạy lệnh kỹ thuật đã được phép và cập nhật tài liệu. Bạn không phải tự nhớ số task, tự viết lệnh Git hoặc tự chạy mọi bộ test.

| Bạn muốn | AI phải làm trước | Gate tiếp theo |
| --- | --- | --- |
| “Check giúp”, hỏi trạng thái hoặc cách dùng | Đọc trạng thái, source/evidence liên quan; trả lời và nêu giới hạn | Không tự START hay sửa code |
| Báo lỗi hoặc muốn thêm/sửa chức năng | Chẩn đoán, tìm root cause; planner soạn task/scope và CR nếu cần đổi plan/nghiệp vụ/kiến trúc | Human duyệt đề xuất, rồi START riêng |
| Sửa tiếp task đang bị từ chối | Xác minh REJECT và phạm vi task hiện tại | Sửa/retest cùng task, dừng AWAITING_USER_QA |
| Xem kết quả để nghiệm thu | Review code, evidence, rủi ro và hướng dẫn thao tác UI | Human APPROVE hoặc REJECT task |
| Commit, đưa lên Git hoặc tạo PR | Chuẩn bị manifest, branch/base, diff và thứ tự PR theo repo | Quyền commit và push/tạo PR đúng phạm vi; Human tự merge |
| Deploy | Chốt target, cấu hình, DB/migration, backup/rollback và smoke checks cần thiết | Quyền deploy riêng; không suy từ task DONE |

## AI phải đọc nguồn nào?

Canonical là `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/`. Trước kết luận/cập nhật, đọc `AGENTS.md`, kiểm tra Git cả BE/FE/SIM và đọc `README.md`, `STATE.md`, `PLAN.md`, `TASKS.md`, `HANDOFF.md`, `DECISIONS.md`, `CHANGES.md`, `APPROVALS.md`, `PROGRESS.md` cùng report liên quan. Có thể đọc phần hiện hành trước rồi tra các mục liên quan; không liên tục nạp lại toàn bộ lịch sử khi đã đọc và không có thay đổi.

- Backend: `Racehorse_Training_Management_System_MT_BE`.
- Frontend: `Racehorse_Training_Management_System_MT_FE`.
- Simulator canonical: `Racehorse_Simulator_Web`; `_v3` là tham khảo, không tự chuyển runtime sang đó.
- Root `docs/ai-workflow/` là NON-CANONICAL mirror; không cấp quyền và không được ghi ngược đè canonical.

Source/diff, lệnh Human và bằng chứng thực tế phải được đối chiếu. Một dòng “PASS” trong report không thay thế log/artifact hoặc source khi chúng mâu thuẫn. Không tự chế approval; ghi nguyên văn lệnh và ngữ cảnh rõ ràng. Không làm đồng thời bằng nhiều executor hoặc ghi đè thay đổi chưa commit.

## Vòng làm việc chính thức

1. **Chẩn đoán và lập phạm vi.** Nêu ngắn vấn đề, cách sửa, repo/file dự kiến, ảnh hưởng dữ liệu và test cần chạy. Dùng ID chưa tồn tại sau khi tra ledger; không đoán rằng số sau TASK-019 là TASK-020 vì có thể đã được dùng. Task DONE giữ nguyên lịch sử; sửa mới dùng task mới. Không tự bump approved plan để hợp thức hóa việc đã làm.
2. **Human duyệt rồi START.** AI đưa lệnh đúng ID đã soạn, ví dụ `APPROVE CR-NNN` rồi `START TASK-NNN`. Với Codex/Claude thay AGY, Human chỉ định rõ executor, ví dụ `START TASK-NNN CODEX` hoặc `START TASK-NNN CLAUDE`, và ghi nhận ngoại lệ. Các chữ NNN chỉ là placeholder; không được thực thi. Một mẫu lệnh trong file/report không phải lệnh Human mới. Không yêu cầu lại quyền đã được Human cấp hợp lệ trong cùng phạm vi/phiên thực thi.
3. **Thực hiện một task.** `STATE.md` phải chỉ đúng next task, plan/scope đã được duyệt và không có executor khác đang làm. Sửa đúng nguyên nhân; kiểm tra caller FE, controller/DTO BE, Socket.IO SIM và persistence khi liên quan. Không mở task kế tiếp hoặc thêm feature thuận tiện ngoài scope. Nếu vượt scope, gom các defect đã có bằng chứng thành CR cụ thể, dừng trước sửa ngoài scope.
4. **Kiểm thử phù hợp rồi bàn giao.** AI tự chạy kiểm tra được phép, cập nhật report và cho Human vài bước QA thực tế. Set `AWAITING_USER_QA`, STOP. Test PASS không tự thành approval. Human `APPROVE TASK-NNN` thì DONE/IDLE và STOP; `REJECT TASK-NNN: lý do` chỉ cho phép sửa/retest cùng task.
5. **Git và triển khai tách quyền.** AI chuẩn bị nội dung review được trước khi xin quyền hành động ra remote hoặc production. `AUTHORIZE COMMIT TASK-NNN` chỉ cho commit đúng manifest; không mặc định có push/PR. AI đưa lệnh riêng rõ phạm vi nếu cần, ví dụ `AUTHORIZE PUSH AND CREATE PR TASK-NNN`. Merge vẫn do Human thực hiện trừ khi có quyền khác trực tiếp. Deploy và thao tác DB rủi ro cần quyền riêng với target xác định.

Nếu Human nói bằng lời thường mà ý định chưa rõ, hỏi một câu ngắn hoặc đưa lệnh cụ thể để xác nhận; không tự hiểu “check” là “approve”, “authorize” là “deploy”, hoặc “đã chạy ổn” là cho phép mở rộng scope. Khi approval rõ ràng trong ngữ cảnh, ghi nguyên văn, không ép sửa chính tả hay tự thay bằng một lệnh chưa từng được gửi.

## Kiểm thử vừa đủ, không lặp vô ích

- Sửa bug có logic: thêm/chạy regression tập trung, sửa root cause và chạy lại phần bị ảnh hưởng. Thay đổi API/DTO/event phải kiểm caller tương ứng. Thay đổi giao diện cần browser QA thích hợp; API-only không chứng minh nút/form/canvas đã hoạt động.
- Runtime, browser, integration và acceptance dùng NestJS/PostgreSQL thật, không fallback mock. Mock/fake chỉ trong isolated unit tests. Không hạ guard, xóa assertion, bỏ qua test hoặc chuyển UI sang mock để có màu xanh.
- Trước test có ghi DB, xác minh datasource đúng target được duyệt, tạo fixture riêng, giữ exact IDs và cleanup cả khi lỗi. Không xóa theo điều kiện rộng, reset/reseed baseline, sửa DB gốc hoặc in URL/password/token. Không để cleanup nuốt lỗi.
- Tái sử dụng evidence còn hợp lệ cho phần không đổi. Không chạy full BE/FE/SIM sau mỗi sửa tài liệu hay helper. Mở rộng test khi plan yêu cầu hoặc thay đổi/failure cho thấy cần thiết; focused checks trước, regression rộng sau.
- Nếu full run fail, chẩn đoán nguyên nhân, chạy lại nhóm ảnh hưởng và các ca bị serial-skip. Ghi cả full run lẫn follow-up; không ghi thành một full run mới xanh. Nếu plan đòi fresh full run mà chưa chạy, nêu phần thiếu, không tự miễn trừ.
- Report ghi command/config, revision, exit code, PASS/FAIL/SKIP, artifact, dữ liệu đã tác động/cleanup và phần chưa chạy. Phân biệt static review, mock-based tests và real-stack. Không đổi task thành DONE chỉ vì test đạt.
- Gom findings thành một lượt review: ưu tiên lỗi nghiệp vụ, mất/rò dữ liệu và sai API. Lỗi diễn đạt trong report được sửa bằng tài liệu, không biến thành một vòng chạy toàn bộ test.

## Sau khi task được duyệt

Không tự mở lại task DONE. Với bug mới, AI tạo đề xuất mới và chỉ ra quyền đang cần; việc đọc source, điều tra read-only và soạn tài liệu planner không phải START application task. Giữ các approval cũ và không sửa lại migration đã áp dụng để che lỗi.

Trước commit/PR, kiểm tra staged manifest, diff, base branch và phụ thuộc giữa repo. Dùng commit/PR riêng cho các repo có thay đổi; không commit repo chỉ có file local ngoài scope. Không stage `.env`, token/auth state, DB data, build/test artifacts hoặc file cá nhân. Không tạo lại lịch sử task PR một cách máy móc nếu các commit đã phụ thuộc nhau; chuẩn bị cách tách/merge để Human review trước các thao tác có rủi ro.

Nói rõ các mốc: **đã sửa → đã test → Human approve → commit → push/PR → merge → deploy**. Chúng khác nhau. Member chỉ pull được thay đổi từ remote/branch đã được đẩy lên; “commit local” chưa làm máy người khác cập nhật.

“Đủ QA chức năng” không có nghĩa “đã sẵn sàng production”: cần cấu hình public API/Socket.IO, domain/HTTPS, secrets/email, database/migration đúng target và smoke test trên môi trường triển khai. Không tự viết thêm hạ tầng hoặc deploy chỉ vì đang review readiness.

## Kết thúc mỗi lượt

Trả lời ngắn bằng tiếng Việt: đã làm gì, bằng chứng chính, trạng thái hiện tại, phần chưa kiểm/rủi ro và đúng một hành động tiếp theo nếu cần. Không bắt người dùng phổ thông tự phân tích log dài; không hứa “không còn lỗi” chỉ từ test PASS. Tài liệu/skill này không cấp quyền kỹ thuật mới và không tự tạo một task bảo trì.
