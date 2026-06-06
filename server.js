require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/doctor',       require('./routes/doctor'));
app.use('/api/schedules',    require('./routes/schedules'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/reviews',      require('./routes/reviews'));
app.use('/api/queue',        require('./routes/queue'));
app.use('/api/news', require('./routes/news'));
app.use('/api/webhook',     require('./routes/webhook'));

app.get('/', (req, res) => res.json({ message: 'Medical Booking API is running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);

  // Keep-alive: tự ping mỗi 25 phút để Railway không sleep
  const SELF_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`;

  setInterval(async () => {
    try {
      await fetch(SELF_URL);
      console.log('🏓 Keep-alive ping OK');
    } catch (e) {
      console.log('🏓 Keep-alive ping failed:', e.message);
    }
  }, 25 * 60 * 1000);
});
