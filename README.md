# Fantasy Hoops Scoreboard

A retro-styled web app for tracking real-time ESPN Fantasy Basketball league scores and statistics.

## Overview

Fantasy Hoops Scoreboard displays live matchup scores, player performances, and league standings for your private ESPN Fantasy Basketball league. Built with React, Vite, and real-time data from ESPN's fantasy API.

## Prerequisites

- **Node.js** 18+ and npm
- **ESPN Fantasy Basketball League** - Access to a private league (you need to be a member or commissioner)
- **Supabase Account** - Free tier available at [supabase.com](https://supabase.com)
- **Browser** - For extracting ESPN authentication cookies

## Getting Your ESPN Auth Cookies

This is the most important part of setup. The ESPN Fantasy API requires authentication cookies that prove you have access to your league.

### Step-by-Step Instructions

1. **Log into ESPN Fantasy Basketball**
   - Go to https://fantasy.espn.com/basketball/
   - Sign in with your ESPN account

2. **Open Browser DevTools**
   - Press `F12` to open Developer Tools
   - If DevTools opens on the right, you may want to move it to the bottom for easier viewing

3. **Find Your Cookies**
   - Click the **Application** tab (or **Storage** in Firefox)
   - In the left sidebar, expand **Cookies**
   - Click on `fantasy.espn.com`

4. **Copy `espn_s2` Cookie**
   - Look for a cookie named `espn_s2`
   - Right-click it and select **Copy Value** (or double-click to select and copy)
   - Paste this value into `ESPN_S2` in your `.env` file
   - It's a long random string, usually 128+ characters

5. **Copy `SWID` Cookie**
   - Look for a cookie named `SWID`
   - Copy its value (it looks like `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`)
   - Paste this value into `ESPN_SWID` in your `.env` file
   - **Include the curly braces** - they're part of the value

6. **Important: Don't Log Out**
   - Keep your ESPN session active (don't log out on this browser)
   - These cookies expire when you log out
   - If cookies expire, repeat these steps to get fresh ones

## Setup Instructions

### 1. Clone / Download the Repository
```bash
git clone <repository-url>
cd fbb-scores
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
```bash
# Copy the example file
cp .env.example .env
```

### 4. Fill In ESPN Configuration

Edit `.env` and add:

- **ESPN_LEAGUE_ID**: Your ESPN fantasy league ID
  - Find it in your league URL: `fantasy.espn.com/basketball/league?leagueId=XXXXXX`
  - Copy just the numbers after `leagueId=`

- **ESPN_S2** and **ESPN_SWID**: Follow the "Getting Your ESPN Auth Cookies" section above

### 5. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and sign up / log in
2. Create a new project or use an existing one
3. Go to the **SQL Editor**
4. Create a new query
5. Copy the SQL schema from `supabase/schema.sql` in this repo (create the file if it doesn't exist with your database schema)
6. Run the query to create tables

### 6. Fill In Supabase API Keys

1. Go to **Project Settings** → **API** in your Supabase project
2. Copy your **Project URL** → paste into `SUPABASE_URL` and `VITE_SUPABASE_URL` in `.env`
3. Copy your **anon public key** → paste into `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY` in `.env`
4. Copy your **service_role secret key** → paste into `SUPABASE_SERVICE_ROLE_KEY` in `.env`
   - Keep this secret - only for backend use

### 7. Start the Development Server
```bash
npm run dev
```

This command:
- Starts the **frontend** on http://localhost:5173 (Vite dev server with HMR)
- Starts the **backend** on http://localhost:3001 (Express.js API server)

### 8. Open in Browser
Visit http://localhost:5173 in your browser. You should see live league data!

## Environment Variables

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `ESPN_LEAGUE_ID` | Your ESPN Fantasy Basketball league ID | Yes | `12345678` |
| `ESPN_SEASON_ID` | NBA season year | Yes | `2025` |
| `ESPN_S2` | ESPN authentication cookie (from browser) | Yes | Long random string (128+ chars) |
| `ESPN_SWID` | ESPN SWID cookie (from browser) | Yes | `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` |
| `SUPABASE_URL` | Your Supabase project URL | Yes | `https://boolpdiyncuruuoumbzm.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase public API key | Yes | Random base64 string |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin API key (backend only, keep secret) | Yes | Random base64 string |
| `VITE_SUPABASE_URL` | Supabase URL exposed to frontend | Yes | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key exposed to frontend | Yes | Same as `SUPABASE_ANON_KEY` |

**Note**: Variables prefixed with `VITE_` are automatically exposed to the frontend by Vite during build.

## Project Architecture

```
fbb-scores/
├── src/
│   ├── components/          # React UI components (scoreboard display, etc.)
│   ├── hooks/               # React Query hooks for data fetching
│   ├── lib/
│   │   ├── espn/
│   │   │   ├── client.ts    # ESPN API HTTP client
│   │   │   ├── adapter.ts   # Transform ESPN API responses to app types
│   │   │   └── calculations.ts  # Score calculations and stats
│   │   └── supabase/
│   │       ├── client.ts    # Supabase client for frontend
│   │       ├── server-client.ts  # Supabase admin client for backend
│   │       └── types.ts     # Generated TypeScript types from schema
│   ├── types/               # Shared TypeScript interfaces
│   ├── App.tsx              # Main React app
│   └── main.tsx             # React entry point
├── server/
│   ├── index.ts             # Express server setup and middleware
│   └── routes/
│       └── espn.ts          # ESPN API proxy routes
├── supabase/
│   └── schema.sql           # Database schema and migrations
├── .env                     # Environment variables (create from .env.example)
├── .env.example             # Template for environment variables
├── vite.config.ts           # Vite build configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Project dependencies
```

### Frontend (React + Vite)
- React components render the scoreboard UI
- React Query manages API state and caching
- Tailwind CSS provides styling (v4 with Vite integration)
- Communicates with backend at http://localhost:3001

### Backend (Express.js)
- Proxy server for ESPN API requests (handles CORS, authentication)
- Routes defined in `server/routes/espn.ts`
- Runs on port 3001
- Uses environment variables for ESPN credentials

### Database (Supabase PostgreSQL)
- Stores historical snapshots of league data
- Enables trend analysis and historical comparisons
- Schema defined in `supabase/schema.sql`

## Scripts

- `npm run dev` - Start frontend and backend concurrently (dev mode)
- `npm run dev:client` - Start only frontend (Vite, port 5173)
- `npm run server` - Start only backend (Express, port 3001)
- `npm run build` - Build for production (TypeScript + Vite)
- `npm run lint` - Run ESLint on codebase
- `npm run preview` - Preview production build locally

## Features

- **Live Scoreboard** - Real-time matchup scores and updates
- **Player Stats** - Individual player performance tracking
- **League Standings** - Current win/loss records
- **Auto-Refresh** - Updates every 5 minutes automatically
- **Responsive Design** - Works on desktop and mobile

## Planned Features

- Projections and remaining schedule
- Historical trend lines and charts
- Matchup difficulty ratings
- Player news integration
- Push notifications for scoring updates
- Mobile app version

## Development Notes

### ESPN Cookies Expire
- ESPN cookies are tied to your browser session
- If you log out of ESPN, you must get new cookies
- To avoid interruptions, keep the browser session where you extracted cookies open

### Auto-Refresh Behavior
- The app automatically fetches fresh data every 5 minutes
- Supabase caches snapshots for performance
- You can manually refresh with your browser's refresh button

### Supabase Snapshots
- The app takes periodic snapshots of league state
- Snapshots are stored in Supabase for historical analysis
- This allows trend tracking and comparisons over time

## Troubleshooting

### "401 Unauthorized" from ESPN API
- Check that `ESPN_S2` and `ESPN_SWID` are correct
- Make sure you haven't logged out of ESPN (cookies expired)
- Re-extract the cookies following the instructions above

### "Invalid API key" from Supabase
- Verify `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are correct
- Check that your Supabase project still exists
- Confirm you copied the correct keys from Project Settings → API

### Port 3001 or 5173 already in use
- Kill the process using the port or change the port in configuration
- On Windows: `netstat -ano | findstr :3001`
- On Mac/Linux: `lsof -i :3001`

### No data displaying
- Check browser console (F12) for errors
- Verify all environment variables are set correctly
- Ensure ESPN league is not private without you being a member
- Check that Supabase schema is set up correctly

## Contributing

Please follow the existing code style. Use TypeScript for type safety and ESLint for code quality.

## License

[Add your license here]
