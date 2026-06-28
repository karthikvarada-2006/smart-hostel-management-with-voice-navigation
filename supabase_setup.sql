-- ============================================
-- HOSTEL MANAGEMENT SYSTEM - COMPLETE DB SETUP
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. CREATE ENUMS
CREATE TYPE public.user_role AS ENUM ('student', 'admin');
CREATE TYPE public.complaint_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.complaint_status AS ENUM ('pending', 'in_progress', 'resolved');
CREATE TYPE public.pass_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.pass_type AS ENUM ('outing', 'home_vacation');

-- 2. CREATE TABLES

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role public.user_role DEFAULT 'student',
  room_number TEXT,
  hostel_name TEXT,
  jntu_number TEXT,
  branch TEXT,
  year TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Attendance table
CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  is_present BOOLEAN DEFAULT true,
  marked_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Complaints table
CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  priority public.complaint_priority DEFAULT 'medium',
  status public.complaint_status DEFAULT 'pending',
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Food Menu table
CREATE TABLE public.food_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_date DATE NOT NULL,
  breakfast TEXT,
  lunch TEXT,
  dinner TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notices table
CREATE TABLE public.notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_important BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  related_id TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Passes table
CREATE TABLE public.passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pass_type public.pass_type NOT NULL,
  reason TEXT NOT NULL,
  destination TEXT NOT NULL,
  from_date TIMESTAMPTZ NOT NULL,
  to_date TIMESTAMPTZ NOT NULL,
  status public.pass_status DEFAULT 'pending',
  admin_comment TEXT,
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. CREATE HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.get_profile_id(user_uuid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.profiles WHERE user_id = user_uuid LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID)
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE user_id = user_uuid LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.delete_auth_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- 4. ENABLE ROW LEVEL SECURITY ON ALL TABLES

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passes ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES

-- == PROFILES ==
-- Everyone can read profiles (needed for lookups)
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (true);

-- Users can insert their own profile
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Admins can delete profiles
CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- == ATTENDANCE ==
-- Students can see their own attendance, admins can see all
CREATE POLICY "attendance_select" ON public.attendance
  FOR SELECT USING (
    student_id = public.get_profile_id(auth.uid())
    OR public.get_user_role(auth.uid()) = 'admin'
  );

-- Admins can insert attendance
CREATE POLICY "attendance_insert" ON public.attendance
  FOR INSERT WITH CHECK (
    public.get_user_role(auth.uid()) = 'admin'
  );

-- Admins can update attendance
CREATE POLICY "attendance_update" ON public.attendance
  FOR UPDATE USING (
    public.get_user_role(auth.uid()) = 'admin'
  );

-- == COMPLAINTS ==
-- Students see their own, admins see all
CREATE POLICY "complaints_select" ON public.complaints
  FOR SELECT USING (
    student_id = public.get_profile_id(auth.uid())
    OR public.get_user_role(auth.uid()) = 'admin'
  );

-- Students can create complaints
CREATE POLICY "complaints_insert" ON public.complaints
  FOR INSERT WITH CHECK (
    student_id = public.get_profile_id(auth.uid())
  );

-- Students can update their own, admins can update all
CREATE POLICY "complaints_update" ON public.complaints
  FOR UPDATE USING (
    student_id = public.get_profile_id(auth.uid())
    OR public.get_user_role(auth.uid()) = 'admin'
  );

-- == FOOD MENU ==
-- Everyone can read the menu
CREATE POLICY "food_menu_select" ON public.food_menu
  FOR SELECT USING (true);

-- Only admins can create/update/delete menus
CREATE POLICY "food_menu_insert" ON public.food_menu
  FOR INSERT WITH CHECK (
    public.get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "food_menu_update" ON public.food_menu
  FOR UPDATE USING (
    public.get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "food_menu_delete" ON public.food_menu
  FOR DELETE USING (
    public.get_user_role(auth.uid()) = 'admin'
  );

-- == NOTICES ==
-- Everyone can read notices
CREATE POLICY "notices_select" ON public.notices
  FOR SELECT USING (true);

-- Only admins can create/update/delete notices
CREATE POLICY "notices_insert" ON public.notices
  FOR INSERT WITH CHECK (
    public.get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "notices_update" ON public.notices
  FOR UPDATE USING (
    public.get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "notices_delete" ON public.notices
  FOR DELETE USING (
    public.get_user_role(auth.uid()) = 'admin'
  );

-- == NOTIFICATIONS ==
-- Users can see their own notifications
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (
    user_id = public.get_profile_id(auth.uid())
  );

-- System/admins can insert notifications
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (true);

-- Users can update their own (mark as read)
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (
    user_id = public.get_profile_id(auth.uid())
  );

-- == PASSES ==
-- Students see their own, admins see all
CREATE POLICY "passes_select" ON public.passes
  FOR SELECT USING (
    student_id = public.get_profile_id(auth.uid())
    OR public.get_user_role(auth.uid()) = 'admin'
  );

-- Students can create passes
CREATE POLICY "passes_insert" ON public.passes
  FOR INSERT WITH CHECK (
    student_id = public.get_profile_id(auth.uid())
  );

-- Students can update their own pending passes, admins can update all
CREATE POLICY "passes_update" ON public.passes
  FOR UPDATE USING (
    student_id = public.get_profile_id(auth.uid())
    OR public.get_user_role(auth.uid()) = 'admin'
  );
