const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { Resend } = require('resend');
const db      = require('../config/db');
const auth    = require('../middleware/auth');

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOtpEmail = async (to, otp) => {
  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to,
    subject: 'Mã OTP xác thực HCM-UTE',
html: `
  <div style="font-family:Arial,sans-serif;max-width:400px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px;">
    <h2 style="color:#1a73e8;">HCM-UTE</h2>
    <p>Mã OTP của bạn là:</p>
    <h1 style="letter-spacing:8px;color:#1a73e8;">${otp}</h1>
    <p style="color:#888;font-size:13px;">Mã có hiệu lực trong 5 phút. Không chia sẻ mã này cho bất kỳ ai.</p>
  </div>
`,
  });
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!rows.length) return res.json({ success: false, message: 'Số điện thoại không tồn tại' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.json({ success: false, message: 'Mật khẩu không đúng' });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { token, user: { id: user.id, phone: user.phone, full_name: user.full_name, role: user.role } } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// Lưu OTP tạm thời
const otpStore = new Map();

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone, full_name, password, email } = req.body;
  if (!phone || !full_name || !password || !email)
    return res.json({ success: false, message: 'Thiếu thông tin' });
  try {
    const [ex] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (ex.length)
      return res.json({ success: false, message: 'Số điện thoại đã được đăng ký' });

    const [exEmail] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exEmail.length)
      return res.json({ success: false, message: 'Email đã được đăng ký' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000;
    const hashed = await bcrypt.hash(password, 10);
    otpStore.set(phone, { otp, expiry, data: { full_name, phone, email, hashed } });

    await sendOtpEmail(email, otp);

    res.json({ success: true, message: 'Đã gửi OTP về email của bạn' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: 'Lỗi server' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const record = otpStore.get(phone);
  if (!record)
    return res.json({ success: false, message: 'Chưa gửi OTP hoặc OTP đã hết hạn' });
  if (Date.now() > record.expiry) {
    otpStore.delete(phone);
    return res.json({ success: false, message: 'OTP đã hết hạn, vui lòng gửi lại' });
  }
  if (record.otp !== otp)
    return res.json({ success: false, message: 'Mã OTP không đúng' });
  try {
    const { full_name, email, hashed } = record.data;
    await db.query(
      'INSERT INTO users (full_name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [full_name, phone, email, hashed, 'patient']
    );
    otpStore.delete(phone);
    res.json({ success: true, message: 'Đăng ký thành công' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: 'Lỗi server' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { full_name, phone, password } = req.body;
  try {
    const [ex] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (ex.length) return res.json({ success: false, message: 'Số điện thoại đã được đăng ký' });
    const hashed = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (full_name, phone, password, role) VALUES (?, ?, ?, ?)', [full_name, phone, hashed, 'patient']);
    res.json({ success: true, message: 'Đăng ký thành công' });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, full_name, phone, email, role FROM users WHERE id = ?', [req.user.id]);
    if (!users.length) return res.json({ success: false, message: 'Không tìm thấy người dùng' });
    const [profiles] = await db.query('SELECT * FROM patient_profiles WHERE user_id = ?', [req.user.id]);
    res.json({ success: true, data: { ...users[0], profiles } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/auth/push-token
router.put('/push-token', auth, async (req, res) => {
  try {
    await db.query('UPDATE users SET expo_push_token = ? WHERE id = ?', [req.body.expo_push_token, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// Lưu OTP quên mật khẩu
const forgotOtpStore = new Map();

// POST /api/auth/forgot-send-otp
router.post('/forgot-send-otp', async (req, res) => {
  const { phone, new_password } = req.body;
  if (!phone || !new_password)
    return res.json({ success: false, message: 'Thiếu thông tin' });
  try {
    const [rows] = await db.query('SELECT id, email FROM users WHERE phone = ? AND role = ?', [phone, 'patient']);
    if (!rows.length)
      return res.json({ success: false, message: 'Số điện thoại không tồn tại' });
    if (!rows[0].email)
      return res.json({ success: false, message: 'Tài khoản chưa có email, vui lòng liên hệ hỗ trợ' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000;
    const hashed = await bcrypt.hash(new_password, 10);
    forgotOtpStore.set(phone, { otp, expiry, hashed });

    await sendOtpEmail(rows[0].email, otp);

    res.json({ success: true, message: 'Đã gửi OTP về email của bạn' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: 'Lỗi server' });
  }
});

// POST /api/auth/forgot-verify-otp
router.post('/forgot-verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const record = forgotOtpStore.get(phone);
  if (!record)
    return res.json({ success: false, message: 'Chưa gửi OTP hoặc OTP đã hết hạn' });
  if (Date.now() > record.expiry) {
    forgotOtpStore.delete(phone);
    return res.json({ success: false, message: 'OTP đã hết hạn, vui lòng gửi lại' });
  }
  if (record.otp !== otp)
    return res.json({ success: false, message: 'Mã OTP không đúng' });
  try {
    await db.query('UPDATE users SET password = ? WHERE phone = ?', [record.hashed, phone]);
    forgotOtpStore.delete(phone);
    res.json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: 'Lỗi server' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { phone, new_password } = req.body;
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE phone = ? AND role = ?', [phone, 'patient']);
    if (!rows.length) return res.json({ success: false, message: 'Số điện thoại không tồn tại' });
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE phone = ?', [hashed, phone]);
    res.json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// POST /api/auth/profiles
router.post('/profiles', auth, async (req, res) => {
  const { full_name, date_of_birth, gender, address, insurance_number, cccd, ethnicity, occupation, height, weight } = req.body;
  try {
    const [r] = await db.query(
      'INSERT INTO patient_profiles (user_id, full_name, date_of_birth, gender, address, insurance_number, cccd, ethnicity, occupation, height, weight) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, full_name, date_of_birth, gender, address, insurance_number, cccd, ethnicity, occupation, height, weight]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// PUT /api/auth/profiles/:id
router.put('/profiles/:id', auth, async (req, res) => {
  const { full_name, date_of_birth, gender, address, insurance_number, cccd, ethnicity, occupation, height, weight } = req.body;
  try {
    await db.query(
      'UPDATE patient_profiles SET full_name=?, date_of_birth=?, gender=?, address=?, insurance_number=?, cccd=?, ethnicity=?, occupation=?, height=?, weight=? WHERE id=? AND user_id=?',
      [full_name, date_of_birth, gender, address, insurance_number, cccd, ethnicity, occupation, height, weight, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

// DELETE /api/auth/profiles/:id
router.delete('/profiles/:id', auth, async (req, res) => {
  try {
    const [[profile]] = await db.query('SELECT id FROM patient_profiles WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!profile) return res.json({ success: false, message: 'Không tìm thấy hồ sơ' });

    const [appts] = await db.query('SELECT id FROM appointments WHERE profile_id=?', [req.params.id]);
    for (const appt of appts) {
      await db.query('DELETE FROM prescription_items WHERE medical_record_id IN (SELECT id FROM medical_records WHERE appointment_id=?)', [appt.id]);
      await db.query('DELETE FROM reviews WHERE appointment_id=?', [appt.id]);
      await db.query('DELETE FROM medical_records WHERE appointment_id=?', [appt.id]);
    }
    await db.query('DELETE FROM appointments WHERE profile_id=?', [req.params.id]);
    await db.query('DELETE FROM patient_profiles WHERE id=? AND user_id=?', [req.params.id, req.user.id]);

    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: 'Lỗi server' }); }
});

module.exports = router;