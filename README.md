# GPA FPT

Extension cho Chrome / Edge / Cốc Cốc / Brave (Manifest V3). Extension tính GPA từ trang
[Báo cáo điểm FAP](https://fap.fpt.edu.vn/Report/Transcript) và cho bạn tự chọn môn nào được tính.

## Tính năng

- **Trên trang FAP**: thêm cột **Tính GPA** (checkbox) vào bảng điểm và một khung GPA nổi ở góc phải.
  Môn bị bỏ chọn sẽ mờ đi, GPA cập nhật ngay khi tick.
- **Popup** (bấm icon extension): dùng được ở bất kỳ tab nào, vì dữ liệu được lưu sau lần mở trang FAP gần nhất.
  - Danh sách môn chia theo kỳ, có GPA từng kỳ và checkbox chọn cả kỳ.
  - Ô điểm sửa được để **tính thử điểm dự kiến**. Điểm dự kiến có viền cam; xoá ô thì trở về điểm trên FAP.
  - **Thêm môn thủ công**, không cần có trên FAP.
  - Tìm môn, các nút *Mặc định* / *Chọn môn có điểm* / *Bỏ chọn hết*.
  - Cài đặt danh sách tiền tố mã môn không tính GPA và tuỳ chọn tính cả môn *Not passed*.
- GPA hệ 10 (trung bình có trọng số theo tín chỉ) và hệ 4 quy đổi theo thang chữ A/B+/B/C+/C/D+/D/F
  (chỉ để tham khảo).

### Quy tắc chọn mặc định

Một môn được tính mặc định khi thoả hết các điều kiện sau:

- nằm trong bảng chương trình đào tạo, không thuộc bảng *Subjects outside the curriculum*;
- có số tín chỉ lớn hơn 0 và có điểm;
- trạng thái là `Passed`;
- mã môn không bắt đầu bằng `ENT`, `TRS`, `GDQP`, `VOV`, `TMI`, `OTP`. Đây là tiếng Anh dự bị, GDQP, Vovinam,
  nhạc cụ truyền thống và định hướng; danh sách này sửa được trong phần Cài đặt.

Môn bạn đã nhập điểm dự kiến cũng được tính mặc định. Mọi lựa chọn tick/bỏ tick của bạn đều được ưu tiên hơn
quy tắc trên và vẫn giữ nguyên khi bảng điểm được đồng bộ lại.

## Cài đặt (chế độ developer)

1. Mở `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode**.
3. Bấm **Load unpacked** rồi chọn thư mục này (thư mục có `manifest.json`).
4. Đăng nhập FAP, mở trang **Báo cáo điểm** (`/Report/Transcript`). Extension sẽ tự đọc bảng điểm.

Sau khi sửa code, bấm nút reload của extension trong `chrome://extensions`, rồi tải lại trang FAP.

## Cấu trúc

```
manifest.json
src/lib/gpa.js              # logic thuần: đọc cột, quy tắc chọn môn, tính GPA (có test)
src/lib/store.js            # lưu dữ liệu vào chrome.storage.local
src/content/transcript.js   # chạy trên trang FAP: đọc bảng, chèn checkbox + khung GPA
src/content/transcript.css
src/popup/                  # giao diện popup
test/gpa.test.js
```

Extension tìm cột theo tên tiêu đề (`Subject code`, `Credits`, `Grade`, `Status`…, hoặc tên tiếng Việt), không theo
vị trí cột. Nhờ vậy FAP có đổi thứ tự cột thì extension vẫn chạy. Dữ liệu chỉ lưu trong trình duyệt của bạn
(`chrome.storage.local`) và không gửi đi đâu.

## Test

```sh
npm test
```
