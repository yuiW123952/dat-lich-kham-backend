const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const auth    = require('../middleware/auth');
const { requireRole } = auth;
const { sendPush } = require('../helpers/push');

router.use(auth, requireRole('doctor'));

// GET /api/doctor/me
router.get('/me', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.id AS doctor_id, u.full_name, u.phone,
             dep.name AS department_name, dep.id AS department_id, d.specialty, d.bio
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dep ON d.department_id = dep.id
      WHERE d.user_id = ?`, [req.user.id]);
    if (!rows.length) return res.json({ success: false, message: 'Không tìm thấy thông tin bác sĩ' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/queue?date=YYYY-MM-DD
// Chỉ hiện lịch đã thanh toán (payment_status = 'paid')
// Sort: in_progress → waiting → absent
router.get('/queue', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [doc] = await db.query('SELECT id FROM doctors WHERE user_id=?', [req.user.id]);
    if (!doc.length) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    const doctor_id = doc[0].id;

    const [rows] = await db.query(`
      SELECT a.id, a.queue_number, a.status, a.patient_notes, a.profile_id,
             a.payment_status, a.service_type,
             pp.full_name AS patient_name, pp.date_of_birth, pp.gender, pp.insurance_number,
             s.id AS schedule_id, s.date, s.start_time, s.end_time, s.current_queue,
             dep.name AS department_name,
             mr.id AS record_id, mr.diagnosis
      FROM appointments a
      JOIN schedules s ON a.schedule_id = s.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN departments dep ON s.department_id = dep.id
      LEFT JOIN medical_records mr ON mr.appointment_id = a.id
      WHERE s.doctor_id = ? AND s.date = ?
        AND a.status != 'cancelled'
        AND a.payment_status = 'paid'
      ORDER BY
        CASE a.status
          WHEN 'in_progress' THEN 1
          WHEN 'waiting' THEN 2
          WHEN 'absent' THEN 3
          WHEN 'done' THEN 4
          ELSE 5
        END,
        a.queue_number`, [doctor_id, date]);

    const [sch] = await db.query('SELECT current_queue FROM schedules WHERE doctor_id=? AND date=? LIMIT 1', [doctor_id, date]);
    const current_queue = sch.length ? sch[0].current_queue : 0;

    res.json({ success: true, data: rows, current_queue });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/doctor/appointments/:id/call
router.put('/appointments/:id/call', async (req, res) => {
  try {
    const [appts] = await db.query(`
      SELECT a.*, pp.full_name AS patient_name, s.id AS schedule_id,
             u_pat.expo_push_token
      FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN users u_pat ON pp.user_id = u_pat.id
      WHERE a.id = ?`, [req.params.id]);
    if (!appts.length) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    const appt = appts[0];

    await db.query(`UPDATE appointments SET status='in_progress' WHERE id=?`, [appt.id]);
    await db.query(`UPDATE schedules SET current_queue=? WHERE id=?`, [appt.queue_number, appt.schedule_id]);

    await sendPush(
      appt.expo_push_token,
      '🔔 Đến lượt của bạn!',
      `Số thứ tự #${appt.queue_number} - ${appt.patient_name}, vui lòng vào phòng khám!`,
      { appointmentId: appt.id }
    );

    res.json({ success: true, message: `Đã gọi số ${appt.queue_number}` });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/doctor/appointments/:id/absent - bệnh nhân chưa vào
router.put('/appointments/:id/absent', async (req, res) => {
  try {
    await db.query(`UPDATE appointments SET status='absent' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/doctor/appointments/:id/done
router.put('/appointments/:id/done', async (req, res) => {
  try {
    await db.query(`UPDATE appointments SET status='done' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// POST /api/doctor/appointments/:id/record
router.post('/appointments/:id/record', async (req, res) => {
  const { diagnosis, notes, medicines } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let recordId;
    const [ex] = await conn.query('SELECT id FROM medical_records WHERE appointment_id=?', [req.params.id]);
    if (ex.length) {
      recordId = ex[0].id;
      await conn.query('UPDATE medical_records SET diagnosis=?, notes=? WHERE id=?', [diagnosis, notes, recordId]);
      await conn.query('DELETE FROM prescription_items WHERE medical_record_id=?', [recordId]);
    } else {
      const [ins] = await conn.query(
        'INSERT INTO medical_records (appointment_id, diagnosis, notes) VALUES (?,?,?)',
        [req.params.id, diagnosis, notes]
      );
      recordId = ins.insertId;
    }

    if (Array.isArray(medicines) && medicines.length > 0) {
      for (const m of medicines) {
        if (!m.medicine_name || !m.medicine_name.trim()) continue;
        await conn.query(
          `INSERT INTO prescription_items
            (medical_record_id, medicine_name, quantity, days,
             dose_sang, dose_trua, dose_chieu, dose_toi,
             timing, timing_minutes, note)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [recordId, m.medicine_name.trim(), m.quantity || '', m.days || 1,
           m.dose_sang || 0, m.dose_trua || 0, m.dose_chieu || 0, m.dose_toi || 0,
           m.timing || 'sau_an', m.timing_minutes || 0, m.note || '']
        );
      }
    }

    await conn.query(`UPDATE appointments SET status='done' WHERE id=?`, [req.params.id]);
    await conn.commit();
    res.json({ success: true, message: 'Lưu bệnh án thành công' });
  } catch (e) {
    await conn.rollback();
    console.error('Lỗi record:', e.message);
    res.json({ success: false, message: 'Lỗi server' });
  } finally {
    conn.release();
  }
});

// GET /api/doctor/appointments/:id/record
router.get('/appointments/:id/record', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT mr.*, pp.full_name AS patient_name, pp.date_of_birth, pp.gender, pp.insurance_number,
             s.date, s.start_time, u_doc.full_name AS doctor_name, dep.name AS department_name
      FROM medical_records mr
      JOIN appointments a ON mr.appointment_id = a.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      WHERE mr.appointment_id = ?`, [req.params.id]);
    if (!rows.length) return res.json({ success: false, message: 'Chưa có bệnh án' });

    const [medicines] = await db.query(
      'SELECT * FROM prescription_items WHERE medical_record_id=? ORDER BY id',
      [rows[0].id]
    );
    res.json({ success: true, data: { ...rows[0], medicines } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/patient-history/:profileId
router.get('/patient-history/:profileId', async (req, res) => {
  try {
    const exclude = req.query.exclude || 0;
    const [rows] = await db.query(`
      SELECT a.id, s.date, dep.name AS department_name,
             u_doc.full_name AS doctor_name,
             mr.id AS record_id, mr.diagnosis, mr.notes, mr.created_at
      FROM appointments a
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      LEFT JOIN medical_records mr ON mr.appointment_id = a.id
      WHERE a.profile_id = ? AND a.status = 'done' AND a.id != ?
      ORDER BY s.date DESC, a.id DESC
      LIMIT 10`, [req.params.profileId, exclude]);

    for (const row of rows) {
      if (row.record_id) {
        const [meds] = await db.query(
          'SELECT * FROM prescription_items WHERE medical_record_id=? ORDER BY id',
          [row.record_id]
        );
        row.medicines = meds;
      } else {
        row.medicines = [];
      }
    }
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/my-records - lịch sử bệnh án của bác sĩ
router.get('/my-records', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [doc] = await db.query('SELECT id FROM doctors WHERE user_id=?', [req.user.id]);
    if (!doc.length) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    const doctor_id = doc[0].id;

    let searchWhere = '';
    const params = [doctor_id];
    if (search) {
      searchWhere = ' AND (pp.full_name LIKE ? OR mr.diagnosis LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total FROM medical_records mr
      JOIN appointments a ON mr.appointment_id = a.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      WHERE s.doctor_id = ?${searchWhere}`, params);

    const [rows] = await db.query(`
      SELECT mr.id, mr.diagnosis, mr.notes, mr.created_at,
             pp.full_name AS patient_name, pp.date_of_birth, pp.gender,
             a.queue_number, s.date, s.start_time, dep.name AS department_name
      FROM medical_records mr
      JOIN appointments a ON mr.appointment_id = a.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN departments dep ON s.department_id = dep.id
      WHERE s.doctor_id = ?${searchWhere}
      ORDER BY mr.created_at DESC
      LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    res.json({ success: true, data: rows, total });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;
