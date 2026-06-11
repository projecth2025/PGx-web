# Quick Start - Post-Migration Setup

## ⚡ TL;DR Setup (5 minutes)

### 1. Create Database Schema
Go to https://app.supabase.com and select your project `kcweqwgirohzxlzojdwv`

Copy the entire SQL from `supabase/migrations/20260603_init_schema.sql` and run it in:
**SQL Editor → New Query** (paste and run)

### 2. Create `.env.local` File
```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_from_supabase
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_S3_BUCKET=your-bucket-name
PROCESSING_API_URL=https://your-api-endpoint.com
```

### 3. Install & Run
```bash
npm install
npm run dev
```

Visit `http://localhost:5173`

---

## 📋 What to Do Next

### Get Your Supabase Service Role Key
1. Go to https://app.supabase.com
2. Select your project
3. Settings → API → **Service role (secret)** - Copy this
4. Paste in `.env.local`

### Create AWS S3 Bucket (Optional)
If you want to use AWS S3 for file storage:
1. Go to AWS console → S3
2. Create a bucket
3. Create IAM user with S3 access
4. Get access key and secret key
5. Add to `.env.local`

### Set Processing API URL
Configure where files will be sent for processing:
- Example: `https://your-backend.example.com/process`
- Add to `.env.local`

---

## ✅ Verify It's Working

1. **Sign Up** - Create account at http://localhost:5173/auth
2. **Check Profile** - Query Supabase: `SELECT * FROM profiles;`
3. **Upload Test** - Upload folder with .vcf files
4. **Check Batch** - Query: `SELECT * FROM upload_batches;`

---

## 🚀 Deploy to Production

### Vercel (Recommended)
```bash
vercel env add VITE_SUPABASE_URL https://kcweqwgirohzxlzojdwv.supabase.co
vercel env add VITE_SUPABASE_ANON_KEY your_anon_key
vercel env add SUPABASE_SERVICE_ROLE_KEY your_service_role_key
vercel env add AWS_REGION us-east-1
vercel env add AWS_ACCESS_KEY_ID your_key
vercel env add AWS_SECRET_ACCESS_KEY your_secret
vercel env add AWS_S3_BUCKET your-bucket
vercel env add PROCESSING_API_URL your_api_url

vercel deploy --prod
```

### Others
Set environment variables in your platform's secrets/dashboard and deploy normally.

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Missing VITE_SUPABASE_URL" | Check `.env` has it (starts with `VITE_`) |
| "Invalid token" | Check `.env.local` has correct `SUPABASE_SERVICE_ROLE_KEY` |
| "S3 upload failed" | Verify AWS credentials and bucket exists |
| "Profile not created" | Run migrations and check database trigger |
| "Processing API failed" | Verify API endpoint is correct and accessible |

---

## 📚 Full Documentation

See `MIGRATION_GUIDE.md` for comprehensive setup instructions.
