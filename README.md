# 💳 Payment Checker — Auto Order Checker

Công cụ tự động kiểm tra hệ thống thanh toán của một website bằng cách tự động điền dữ liệu đơn hàng (thẻ fake) vào luồng checkout và báo kết quả **thành công / thất bại**.

Hiện được cấu hình cho một sản phẩm duy nhất: **Razer Gigantus V2 Pro** trên `razer.com`.

## ⚠️ Disclaimer

- **Chỉ dùng dữ liệu giả (test cards).** Không bao giờ nhập thẻ thật — tool có thể đặt đơn hàng thật nếu dùng thẻ hợp lệ.
- Việc tự động hóa checkout có thể **vi phạm điều khoản dịch vụ (ToS)** của website. Chỉ sử dụng trên website của chính bạn hoặc khi bạn được phép.
- Website có thể chặn IP nếu chạy test quá dày đặc (anti-bot). Chạy với tần suất hợp lý và tốt nhất là từ IP dân cư (residential).

## Yêu cầu

- **Node.js 18+**
- **Google Chrome** đã cài trên máy (tool dùng Chrome thật qua `chrome-launcher` để có TLS fingerprint giống người dùng thật)
- Windows (hiện tại launch logic dùng `wmic`/`taskkill`; Linux cần chỉnh `src/checker.js`)

## Cài đặt

```bash
npm install
cp config/order-data.example.json config/order-data.json   # Windows: copy ...
```

Sửa `config/order-data.json` với dữ liệu test của bạn.

## Chạy

```bash
npm start
# mở http://localhost:3456
```

Giao diện web ở `public/`, API ở `/api/*`:
- `POST /api/checkout` — chạy một luồng checkout hoàn chỉnh
- `POST /api/convert` — chuyển đổi dữ liệu thô (dạng `CARD|MM|YY|CVV|NAME|...`) sang cấu hình
- `GET /api/health` — kiểm tra server
- `GET /api/history` — lịch sử kết quả

## Luồng hoạt động

```
Product → Add to Cart → Checkout → Fill Address (gồm mat-select state)
→ Continue → Delivery (Standard Shipping) → Continue → Payment → Submit → Verify
```

## Ghi chú

- Tool dùng **profile Chrome persistent** (`.browser-profile`, đã gitignore) để giữ session ấm — giúp form checkout Angular render đầy đủ.
- Nếu gặp "checkout form không render (Loading...)", IP có thể đang bị flag tạm thời — chờ 5–10 phút rồi thử lại.
