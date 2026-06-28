const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

const SEPAY_API_KEY = 'sepay-secret-hcmute-2025';

// POST /api/webhook/sepay
router.post('/sepay', async (req, res) => {
  try {
    // Xác thực API Key
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Apikey ${SEPAY_API_KEY}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { content, transferAmount } = req.body;
    console.log('📥 Sepay webhook:', JSON.stringify(req.body));

    if (!content) return res.json({ success: false, message: 'Thiếu nội dung' });

    // Tìm mã XN-{id} cho xét nghiệm hoặc DL-{id} cho đặt lịch
    const xnMatch = content.match(/XN-(\d+)/i);
    const dlMatch = content.match(/DL-(\d+)/i);

    if (xnMatch) {
      const appointmentId = parseInt(xnMatch[1]);
      console.log(`✅ Xét nghiệm appointment_id=${appointmentId}`);
      await db.query(`
        UPDATE test_orders SET status='paid', payment_method='vietqr', paid_at=NOW()
        WHERE appointment_id=? AND status='pending'
      `, [appointmentId]);
    } else if (dlMatch) {
      const appointmentId = parseInt(dlMatch[1]);
      console.log(`✅ Đặt lịch appointment_id=${appointmentId}`);
      // Chỉ xác nhận đã thanh toán — KHÔNG tự động check-in.
      // Bệnh nhân vẫn phải đưa mã QR cho lễ tân quét tại quầy để check-in,
      // dù đã chuyển khoản online hay chưa.
      await db.query(`
        UPDATE appointments SET payment_status='paid'
        WHERE id=? AND payment_status!='paid'
      `, [appointmentId]);
    } else {
      console.log('⚠️ Không tìm thấy mã hợp lệ trong nội dung:', content);
      return res.json({ success: false, message: 'Không khớp mã' });
    }
    res.json({ success: true });

  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

module.exports = router;
