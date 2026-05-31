const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../config/db');
const auth    = require('../middleware/auth');
const { requireRole } = auth;

// Tất cả routes admin yêu cầu đăng nhập + role admin
router.use(auth, requireRole('admin'));

// ─── THỐNG KÊ DASHBOARD ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [[{ total_doctors }]]  = await db.query('SELECT COUNT(*) AS total_doctors FROM doctors');
    const [[{ total_schedules }]] = await db.query('SELECT COUNT(*) AS total_schedules FROM schedules WHERE date = ?', [today]);
    const [[{ waiting }]]  = await db.query(
      `SELECT COUNT(*) AS waiting FROM appointments a
       JOIN schedules s ON a.schedule_id = s.id
       WHERE s.date = ? AND a.status = 'waiting'`, [today]);
    const [[{ total_patients }]] = await db.query(`SELECT COUNT(*) AS total_patients FROM users WHERE role = 'patient'`);
    res.json({ success: true, data: { total_doctors, total_schedules, waiting, total_patients } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// ─── QUẢN LÝ CHUYÊN KHOA ─────────────────────────────────────────────────────
router.get('/departments', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM departments ORDER BY name');
  res.json({ success: true, data: rows });
});

router.post('/departments', async (req, res) => {
  const { name, description } = req.body;
  try {
    const [r] = await db.query('INSERT INTO departments (name, description) VALUES (?,?)', [name, description]);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.put('/departments/:id', async (req, res) => {
  const { name, description } = req.body;
  await db.query('UPDATE departments SET name=?, description=? WHERE id=?', [name, description, req.params.id]);
  res.json({ success: true });
});

router.delete('/departments/:id', async (req, res) => {
  await db.query('DELETE FROM departments WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// ─── QUẢN LÝ BÁC SĨ ──────────────────────────────────────────────────────────
router.get('/doctors', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.id, u.full_name, u.phone, u.id AS user_id,
             dep.name AS department_name, dep.id AS department_id,
             d.specialty, d.bio
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dep ON d.department_id = dep.id
      ORDER BY u.full_name`);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.post('/doctors', async (req, res) => {
  const { full_name, phone, password, department_id, specialty, bio } = req.body;
  try {
    const [ex] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (ex.length) return res.json({ success: false, message: 'Số điện thoại đã tồn tại' });
    const hashed = await bcrypt.hash(password, 10);
    const [u] = await db.query(
      'INSERT INTO users (full_name, phone, password, role) VALUES (?,?,?,?)',
      [full_name, phone, hashed, 'doctor']
    );
    await db.query(
      'INSERT INTO doctors (user_id, department_id, specialty, bio) VALUES (?,?,?,?)',
      [u.insertId, department_id, specialty, bio]
    );
    res.json({ success: true, message: 'Tạo tài khoản bác sĩ thành công' });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.put('/doctors/:id', async (req, res) => {
  const { full_name, department_id, specialty, bio, password } = req.body;
  try {
    const [docs] = await db.query('SELECT user_id FROM doctors WHERE id=?', [req.params.id]);
    if (!docs.length) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    const { user_id } = docs[0];
    await db.query('UPDATE users SET full_name=? WHERE id=?', [full_name, user_id]);
    await db.query('UPDATE doctors SET department_id=?, specialty=?, bio=? WHERE id=?', [department_id, specialty, bio, req.params.id]);
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET password=? WHERE id=?', [hashed, user_id]);
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.delete('/doctors/:id', async (req, res) => {
  try {
    const [docs] = await db.query('SELECT user_id FROM doctors WHERE id=?', [req.params.id]);
    if (!docs.length) return res.json({ success: false, message: 'Không tìm thấy bác sĩ' });
    await db.query('DELETE FROM doctors WHERE id=?', [req.params.id]);
    await db.query('DELETE FROM users WHERE id=?', [docs[0].user_id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// ─── QUẢN LÝ LỊCH LÀM VIỆC ──────────────────────────────────────────────────
router.get('/schedules', async (req, res) => {
  try {
    const { date } = req.query;
    let q = `
      SELECT s.*, u.full_name AS doctor_name, dep.name AS department_name,
             COUNT(a.id) AS booked_count
      FROM schedules s
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON s.department_id = dep.id
      LEFT JOIN appointments a ON a.schedule_id = s.id AND a.status != 'cancelled'
      GROUP BY s.id ORDER BY s.date DESC, s.start_time`;
    const params = [];
    if (date) { q = q.replace('GROUP BY', 'WHERE s.date = ? GROUP BY'); params.push(date); }
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.post('/schedules', async (req, res) => {
  const { doctor_id, department_id, date, start_time, end_time, max_patients } = req.body;
  try {
    // Kiểm tra bác sĩ có lịch trùng không
    const [conflict] = await db.query(
      `SELECT id FROM schedules WHERE doctor_id=? AND date=? AND (
        (start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?)
       )`,
      [doctor_id, date, end_time, start_time, end_time, start_time, start_time, end_time]
    );
    if (conflict.length) return res.json({ success: false, message: 'Bác sĩ đã có lịch trùng giờ này' });
    const [r] = await db.query(
      'INSERT INTO schedules (doctor_id, department_id, date, start_time, end_time, max_patients) VALUES (?,?,?,?,?,?)',
      [doctor_id, department_id, date, start_time, end_time, max_patients || 20]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.put('/schedules/:id', async (req, res) => {
  const { doctor_id, department_id, date, start_time, end_time, max_patients } = req.body;
  try {
    await db.query(
      'UPDATE schedules SET doctor_id=?, department_id=?, date=?, start_time=?, end_time=?, max_patients=? WHERE id=?',
      [doctor_id, department_id, date, start_time, end_time, max_patients, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.delete('/schedules/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM schedules WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// ─── XEM TẤT CẢ LỊCH HẸN ────────────────────────────────────────────────────
router.get('/appointments', async (req, res) => {
  try {
    const { date, status } = req.query;
    let where = [];
    const params = [];
    if (date)   { where.push('s.date = ?'); params.push(date); }
    if (status) { where.push('a.status = ?'); params.push(status); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await db.query(`
      SELECT a.*, pp.full_name AS patient_name, u_doc.full_name AS doctor_name,
             dep.name AS department_name, s.date, s.start_time, s.end_time
      FROM appointments a
      JOIN schedules s ON a.schedule_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN users u_doc ON d.user_id = u_doc.id
      JOIN departments dep ON s.department_id = dep.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      ${whereStr}
      ORDER BY s.date DESC, a.queue_number`, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});
// ─── QUẢN LÝ TIN TỨC ────────────────────────────────────────────────────────

router.get('/news', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM news ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.post('/news', async (req, res) => {
  const { title, content, image_url } = req.body;
  if (!title || !content) return res.json({ success: false, message: 'Vui lòng nhập tiêu đề và nội dung' });
  try {
    const [r] = await db.query(
      'INSERT INTO news (title, content, image_url) VALUES (?,?,?)',
      [title, content, image_url || null]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.put('/news/:id', async (req, res) => {
  const { title, content, image_url } = req.body;
  try {
    await db.query(
      'UPDATE news SET title=?, content=?, image_url=? WHERE id=?',
      [title, content, image_url || null, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

router.delete('/news/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM news WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});
// ─── ĐÁNH GIÁ BÁC SĨ ────────────────────────────────────────────────────────
router.get('/reviews', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.id, r.rating, r.comment, r.created_at,
             u.full_name AS doctor_name,
             pp.full_name AS patient_name,
             dep.name AS department_name
      FROM reviews r
      JOIN doctors d ON r.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN appointments a ON r.appointment_id = a.id
      JOIN patient_profiles pp ON a.profile_id = pp.id
      JOIN schedules s ON a.schedule_id = s.id
      JOIN departments dep ON s.department_id = dep.id
      ORDER BY r.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;
