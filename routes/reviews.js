// ── reviews.js ──────────────────────────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const auth     = require('../middleware/auth');

router.use(auth);

router.post('/', async (req, res) => {
  const { appointment_id, rating, comment } = req.body;
  try {
    // Kiểm tra đã đánh giá chưa
    const [ex] = await db.query('SELECT id FROM reviews WHERE appointment_id=?', [appointment_id]);
    if (ex.length) return res.json({ success: false, message: 'Bạn đã đánh giá lịch khám này rồi' });

    // Tự lấy doctor_id từ appointment → schedule → doctor
    const [[appt]] = await db.query(
      'SELECT s.doctor_id FROM appointments a JOIN schedules s ON a.schedule_id = s.id WHERE a.id = ?',
      [appointment_id]
    );
    if (!appt) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });

    await db.query(
      'INSERT INTO reviews (appointment_id, doctor_id, rating, comment) VALUES (?,?,?,?)',
      [appointment_id, appt.doctor_id, rating, comment]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;
