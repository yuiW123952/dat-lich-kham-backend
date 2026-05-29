const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const auth    = require('../middleware/auth');

router.use(auth);

// POST /api/appointments - đặt lịch
router.post('/', async (req, res) => {
  const { schedule_id, profile_id, patient_notes, payment_method, service_type } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[profileCheck]] = await conn.query(
      'SELECT id FROM patient_profiles WHERE id=? AND user_id=?',
      [profile_id, req.user.id]
    );
    if (!profileCheck) {
      await conn.rollback();
      return res.json({ success: false, message: 'Hồ sơ không hợp lệ' });
    }

    const [[refSch]] = await conn.query(
      'SELECT department_id, date, start_time, end_time FROM schedules WHERE id = ?',
      [schedule_id]
    );
    if (!refSch) { await conn.rollback(); return res.json({ success: false, message: 'Không tìm thấy lịch' }); }

    const [allSchs] = await conn.query(`
      SELECT s.id, s.max_patients,
             (SELECT COUNT(*) FROM appointments WHERE schedule_id = s.id AND status != 'cancelled') AS booked
      FROM schedules s
      WHERE s.department_id = ? AND s.date = ? AND s.start_time = ? AND s.end_time = ?
      FOR UPDATE`, [refSch.department_id, refSch.date, refSch.start_time, refSch.end_time]);

    const totalBooked = allSchs.reduce((sum, s) => sum + Number(s.booked), 0);
    const totalMax    = allSchs.reduce((sum, s) => sum + Number(s.max_patients), 0);
    if (totalBooked >= totalMax) {
      await conn.rollback();
      return res.json({ success: false, message: 'Lịch đã đầy, vui lòng chọn lịch khác' });
    }

    const bestSch = allSchs
      .filter(s => s.booked < s.max_patients)
      .sort((a, b) => (a.max_patients - a.booked) < (b.max_patients - b.booked) ? 1 : -1)[0];

    const sch = { max_patients: bestSch.max_patients, booked: bestSch.booked };
    const actual_schedule_id = bestSch.id;

    const [dupCheck] = await conn.query(`
      SELECT a.id FROM appointments a
      JOIN schedules s ON a.schedule_id = s.id
      WHERE a.profile_id = ?
        AND s.department_id = ?
        AND s.date = ?
        AND s.start_time = ?
        AND s.end_time = ?
        AND a.status != 'cancelled'`,
      [profile_id, refSch.department_id, refSch.date, refSch.start_time, refSch.end_time]);
    if (dupCheck.length) { await conn.rollback(); return res.json({ success: false, message: 'Hồ sơ này đã có lịch khám trong buổi này' }); }

    const queue_number = sch.booked + 1;
    const [r] = await conn.query(
      'INSERT INTO appointments (schedule_id, profile_id, queue_number, patient_notes, payment_method, service_type) VALUES (?,?,?,?,?,?)',
      [actual_schedule_id, profile_id, queue_number, patient_notes || '', payment_method || 'cash', service_type || 'dichvu']
    );
    await conn.commit();
    res.json({ success: true, data: { id: r.insertId, queueNumber: queue_number } });
  } catch (e) {
    await conn.rollback();
    res.json({ success: false, message: 'Lỗi server' });
  } finally {
    conn.release();
  }
});

// GET /api/appointments/my - lịch của tôi
router.get('/my', async (req, res) => {
  try {
    const { status } = req.query;
    const [profiles] = await db.query('SELECT id FROM patient_profiles WHERE user_id=?', [req.user.id]);
    if (!profiles.length) return res.json({ success: true, data: [] });
    const profileIds = profiles.map(p => p.id);

    await db.query(`
      UPDATE appointments a
      JOIN schedules s ON a.schedule_id = s.id
      SET a.status = 'done'
      WHERE a.profile_id IN (${profileIds.join(',')})
        AND a.status IN ('waiting', 'in_progress')
        AND s.date < CURDATE()
    `);

    let where = `a.profile_id IN (${profileIds.join(',')})`;
    const params = [];
    if (status) { where += ' AND a.status = ?'; params.push(status); }

    const [rows] = await db.query(`
      SELECT a.*, pp.full_name AS patient_name,
       pp.date_of_birth, pp.gender, pp.cccd, pp.insurance_number,
             u_doc.full_name AS doctor_name, dep.name AS department_name,
             s.date, s.start_time, s.end_time, s.current_queue,
             mr.diagnosis, mr.notes AS treatment_notes
      FROM appointments a
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      LEFT JOIN medical_records mr ON mr.appointment_id = a.id
      WHERE ${where}
      ORDER BY s.date DESC, a.queue_number`, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/appointments/find-by-cccd
router.get('/find-by-cccd', async (req, res) => {
  try {
    const { cccd, date } = req.query;
    if (!cccd) return res.json({ success: false, message: 'Vui lòng nhập CCCD' });
    const dateFilter = date || new Date().toISOString().slice(0, 10);
    const [rows] = await db.query(`
      SELECT a.id, a.queue_number, a.status, a.payment_method, a.payment_status,
             a.service_type, a.checked_in,
             pp.full_name AS patient_name, pp.date_of_birth, pp.gender,
             pp.cccd, pp.insurance_number,
             dep.name AS department_name,
             s.date, s.start_time, s.end_time,
             u_doc.full_name AS doctor_name
      FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      WHERE pp.cccd = ? AND s.date = ? AND a.status != 'cancelled'
      ORDER BY a.queue_number`, [cccd, dateFilter]);
    if (!rows.length) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/appointments/find-by-id
router.get('/find-by-id', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.json({ success: false, message: 'Thiếu ID lịch hẹn' });
    const [[row]] = await db.query(`
      SELECT a.id, a.queue_number, a.status, a.payment_method, a.payment_status,
             a.service_type, a.checked_in,
             pp.full_name AS patient_name, pp.date_of_birth, pp.gender,
             pp.cccd, pp.insurance_number,
             dep.name AS department_name,
             s.date, s.start_time, s.end_time,
             u_doc.full_name AS doctor_name
      FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      WHERE a.id = ? AND a.status != 'cancelled'`, [id]);
    if (!row) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    res.json({ success: true, data: row });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/appointments/:id/record
router.get('/:id/record', async (req, res) => {
  try {
    const [[appt]] = await db.query(`
      SELECT a.id FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      WHERE a.id = ? AND pp.user_id = ?`, [req.params.id, req.user.id]);
    if (!appt) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    const [[record]] = await db.query('SELECT * FROM medical_records WHERE appointment_id = ?', [req.params.id]);
    if (!record) return res.json({ success: false, message: 'Chưa có bệnh án' });
    const [medicines] = await db.query('SELECT * FROM prescription_items WHERE medical_record_id = ? ORDER BY id', [record.id]);
    res.json({ success: true, data: { ...record, medicines } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/appointments/:id/confirm-payment - bệnh nhân xác nhận đã thanh toán Momo
// Chỉ set payment_status = paid, KHÔNG set checked_in
router.put('/:id/confirm-payment', async (req, res) => {
  try {
    const [[appt]] = await db.query('SELECT id, status FROM appointments WHERE id=?', [req.params.id]);
    if (!appt) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    if (appt.status === 'cancelled') return res.json({ success: false, message: 'Lịch đã bị hủy' });
    await db.query('UPDATE appointments SET payment_status = "paid" WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Đã xác nhận thanh toán' });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/appointments/:id/checkin - lễ tân xác nhận bệnh nhân đã đến
// Set checked_in = 1 + payment_status = paid (thu tiền mặt)
router.put('/:id/checkin', async (req, res) => {
  try {
    const [[appt]] = await db.query('SELECT id, status FROM appointments WHERE id=?', [req.params.id]);
    if (!appt) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    if (appt.status === 'cancelled') return res.json({ success: false, message: 'Lịch đã bị hủy' });
    await db.query('UPDATE appointments SET checked_in = 1, payment_status = "paid" WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Đã xác nhận bệnh nhân đã đến' });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/appointments/:id/absent
router.put('/:id/absent', async (req, res) => {
  try {
    await db.query(`UPDATE appointments SET status='absent' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/appointments/:id/cancel
router.put('/:id/cancel', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.id, a.status, a.checked_in, s.date, s.start_time FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      WHERE a.id = ? AND pp.user_id = ?`, [req.params.id, req.user.id]);
    if (!rows.length) return res.json({ success: false, message: 'Không tìm thấy lịch hẹn' });
    if (rows[0].status === 'cancelled') return res.json({ success: false, message: 'Lịch đã được hủy trước đó' });
    if (rows[0].status === 'done') return res.json({ success: false, message: 'Lịch đã khám xong, không thể hủy' });
    if (Number(rows[0].checked_in) === 1) return res.json({ success: false, message: 'Đã check-in tại lễ tân, không thể hủy!' });

    const apptDate = new Date(rows[0].date);
    const [h, m] = rows[0].start_time.split(':').map(Number);
    apptDate.setHours(h, m, 0, 0);
    const diffHours = (apptDate - new Date()) / (1000 * 60 * 60);
    if (diffHours < 5) return res.json({ success: false, message: 'Chỉ được hủy trước giờ khám ít nhất 5 tiếng!' });

    await db.query(`UPDATE appointments SET status='cancelled' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;
