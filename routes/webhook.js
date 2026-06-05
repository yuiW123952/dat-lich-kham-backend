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

    // Tìm mã XN-{appointmentId} trong nội dung chuyển khoản
    const match = content.match(/XN-(\d+)/i);
    if (!match) {
      console.log('⚠️ Không tìm thấy mã XN trong nội dung:', content);
      return res.json({ success: false, message: 'Không khớp mã xét nghiệm' });
    }

    const appointmentId = parseInt(match[1]);
    console.log(`✅ Khớp appointment_id=${appointmentId}, số tiền=${transferAmount}`);

    // Update tất cả test_orders pending của appointment này
    const [result] = await db.query(`
      UPDATE test_orders
      SET status='paid', payment_method='vietqr', paid_at=NOW()
      WHERE appointment_id=? AND status='pending'
    `, [appointmentId]);

    console.log(`✅ Đã update ${result.affectedRows} xét nghiệm sang paid`);
    res.json({ success: true });

  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

module.exports = router;
