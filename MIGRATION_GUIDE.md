# Lovable to Standalone Migration Guide

## ✅ What Has Been Completed

This document outlines the migration from Lovable Cloud to a fully standalone Supabase setup. The following changes have been made to your codebase:

### Code Changes
- ✅ Updated `vite.config.ts` - Removed Lovable-specific config, using standard TanStack Start setup
- ✅ Updated `package.json` - Removed `@lovable.dev/vite-tanstack-config` dependency
- ✅ Rewrote `src/integrations/supabase/client.ts` - Clean Supabase client without Lovable proxy
- ✅ Rewrote `src/integrations/supabase/client.server.ts` - Direct admin client initialization
- ✅ Rewrote `src/integrations/supabase/auth-middleware.ts` - Standard JWT verification
- ✅ Rewrote `src/integrations/supabase/auth-attacher.ts` - Standard auth token attachment
- ✅ Updated `src/integrations/supabase/types.ts` - Complete database schema types
- ✅ Updated `src/lib/s3.server.ts` - Direct AWS S3 (Lovable connector removed)
- ✅ Updated `src/lib/lovable-error-reporting.ts` - Converted to standard error logging
- ✅ Updated `.env` - New Supabase project credentials

### Database Setup
- ✅ Created comprehensive SQL schema in `supabase/migrations/20260603_init_schema.sql`
- ✅ Includes all tables: profiles, upload_batches, uploaded_files, generated_results, processing_logs
- ✅ All tables have proper RLS (Row Level Security) policies
- ✅ Automatic trigger for profile creation on user signup

---

## 📋 Required Manual Setup Steps

### 1. **Set Up Supabase Project**

Your new Supabase project is already created:
- **URL**: `https://kcweqwgirohzxlzojdwv.supabase.co`
- **Anon Key**: Already configured in `.env`

Visit: https://app.supabase.com/projects

#### Step 1a: Apply Database Schema

You have two options:

**Option A: Via Supabase CLI (Recommended)**
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Link your project
supabase link --project-ref kcweqwgirohzxlzojdwv

# Apply migrations
supabase db push
```

**Option B: Via Supabase Dashboard (Manual)**
1. Go to https://app.supabase.com
2. Select your project
3. Go to SQL Editor → New Query
4. Copy the entire contents of `supabase/migrations/20260603_init_schema.sql`
5. Paste and execute

### 2. **Configure Environment Variables**

Your `.env` file now has placeholders for server-side variables. You need to fill these:

#### Get Supabase Service Role Key
1. Go to Supabase Dashboard → Settings → API
2. Copy the **Service role (secret)** key (NOT the anon key)
3. Add to `.env.local` (never commit this):
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```

#### AWS S3 Configuration (If Using S3 for File Storage)
1. Create an AWS S3 bucket for file storage
2. Get AWS credentials with S3 access
3. Add to `.env.local`:
   ```env
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_S3_BUCKET=your-bucket-name
   ```

#### Processing API Configuration
1. Configure your backend processing API endpoint
2. Add to `.env.local`:
   ```env
   PROCESSING_API_URL=https://your-api-endpoint.com/process
   ```

### 3. **Enable Authentication**

Supabase Auth is already enabled by default. Verify it's working:

1. Go to Supabase Dashboard → Authentication → Providers
2. Ensure **Email** provider is enabled
3. Configure email templates if needed (optional)

### 4. **Set Up Row-Level Security (RLS)**

The schema migration includes RLS policies. Verify they're in place:

1. Go to Supabase Dashboard → SQL Editor
2. Run this query to check RLS is enabled:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables 
   WHERE schemaname = 'public' 
   AND tablename IN ('profiles', 'upload_batches', 'uploaded_files', 'generated_results', 'processing_logs');
   ```

All tables should show `true` for row security.

---

## 🚀 Running Locally

### Prerequisites
- Node.js 18+
- npm or pnpm or bun

### Install Dependencies
```bash
npm install
# or
pnpm install
# or
bun install
```

### Start Development Server
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Test the Application Flow

1. **Sign Up**
   - Navigate to login page
   - Create a new account with email and password
   - Should automatically create a profile row in the database

2. **Upload Files**
   - Go to Upload page
   - Select a folder with .vcf files
   - Upload and monitor processing

3. **View History**
   - Check upload history page
   - View batch details and results

---

## 🔧 Troubleshooting

### "Missing Supabase environment variables"
- Ensure `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- These should start with `VITE_` prefix (client-side only)

### "Invalid or expired token"
- Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in `.env.local`
- Check that the key is correct (not the anon key)
- Service role key should start with `eyJ...`

### "AWS S3 upload failed"
- Verify AWS credentials in `.env.local`
- Ensure S3 bucket exists and is accessible
- Check IAM permissions for the AWS access key

### "Profile not created after signup"
- The trigger should create it automatically
- If not, verify the database migration ran successfully
- Check the `profiles` table exists and has the trigger

### "Processing API not configured"
- Make sure `PROCESSING_API_URL` is set in `.env`
- Test the endpoint is accessible and returns proper JSON

---

## 📦 Build for Production

### Build Command
```bash
npm run build
```

### Deploy

The app is a standard Vite + TanStack Start app and can be deployed to:
- **Vercel** (recommended for TanStack Start)
- **Netlify**
- **Cloudflare Pages/Workers**
- **Docker/VPS** (with Node.js)

For Vercel deployment:
```bash
# Make sure these environment variables are set in Vercel dashboard:
VITE_SUPABASE_URL=https://kcweqwgirohzxlzojdwv.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_URL=https://kcweqwgirohzxlzojdwv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET=your-bucket
PROCESSING_API_URL=your_api_endpoint
```

---

## 🔒 Security Checklist

- [ ] Never commit `.env.local` (add to `.gitignore`)
- [ ] Service role key is only in `.env.local`, not in `.env`
- [ ] AWS credentials are not committed to git
- [ ] RLS policies are enabled on all tables
- [ ] Database backups are enabled in Supabase
- [ ] Environment variables are set correctly in production

---

## 📚 Key Files Modified/Created

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite configuration without Lovable |
| `package.json` | Dependencies (removed Lovable) |
| `.env` | Client-side environment variables |
| `src/integrations/supabase/client.ts` | Supabase client |
| `src/integrations/supabase/client.server.ts` | Admin client |
| `src/integrations/supabase/auth-middleware.ts` | JWT verification |
| `src/integrations/supabase/auth-attacher.ts` | Auth token injection |
| `src/integrations/supabase/types.ts` | Database types |
| `src/lib/s3.server.ts` | S3 file operations |
| `src/lib/lovable-error-reporting.ts` | Error logging |
| `supabase/migrations/20260603_init_schema.sql` | Database schema |

---

## 📞 Support

For issues:
1. Check the Supabase documentation: https://supabase.com/docs
2. Check TanStack Start docs: https://tanstack.com/start
3. Review the schema migration for constraint errors
4. Check browser console for client-side errors
5. Check server logs for API errors

---

## ✨ Next Steps

1. Complete the setup steps above
2. Test locally with `npm run dev`
3. Run through the complete workflow (signup → upload → view history)
4. Configure AWS S3 if not using Supabase Storage
5. Deploy to your hosting platform
6. Monitor logs and errors in production

---

**Migration Status**: ✅ Code Complete - Ready for Manual Setup
