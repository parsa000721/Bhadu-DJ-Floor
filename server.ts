import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { DatabaseSchema, Booking, MediaItem, Song, Inquiry } from './src/types.js';

dotenv.config();

const app = express();
const PORT = 3000;
const DB_PATH = path.join(process.cwd(), 'database.json');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Initialize Supabase Client if env variables are available
const rawUrl = process.env.SUPABASE_URL;
const rawKey = process.env.SUPABASE_ANON_KEY;

// Clean environment variables by stripping surrounding quotes (single/double) and trimming whitespace
function cleanEnvVar(val: string | undefined): string {
  if (!val) return '';
  let cleaned = val.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.trim();
  
  // Ignore placeholder strings
  const uppercase = cleaned.toUpperCase();
  if (
    uppercase.includes('YOUR_') || 
    uppercase.includes('MY_') || 
    uppercase === 'YOUR_SUPABASE_ANON_KEY' || 
    uppercase === 'YOUR_SUPABASE_URL'
  ) {
    return '';
  }
  return cleaned;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

const cleanedKey = cleanEnvVar(rawKey);
let cleanedUrl = cleanEnvVar(rawUrl);

if (!cleanedUrl) {
  // Use our fallback project URL if none is provided
  cleanedUrl = 'https://riifssodsufmzethaask.supabase.co';
}

let supabase: any = null;
if (cleanedKey && isValidUrl(cleanedUrl)) {
  try {
    supabase = createClient(cleanedUrl, cleanedKey);
    console.log('Supabase client initialized successfully at ' + cleanedUrl);
  } catch (err: any) {
    console.error('Failed to initialize Supabase client:', err.message || err);
  }
} else {
  console.log('Supabase env vars are not fully set or are placeholders. Operating in local-only database.json fallback mode.');
}

const folders = ['', 'gallery', 'songs', 'payments'];

// Ensure uploads directories exist (safely, as the filesystem is read-only on serverless platforms like Vercel)
try {
  folders.forEach(folder => {
    const dir = path.join(UPLOADS_DIR, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (e) {
  console.warn('Could not ensure or create uploads directories (expected on read-only serverless runtimes like Vercel):', e);
}

// Helper to read database
async function readDB(): Promise<DatabaseSchema> {
  const getLocalFallback = (): DatabaseSchema => {
    try {
      if (!fs.existsSync(DB_PATH)) {
        // Return a basic fallback if database.json was somehow wiped
        return {
          admin: { username: 'admin', password: 'bhadudjpassword123' },
          settings: {
            upiId: 'bhadudj@okaxis',
            upiQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=bhadudj@okaxis&pn=Bhadu%20DJ%20Floor&mc=0000&mode=02&purpose=00',
            contactPhone: '+91 95099-99689',
            address: 'गांव कलरू, मेडता सिटी (नागौर), राजस्थान',
            email: 'bhadudjfloor@gmail.com',
            businessTiming: 'सुबह 08:00 से रात्रि 10:00 बजे तक',
            mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d14197.808546115984!2d74.12356525!3d26.65023455!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x396be4b4a1ffffaf%3A0xe6bf44bc4ad78f88!2sMerta%20City%2C%20Rajasthan%20341510!5e0!3m2!1sen!2sin!4v1700000000000!5m2!1sen!2sin'
          },
          socialLinks: {
            whatsapp: 'https://wa.me/919509999689',
            facebook: 'https://facebook.com/bhadudjfloor',
            instagram: 'https://instagram.com/bhadudjfloor',
            youtube: 'https://youtube.com/bhadudjfloor',
            telegram: 'https://t.me/bhadudjfloor'
          },
          banners: [],
          gallery: [],
          songs: [],
          bookings: [],
          inquiries: []
        };
      }
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('Error reading database file, returning static defaults', err);
      return {} as DatabaseSchema;
    }
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('bhadu_dj_state')
        .select('data')
        .eq('id', 'main_state')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('No main_state row in Supabase. Auto-seeding default settings/state...');
          const initialData = getLocalFallback();
          await writeDB(initialData);
          return initialData;
        }
        console.warn('Supabase read error (using local database.json fallback):', error.message);
        return getLocalFallback();
      }

      if (data && data.data) {
        return data.data as DatabaseSchema;
      }
    } catch (err: any) {
      console.error('Supabase fetch failed completely, using file-backed fallback:', err.message || err);
    }
  }

  return getLocalFallback();
}

// Helper to write database (writes to both local file and Supabase)
async function writeDB(data: DatabaseSchema): Promise<void> {
  // 1. Write to local file backup
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database file backup', err);
  }

  // 2. Synchronize to Supabase if client is active
  if (supabase) {
    try {
      const { error } = await supabase
        .from('bhadu_dj_state')
        .upsert({ id: 'main_state', data, updated_at: new Date().toISOString() });

      if (error) {
        console.error('Failed to upsert state to Supabase:', error.message);
      } else {
        console.log('Successfully synchronized database state with Supabase!');
      }
    } catch (err) {
      console.error('Supabase write failed completely:', err);
    }
  }
}

// Express Body Parsers with limits for base64 file uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Serve static uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------------
// API ROUTES
// ----------------------

// Diagnostic endpoint for Supabase connection status
app.get('/api/admin/supabase-status', async (req, res) => {
  const status = {
    configured: !!cleanedKey && isValidUrl(cleanedUrl),
    initialized: !!supabase,
    url: cleanedUrl,
    hasKey: !!cleanedKey,
    keyLength: cleanedKey ? cleanedKey.length : 0,
    connected: false,
    error: null as string | null,
    dbCheck: null as any
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('bhadu_dj_state')
        .select('updated_at')
        .eq('id', 'main_state')
        .maybeSingle();

      if (error) {
        status.error = error.message + ` (Code: ${error.code || 'unknown'})`;
        status.dbCheck = { success: false, code: error.code, message: error.message };
        // PGRST116 means zero rows found - but connection is successful and table exists!
        // 42P01 means relation "bhadu_dj_state" does not exist - meaning the database credentials are valid but table is not yet set up
        if (error.code === 'PGRST116' || error.code === '42P01') {
          status.connected = true;
        }
      } else {
        status.connected = true;
        status.dbCheck = { success: true, updated_at: data ? data.updated_at : null };
      }
    } catch (err: any) {
      status.error = err.message || String(err);
      status.dbCheck = { success: false, message: status.error };
    }
  } else {
    status.error = 'Supabase client not initialized. Make sure SUPABASE_ANON_KEY and SUPABASE_URL are set correctly.';
  }

  res.json(status);
});

// Fetch complete public database details
app.get('/api/database', async (req, res) => {
  const db = await readDB();
  // Strip administrative sensitive fields before sending
  const publicData = {
    settings: db.settings,
    socialLinks: db.socialLinks,
    banners: db.banners,
    gallery: db.gallery,
    songs: db.songs,
    bookings: db.bookings.map(b => ({
      id: b.id,
      customerName: b.customerName,
      date: b.date,
      location: b.location,
      eventType: b.eventType,
      status: b.status,
      createdAt: b.createdAt
    })), // only basic booking info to show live indicators or book slots
    inquiriesCount: db.inquiries ? db.inquiries.length : 0
  };
  res.json(publicData);
});

// Fetch full admin database details (secured backend check, but we return all for unified client state structure)
app.post('/api/admin/database', async (req, res) => {
  const { username, password } = req.body;
  const db = await readDB();

  if (username === db.admin.username && password === db.admin.password) {
    res.json({ success: true, db });
  } else {
    res.status(401).json({ success: false, message: 'गलत यूजरनेम या पासवर्ड।' });
  }
});

// Auth Change Password
app.post('/api/admin/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  const db = await readDB();

  if (username === db.admin.username && oldPassword === db.admin.password) {
    db.admin.password = newPassword;
    await writeDB(db);
    res.json({ success: true, message: 'पासवर्ड सफलतापूर्वक बदल दिया गया है!' });
  } else {
    res.status(401).json({ success: false, message: 'पुराना पासवर्ड गलत है।' });
  }
});

// File Upload Proxy endpoint (takes base64 & metadata, writes natively, saves trouble of heavy third-party multipart engines)
app.post('/api/upload', (req, res) => {
  const { base64Data, filename, folder } = req.body;
  if (!base64Data || !filename) {
    return res.status(400).json({ success: false, message: 'फाइल डेटा या नाम गायब है।' });
  }

  try {
    // String looks like: "data:image/png;base64,iVBORw0KGgoAAA..." or flat base64
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;

    if (matches && matches.length === 3) {
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }

    const cleanFilename = Date.now() + '_' + filename.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const targetFolder = folders.includes(folder) ? folder : '';
    const filepath = path.join(UPLOADS_DIR, targetFolder, cleanFilename);

    fs.writeFileSync(filepath, buffer);

    const relativeUrl = `/uploads/${targetFolder ? targetFolder + '/' : ''}${cleanFilename}`;
    res.json({ success: true, url: relativeUrl });
  } catch (err: any) {
    console.error('File write error:', err);
    res.status(500).json({ success: false, message: 'फाइल अपलोड करने में विफलता: ' + err.message });
  }
});

// Bookings Endpoints
app.post('/api/bookings', async (req, res) => {
  const { customerName, mobileNumber, date, location, eventType, totalAmount, advanceAmount, paymentScreenshot, notes } = req.body;

  if (!customerName || !mobileNumber || !date || !location || !eventType) {
    return res.status(400).json({ success: false, message: 'सभी आवश्यक फील्ड भरें!' });
  }

  const db = await readDB();
  const total = Number(totalAmount) || 0;
  const advance = Number(advanceAmount) || 0;
  const remaining = Math.max(0, total - advance);

  // Generate Booking ID: BDJ-YYMMDD-XXXX
  const dateStr = date.replace(/-/g, '').substring(2);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const bookingId = `BDJ-${dateStr}-${randomSuffix}`;

  const newBooking: Booking = {
    id: bookingId,
    customerName,
    mobileNumber,
    date,
    location,
    eventType,
    totalAmount: total,
    advanceAmount: advance,
    remainingAmount: remaining,
    status: 'Pending',
    paymentScreenshot: paymentScreenshot || '',
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  db.bookings = db.bookings || [];
  db.bookings.unshift(newBooking);
  await writeDB(db);

  res.json({ success: true, booking: newBooking });
});

app.put('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  const db = await readDB();

  db.bookings = db.bookings || [];
  const idx = db.bookings.findIndex(b => b.id === id);

  if (idx !== -1) {
    const booking = db.bookings[idx];
    
    // Update fields
    if (updateData.customerName !== undefined) booking.customerName = updateData.customerName;
    if (updateData.mobileNumber !== undefined) booking.mobileNumber = updateData.mobileNumber;
    if (updateData.date !== undefined) booking.date = updateData.date;
    if (updateData.location !== undefined) booking.location = updateData.location;
    if (updateData.eventType !== undefined) booking.eventType = updateData.eventType;
    if (updateData.status !== undefined) booking.status = updateData.status;
    if (updateData.notes !== undefined) booking.notes = updateData.notes;

    if (updateData.totalAmount !== undefined || updateData.advanceAmount !== undefined) {
      const total = updateData.totalAmount !== undefined ? Number(updateData.totalAmount) : booking.totalAmount;
      const advance = updateData.advanceAmount !== undefined ? Number(updateData.advanceAmount) : booking.advanceAmount;
      booking.totalAmount = total;
      booking.advanceAmount = advance;
      booking.remainingAmount = Math.max(0, total - advance);
    }

    if (updateData.paymentScreenshot !== undefined) booking.paymentScreenshot = updateData.paymentScreenshot;

    db.bookings[idx] = booking;
    await writeDB(db);
    res.json({ success: true, booking });
  } else {
    res.status(404).json({ success: false, message: 'बुकिंग रिकॉर्ड नहीं मिला।' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();

  db.bookings = db.bookings || [];
  const booking = db.bookings.find(b => b.id === id);

  if (booking) {
    // If there is an uploaded screenshot, we can optionally delete it from disk
    if (booking.paymentScreenshot && booking.paymentScreenshot.startsWith('/uploads/')) {
      const sPath = path.join(process.cwd(), booking.paymentScreenshot);
      if (fs.existsSync(sPath)) {
        try { fs.unlinkSync(sPath); } catch (e) {}
      }
    }
    
    db.bookings = db.bookings.filter(b => b.id !== id);
    await writeDB(db);
    res.json({ success: true, message: 'बुकिंग सफलतापूर्वक हटा दी गई है।' });
  } else {
    res.status(404).json({ success: false, message: 'बुकिंग नहीं मिली।' });
  }
});

// Settings & Social links
app.put('/api/settings', async (req, res) => {
  const newSettings = req.body;
  const db = await readDB();

  db.settings = { ...db.settings, ...newSettings };
  await writeDB(db);
  res.json({ success: true, settings: db.settings });
});

app.put('/api/socials', async (req, res) => {
  const newLinks = req.body;
  const db = await readDB();

  db.socialLinks = { ...db.socialLinks, ...newLinks };
  await writeDB(db);
  res.json({ success: true, socialLinks: db.socialLinks });
});

// Banners endpoints
app.put('/api/banners', async (req, res) => {
  const { banners } = req.body;
  if (!Array.isArray(banners)) {
    return res.status(400).json({ success: false, message: 'बैनर अमान्य हैं।' });
  }

  const db = await readDB();
  db.banners = banners;
  await writeDB(db);
  res.json({ success: true, banners: db.banners });
});

// Gallery endpoints
app.post('/api/gallery', async (req, res) => {
  const { title, category, type, url } = req.body;
  if (!title || !category || !type || !url) {
    return res.status(400).json({ success: false, message: 'सभी जानकारी भरें।' });
  }

  const db = await readDB();
  const newItem: MediaItem = {
    id: 'g' + Date.now(),
    title,
    category,
    type,
    url
  };

  db.gallery = db.gallery || [];
  db.gallery.push(newItem);
  await writeDB(db);
  res.json({ success: true, mediaItem: newItem });
});

app.delete('/api/gallery/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();

  db.gallery = db.gallery || [];
  const item = db.gallery.find(g => g.id === id);

  if (item) {
    if (item.url.startsWith('/uploads/')) {
      const fPath = path.join(process.cwd(), item.url);
      if (fs.existsSync(fPath)) {
        try { fs.unlinkSync(fPath); } catch (e) {}
      }
    }
    db.gallery = db.gallery.filter(g => g.id !== id);
    await writeDB(db);
    res.json({ success: true, message: 'मीडिया सफलतापूर्वक हटा दिया गया है।' });
  } else {
    res.status(404).json({ success: false, message: 'मीडिया नहीं मिला।' });
  }
});

// Songs endpoints
app.post('/api/songs', async (req, res) => {
  const { title, artist, category, url, duration, thumbnail } = req.body;
  if (!title || !artist || !category || !url) {
    return res.status(400).json({ success: false, message: 'सभी जानकारी भरें।' });
  }

  const db = await readDB();
  const newSong: Song = {
    id: 's' + Date.now(),
    title,
    artist,
    category,
    url,
    duration: duration || '3:00',
    thumbnail: thumbnail || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=150'
  };

  db.songs = db.songs || [];
  db.songs.push(newSong);
  await writeDB(db);
  res.json({ success: true, song: newSong });
});

app.delete('/api/songs/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();

  db.songs = db.songs || [];
  const song = db.songs.find(s => s.id === id);

  if (song) {
    // delete physical files if stored in uploads
    if (song.url.startsWith('/uploads/')) {
      const sPath = path.join(process.cwd(), song.url);
      if (fs.existsSync(sPath)) {
        try { fs.unlinkSync(sPath); } catch (e) {}
      }
    }
    if (song.thumbnail && song.thumbnail.startsWith('/uploads/')) {
      const tPath = path.join(process.cwd(), song.thumbnail);
      if (fs.existsSync(tPath)) {
        try { fs.unlinkSync(tPath); } catch (e) {}
      }
    }
    db.songs = db.songs.filter(s => s.id !== id);
    await writeDB(db);
    res.json({ success: true, message: 'गाना सफलतापूर्वक हटा दिया गया है।' });
  } else {
    res.status(404).json({ success: false, message: 'गाने का रिकॉर्ड नहीं मिला।' });
  }
});

// Inquiries Endpoints (Contact page form submit)
app.post('/api/inquiries', async (req, res) => {
  const { name, phone, subject, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ success: false, message: 'सभी आवश्यक फील्ड भरें!' });
  }

  const db = await readDB();
  const newInq: Inquiry = {
    id: 'inq' + Date.now(),
    name,
    phone,
    subject: subject || 'सामान्य पूछताछ',
    message,
    date: new Date().toISOString().split('T')[0]
  };

  db.inquiries = db.inquiries || [];
  db.inquiries.unshift(newInq);
  await writeDB(db);
  res.json({ success: true, inquiry: newInq });
});

app.delete('/api/inquiries/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();

  db.inquiries = db.inquiries || [];
  const inquiry = db.inquiries.find(i => i.id === id);

  if (inquiry) {
    db.inquiries = db.inquiries.filter(i => i.id !== id);
    await writeDB(db);
    res.json({ success: true, message: 'पूछताछ सफलतापूर्वक हटा दी गई है।' });
  } else {
    res.status(404).json({ success: false, message: 'दर्ज विवरण नहीं मिला।' });
  }
});

// ----------------------
// BUILD & START FLOW (VITE HOST IN EXPRESS)
// ----------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Only start standalone listener if not on Vercel Node serverless function env
  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();

export default app;
