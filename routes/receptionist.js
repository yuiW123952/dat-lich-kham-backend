const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middlewares/auth');

// Middleware kiểm tra role receptionist
const receptionistAuth = (req, res, next) => {
  if (req.user.role !== 'receptionist' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Không có quyền truy cập' });
  }
  next();
};

// GET /api/receptionist/appointments?date=2026-05-31
// Danh sách lịch hẹn hôm nay
router.get('/appointments', authenticate, receptionistAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(`
      SELECT 
        a.id, a.queue_number, a.status, a.payment_method, a.patient_notes,
        a.checked_in_at,
        p.full_name AS patient_name, p.date_of_birth, p.gender, p.insurance_number,
        u2.full_name AS doctor_name,
        d.name AS department_name,
        s.start_time, s.end_time
      FROM appointments a
      JOIN patient_profiles p ON a.profile_id = p.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN users u2 ON s.doctor_id = u2.id
      JOIN departments d ON s.department_id = d.id
      WHERE DATE(s.work_date) = ?
      ORDER BY a.queue_number ASC
    `, [date]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/receptionist/scan/:appointmentId
// Quét QR lấy thông tin lịch hẹn
router.get('/scan/:appointmentId', authenticate, receptionistAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        a.id, a.queue_number, a.status, a.payment_method, a.patient_notes,
        a.checked_in_at,
        p.full_name AS patient_name, p.date_of_birth, p.gender, p.insurance_number,
        u2.full_name AS doctor_name,
        d.name AS department_name,
        s.work_date, s.start_time, s.end_time, s.price
      FROM appointments a
      JOIN patient_profiles p ON a.profile_id = p.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN users u2 ON s.doctor_id = u2.id
      JOIN departments d ON s.department_id = d.id
      WHERE a.id = ?
    `, [req.params.appointmentId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/receptionist/appointments/:id/confirm
// Xác nhận check-in (sau khi thu tiền)
router.put('/appointments/:id/confirm', authenticate, receptionistAuth, async (req, res) => {
  try {
    const [appt] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (appt.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    if (appt[0].status === 'done' || appt[0].status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Lịch hẹn không thể check-in' });
    }
    await pool.query(
      'UPDATE appointments SET status = "waiting", checked_in_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, message: 'Check-in thành công' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;