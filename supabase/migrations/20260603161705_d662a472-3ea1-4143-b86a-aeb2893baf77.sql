-- 1) Prevent role escalation on profiles INSERT
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id AND role = 'lab_staff');

-- 2) Prevent role escalation on profiles UPDATE via trigger (preserves existing role)
CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.role := OLD.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_profile_role_change_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_change();

-- Keep the self-scoped UPDATE policy explicit with a matching WITH CHECK
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 3) Remove write privileges on processing_logs from authenticated users.
-- Logs are written exclusively by the trusted server (service_role).
REVOKE INSERT, UPDATE, DELETE ON public.processing_logs FROM authenticated;
GRANT ALL ON public.processing_logs TO service_role;