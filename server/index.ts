import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import espnRoutes from './routes/espn.js';

const app = express();
const PORT = 3001;

// Allow all origins in development
app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api', espnRoutes);

app.listen(PORT, () => {
  console.log(`[server] Fantasy Basketball API running on http://localhost:${PORT}`);
});
