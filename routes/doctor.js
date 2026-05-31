shedule_id = s.id
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

shedule_id = s.id
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