-- ============================================================
-- MEDICAL BOOKING - DATABASE SCHEMA + DỮ LIỆU MẪU
-- Tạo database: medical_booking
-- Chạy file này trong MySQL Workbench hoặc terminal
-- ============================================================

CREATE DATABASE IF NOT EXISTS medical_booking
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medical_booking;

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  full_name       VARCHAR(255) NOT NULL,
  phone           VARCHAR(20) UNIQUE NOT NULL,
  password        VARCHAR(255) NOT NULL,
  role            ENUM('admin','doctor','patient') DEFAULT 'patient',
  expo_push_token VARCHAR(300),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── PATIENT PROFILES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_profiles (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  user_id          INT NOT NULL,
  full_name        VARCHAR(255) NOT NULL,
  date_of_birth    DATE,
  gender           ENUM('male','female','other'),
  address          TEXT,
  insurance_number VARCHAR(50),
  cccd             VARCHAR(12),
  ethnicity        VARCHAR(50),
  occupation       VARCHAR(100),
  height           FLOAT,
  weight           FLOAT,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── DEPARTMENTS (CHUYÊN KHOA) ────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(255) NOT NULL,
  description TEXT
);

-- ── DOCTORS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  user_id       INT NOT NULL UNIQUE,
  department_id INT,
  specialty     VARCHAR(255),
  bio           TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ── SCHEDULES (LỊCH LÀM VIỆC) ───────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  doctor_id     INT NOT NULL,
  department_id INT NOT NULL,
  date          DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  max_patients  INT DEFAULT 20,
  current_queue INT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- ── APPOINTMENTS (LỊCH HẸN) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  schedule_id    INT NOT NULL,
  profile_id     INT NOT NULL,
  queue_number   INT NOT NULL,
  status         ENUM('waiting','in_progress','done','cancelled') DEFAULT 'waiting',
  patient_notes  TEXT,
  payment_method VARCHAR(50) DEFAULT 'cash',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id)  REFERENCES patient_profiles(id) ON DELETE CASCADE
);

-- ── MEDICAL RECORDS (BỆNH ÁN) ───────────────────────────────
CREATE TABLE IF NOT EXISTS medical_records (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  appointment_id INT NOT NULL UNIQUE,
  diagnosis      TEXT,
  prescription   TEXT,
  notes          TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

-- ── REVIEWS (ĐÁNH GIÁ BÁC SĨ) ───────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  appointment_id INT NOT NULL UNIQUE,
  doctor_id      INT NOT NULL,
  rating         TINYINT CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  FOREIGN KEY (doctor_id)      REFERENCES doctors(id)
);

-- ============================================================
-- DỮ LIỆU MẪU (SEED DATA)
-- ============================================================

-- Tài khoản admin: SĐT 0900000001 | Mật khẩu: Admin@123
INSERT INTO users (full_name, phone, password, role) VALUES
('Quản Trị Viên', '0900000001', '$2a$10$PyjIdCah0ol2528Ugrypa.7A5ESM85O5FckfyrPacpxQcmjhkQqoO', 'admin');

-- Chuyên khoa
INSERT INTO departments (name, description) VALUES
('Nội khoa',        'Khám và điều trị các bệnh nội tạng'),
('Ngoại khoa',      'Phẫu thuật và can thiệp ngoại khoa'),
('Nhi khoa',        'Chăm sóc sức khỏe trẻ em'),
('Da liễu',         'Các bệnh về da và thẩm mỹ da'),
('Tai Mũi Họng',    'Khám và điều trị tai, mũi, họng'),
('Tim mạch',        'Chẩn đoán và điều trị bệnh tim mạch'),
('Thần kinh',       'Các bệnh về hệ thần kinh'),
('Cơ xương khớp',   'Điều trị bệnh xương khớp và cột sống');

-- Tài khoản bác sĩ mẫu: SĐT 0900000002 | Mật khẩu: Doctor@123
INSERT INTO users (full_name, phone, password, role) VALUES
('BS. Nguyễn Văn An', '0900000002', '$2a$10$PyjIdCah0ol2528Ugrypa.7A5ESM85O5FckfyrPacpxQcmjhkQqoO', 'doctor'),
('BS. Trần Thị Bình',  '0900000003', '$2a$10$PyjIdCah0ol2528Ugrypa.7A5ESM85O5FckfyrPacpxQcmjhkQqoO', 'doctor');

INSERT INTO doctors (user_id, department_id, specialty, bio) VALUES
(2, 1, 'Nội tổng quát',  'Bác sĩ có 10 năm kinh nghiệm khám và điều trị bệnh nội khoa tổng quát.'),
(3, 3, 'Nhi khoa tổng quát', 'Chuyên gia chăm sóc sức khỏe trẻ em với hơn 8 năm kinh nghiệm.');

-- Tài khoản bệnh nhân mẫu: SĐT 0900000004 | Mật khẩu: Patient@123
INSERT INTO users (full_name, phone, password, role) VALUES
('Lê Văn Cường', '0900000004', '$2a$10$PyjIdCah0ol2528Ugrypa.7A5ESM85O5FckfyrPacpxQcmjhkQqoO', 'patient');

INSERT INTO patient_profiles (user_id, full_name, date_of_birth, gender, address) VALUES
(4, 'Lê Văn Cường', '1990-05-15', 'male', 'Quận 1, TP. Hồ Chí Minh');

-- ============================================================
-- GHI CHÚ: Tất cả mật khẩu mẫu đều là "Admin@123" / "Doctor@123" / "Patient@123"
-- Hash tương ứng với: a$10$PyjIdCah0ol2528Ugrypa.7A5ESM85O5FckfyrPacpxQcmjhkQqoO
-- THAY HASH NÀY bằng cách chạy: require('bcryptjs').hashSync('MatKhauMoi@123', 10)
-- hoặc sử dụng endpoint /api/admin/doctors để tạo tài khoản mới (tự hash)
-- ============================================================
-- ── TEST TYPES (DANH MỤC XÉT NGHIỆM) ───────────────────────
CREATE TABLE IF NOT EXISTS test_types (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  price       INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO test_types (name, description, price) VALUES
('Xét nghiệm máu tổng quát',   'CBC - Công thức máu toàn phần',         150000),
('Xét nghiệm nước tiểu',       'Tổng phân tích nước tiểu 10 thông số',   80000),
('Siêu âm bụng tổng quát',     'Siêu âm các cơ quan ổ bụng',            200000),
('X-quang phổi',                'Chụp X-quang ngực thẳng',               120000),
('Điện tâm đồ (ECG)',           'Đo hoạt động điện tim 12 chuyển đạo',   100000),
('Xét nghiệm đường huyết',     'Glucose máu lúc đói',                    60000),
('Xét nghiệm chức năng gan',   'AST, ALT, GGT, Bilirubin',              180000),
('Xét nghiệm chức năng thận',  'Creatinine, Ure, Acid uric',            160000);

-- ── TEST ORDERS (YÊU CẦU XÉT NGHIỆM) ───────────────────────
CREATE TABLE IF NOT EXISTS test_orders (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  appointment_id INT NOT NULL,
  test_type_id   INT NOT NULL,
  status         ENUM('pending','paid','done') DEFAULT 'pending',
  payment_method VARCHAR(50) DEFAULT 'cash',
  paid_at        TIMESTAMP NULL,
  notes          TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (test_type_id)   REFERENCES test_types(id)
);

CREATE TABLE IF NOT EXISTS news (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  title      VARCHAR(255) NOT NULL,
  content    TEXT NOT NULL,
  image_url  LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);