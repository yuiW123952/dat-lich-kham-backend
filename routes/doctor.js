const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/doctor/me
router.get('/me', async (req, res) => {
  try {
    const [[doc]] = await db.query(`
      SELECT d.id, u.full_name, u.phone, dep.name AS department_name, d.specialty, d.bio
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dep ON d.department_id = dep.id
      WHERE d.user_id = ?`, [req.user.id]);
    if (!doc) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    res.json({ success: true, data: doc });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/queue
router.get('/queue', async (req, res) => {
  try {
    const { date } = req.query;
    const [[doc]] = await db.query('SELECT id FROM doctors WHERE user_id=?', [req.user.id]);
    if (!doc) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });

    const [rows] = await db.query(`
      SELECT a.id, a.queue_number, a.status, a.patient_notes, a.service_type,
             pp.full_name AS patient_name, pp.date_of_birth, pp.gender,
             pp.insurance_number, pp.id AS profile_id,
             mr.id AS record_id, mr.diagnosis
      FROM appointments a
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      LEFT JOIN medical_records mr ON mr.appointment_id = a.id
      WHERE s.doctor_id = ? AND s.date = ? AND a.status != 'cancelled'
      ORDER BY a.queue_number ASC`, [doc.id, date]);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/doctor/appointments/:id/call
router.put('/appointments/:id/call', async (req, res) => {
  try {
    await db.query(`UPDATE appointments SET status='in_progress' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/doctor/appointments/:id/absent
router.put('/appointments/:id/absent', async (req, res) => {
  try {
    await db.query(`UPDATE appointments SET status='absent' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/appointments/:id/record
router.get('/appointments/:id/record', async (req, res) => {
  try {
    const [[record]] = await db.query(
      'SELECT * FROM medical_records WHERE appointment_id=?', [req.params.id]);
    if (!record) return res.json({ success: false, message: 'Chưa có bệnh án' });
    const [meds] = await db.query(
      'SELECT * FROM prescription_items WHERE medical_record_id=? ORDER BY id', [record.id]);
    res.json({ success: true, data: { ...record, medicines: meds } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// POST /api/doctor/appointments/:id/record
router.post('/appointments/:id/record', async (req, res) => {
  try {
    const { diagnosis, notes, medicines } = req.body;
    const [[existing]] = await db.query(
      'SELECT id FROM medical_records WHERE appointment_id=?', [req.params.id]);

    let recordId;
    if (existing) {
      await db.query(
        'UPDATE medical_records SET diagnosis=?, notes=? WHERE id=?',
        [diagnosis, notes, existing.id]);
      recordId = existing.id;
      await db.query('DELETE FROM prescription_items WHERE medical_record_id=?', [recordId]);
    } else {
      const [result] = await db.query(
        'INSERT INTO medical_records (appointment_id, diagnosis, notes) VALUES (?,?,?)',
        [req.params.id, diagnosis, notes]);
      recordId = result.insertId;
    }

    if (medicines && medicines.length > 0) {
      for (const m of medicines) {
        await db.query(`
          INSERT INTO prescription_items
            (medical_record_id, medicine_name, quantity, days,
             dose_sang, dose_trua, dose_chieu, dose_toi,
             timing, timing_minutes, note)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [recordId, m.medicine_name, m.quantity, m.days,
           m.dose_sang, m.dose_trua, m.dose_chieu, m.dose_toi,
           m.timing, m.timing_minutes, m.note]);
      }
    }

    await db.query(`UPDATE appointments SET status='done' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/patient-history/:profileId
router.get('/patient-history/:profileId', async (req, res) => {
  try {
    const { exclude } = req.query;
    const [rows] = await db.query(`
      SELECT a.id, mr.id AS record_id, mr.diagnosis, mr.notes,
             s.date, s.start_time, dep.name AS department_name, a.queue_number
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
          [row.record_id]);
        row.medicines = meds;
      } else {
        row.medicines = [];
      }
    }
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/my-records
router.get('/my-records', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [[doc]] = await db.query('SELECT id FROM doctors WHERE user_id=?', [req.user.id]);
    if (!doc) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    const doctor_id = doc.id;

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

// GET /api/doctor/test-types
router.get('/test-types', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM test_types WHERE is_active=1 ORDER BY name');
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// POST /api/doctor/appointments/:id/test-orders
router.post('/appointments/:id/test-orders', async (req, res) => {
  try {
    const { test_type_ids, notes } = req.body;
    if (!test_type_ids || test_type_ids.length === 0)
      return res.json({ success: false, message: 'Vui lòng chọn ít nhất 1 xét nghiệm' });

    await db.query(`DELETE FROM test_orders WHERE appointment_id=? AND status='pending'`, [req.params.id]);

    for (const tid of test_type_ids) {
      await db.query(
        `INSERT INTO test_orders (appointment_id, test_type_id, notes) VALUES (?,?,?)`,
        [req.params.id, tid, notes || null]);
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/doctor/appointments/:id/test-orders
router.get('/appointments/:id/test-orders', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT to2.*, tt.name AS test_name, tt.price, tt.description
      FROM test_orders to2
      JOIN test_types tt ON to2.test_type_id = tt.id
      WHERE to2.appointment_id = ?`, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;
