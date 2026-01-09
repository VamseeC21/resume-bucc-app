# Migration Guide: Games System & User Names

## ✅ Completed

### Database Schema

- ✅ Created `setup-database-clean.sql` - Complete fresh database setup
- ✅ Added `first_name` and `last_name` to profiles table
- ✅ Created `games` table with access_token system
- ✅ Linked `resumes` and `comparisons` to games via `game_id`
- ✅ Updated all RPC functions to work with game context
- ✅ Created `join_game_by_token` function
- ✅ Created `create_game` function

### Frontend Updates

- ✅ Updated Auth page to collect first/last name on signup
- ✅ Updated `useAuth` hook to handle names
- ✅ Created `SelectGame` page for joining/selecting games
- ✅ Updated routing to include `/select-game`
- ✅ Updated Grade page to work with game context from localStorage
- ✅ Updated Grade page to redirect if no game selected

## ⚠️ Still Needs Work

### 1. Admin Page - Game Management

The Admin page needs to be updated to:

- Show list of all games (for admins) or games created by user
- Allow creating new games with name input
- Display access token when game is created
- Allow managing resumes within a specific game context
- Show rankings per game (not globally)

**Location**: `src/pages/Admin.tsx`

### 2. Rankings Display

Update the Rankings tab in Admin to:

- Filter by selected game
- Show user's first_name and last_name instead of user IDs
- Make resumes clickable to show PDF preview modal

**Location**: `src/pages/Admin.tsx` (Rankings tab)

### 3. Resume Preview Modal

Create a modal component that:

- Shows PDF preview when clicking a resume name in rankings
- Can be reused in other places

**Location**: Create new component or add to `src/pages/Admin.tsx`

### 4. Audit/Votes Tab

Update to show:

- User names (first_name + last_name) instead of IDs
- Filter by game

**Location**: `src/pages/Admin.tsx` (Audit tab)

## 🚀 Setup Instructions

### Step 1: Run Database Migration

1. Go to your Supabase Dashboard → SQL Editor
2. If you want to start fresh (recommended):
   - Run `setup-database-clean.sql`
   - This will create everything from scratch
3. OR if you want to migrate existing data:
   - Run `supabase/migrations/20260109000000_add_games_and_names.sql`
   - This adds new columns/tables without deleting data

### Step 2: Create Storage Bucket

Make sure the `resumes` storage bucket exists:

1. Supabase Dashboard → Storage
2. Create bucket named `resumes` (private)

### Step 3: Create Your First Game

After logging in as admin:

1. Navigate to `/admin` (once Admin page is updated)
2. Create a new game
3. Copy the access token
4. Share token with users for them to join

### Step 4: Make Yourself Admin (if needed)

Run this SQL after creating your account:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = 'YOUR_USER_ID';
```

## 📝 Key Changes Overview

### Database Structure

```
games (new)
  - id, name, access_token, created_by

profiles (updated)
  - Added: first_name, last_name

resumes (updated)
  - Added: game_id (foreign key to games)

comparisons (updated)
  - Added: game_id (foreign key to games)
  - Updated unique constraint: (user_id, pair_hash, game_id)
```

### User Flow

1. User signs up with first/last name
2. User is redirected to `/select-game`
3. User either:
   - Enters access token to join existing game, OR
   - Selects from their games list
4. User grades resumes in selected game context
5. Admin creates/manages games from `/admin`

### localStorage Usage

- `currentGameId` - Stores selected game ID
- `currentGameName` - Stores selected game name

## 🔧 Remaining Implementation Details

### Admin Page Game Management

Add to Admin.tsx:

```typescript
// Game creation state
const [games, setGames] = useState<Game[]>([]);
const [newGameName, setNewGameName] = useState("");
const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

// Function to create game
const createGame = async () => {
  const { data, error } = await supabase.rpc("create_game", {
    p_name: newGameName,
    p_created_by: user!.id,
  });
  // Handle response, show access token
};

// Fetch games user created/participated in
const fetchGames = async () => {
  // Query games table
};
```

### Rankings with Names

Update rankings query to join with profiles:

```typescript
// When fetching comparisons for audit tab
const { data } = await supabase
  .from("comparisons")
  .select(
    `
    *,
    user:profiles!user_id(first_name, last_name)
  `
  )
  .eq("game_id", selectedGameId);
```

### Resume Preview Modal

Use the Dialog component from shadcn-ui:

```typescript
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Show PDF in iframe similar to Grade page
```

## ⚠️ Important Notes

1. **Existing Data**: If you run the clean setup, all existing resumes/comparisons will be deleted. Make backups if needed.

2. **Game Context**: All resume uploads and comparisons now require a game_id. Make sure users select/create a game first.

3. **Access Tokens**: 8-character uppercase tokens are auto-generated. Share these with users to join games.

4. **RLS Policies**: Updated to respect game ownership. Game creators can manage their games, users can only participate.

5. **Profile Names**: Names are stored in profiles table and can be updated. The trigger tries to extract from user_metadata, but the app also updates explicitly.

## 🐛 Known Issues / TODOs

- [ ] Admin page needs game creation UI
- [ ] Rankings need to filter by game
- [ ] Rankings need to show names instead of IDs
- [ ] Resume preview modal needs to be implemented
- [ ] Audit tab needs game filtering and name display
- [ ] Consider adding game settings (name changes, etc.)

## 📚 Files Modified

- `src/pages/Auth.tsx` - Added name fields
- `src/pages/SelectGame.tsx` - NEW - Game selection page
- `src/pages/Grade.tsx` - Updated for game context
- `src/hooks/useAuth.tsx` - Updated signup to handle names
- `src/App.tsx` - Added `/select-game` route
- `supabase/migrations/20260109000000_add_games_and_names.sql` - Migration file
- `setup-database-clean.sql` - Complete clean setup

## 🎯 Next Steps

1. Complete Admin page game management UI
2. Add resume preview modal to Rankings
3. Update Rankings to show names and filter by game
4. Update Audit tab similarly
5. Test the full flow end-to-end
6. Update any remaining references to remove old single-game assumptions
