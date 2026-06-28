import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type UserRole = "student" | "admin" | null;

interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  room_number: string | null;
  hostel_name: string | null;
  jntu_number: string | null;
  branch: string | null;
  year: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isReady: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithRole: (email: string, password: string, expectedRole: "student" | "admin") => Promise<{ error: Error | null; roleMismatch?: boolean; actualRole?: string }>;
  signUp: (email: string, password: string, fullName: string, role: UserRole, roomNumber?: string, hostelName?: string, jntuNumber?: string, branch?: string, year?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isStudent: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Track whether signInWithRole has already set profile eagerly
  // so onAuthStateChange doesn't overwrite it with a redundant fetch
  const eagerProfileSetRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching profile:", error);
      return null;
    }
    return data as Profile | null;
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (event === "SIGNED_OUT") {
          // Clear all state immediately on sign-out
          setProfile(null);
          setProfileLoading(false);
          return;
        }

        if (currentSession?.user) {
          // If signInWithRole already eagerly set the profile, skip redundant fetch
          if (eagerProfileSetRef.current) {
            eagerProfileSetRef.current = false;
            return;
          }

          // Fetch profile for any other auth state change (token refresh, etc.)
          setProfileLoading(true);
          fetchProfile(currentSession.user.id).then((fetchedProfile) => {
            setProfile(fetchedProfile);
            setProfileLoading(false);
          });
        } else {
          setProfile(null);
          setProfileLoading(false);
        }
      }
    );

    // THEN check for existing session (page reload / initial load)
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);

      if (existingSession?.user) {
        fetchProfile(existingSession.user.id).then((fetchedProfile) => {
          setProfile(fetchedProfile);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!error) {
      // Confirm session is actually set before returning
      const { data: { session: confirmedSession } } = await supabase.auth.getSession();
      if (confirmedSession?.user) {
        setProfileLoading(true);
        const fetchedProfile = await fetchProfile(confirmedSession.user.id);
        eagerProfileSetRef.current = true;
        setSession(confirmedSession);
        setUser(confirmedSession.user);
        setProfile(fetchedProfile);
        setProfileLoading(false);
      }
    }

    return { error };
  };

  // Role-aware sign in that validates user role before completing login
  const signInWithRole = async (
    email: string,
    password: string,
    expectedRole: "student" | "admin"
  ): Promise<{ error: Error | null; roleMismatch?: boolean; actualRole?: string }> => {
    // First, attempt to sign in
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      return { error: signInError };
    }

    if (!data.user) {
      return { error: new Error("No user returned from authentication") };
    }

    // Fetch the FULL profile to check role AND eagerly set into context
    const { data: fullProfileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profileError) {
      await supabase.auth.signOut();
      return { error: profileError };
    }

    if (!fullProfileData) {
      await supabase.auth.signOut();
      return { error: new Error("No account profile found. Please register first.") };
    }

    const actualRole = fullProfileData.role as string;

    // Check if the role matches the expected role for this login page
    if (actualRole !== expectedRole) {
      await supabase.auth.signOut();
      return {
        error: null,
        roleMismatch: true,
        actualRole
      };
    }

    // Role matches — confirm session and eagerly set all context state
    const { data: { session: confirmedSession } } = await supabase.auth.getSession();

    if (confirmedSession) {
      // Mark that we've eagerly set the profile so onAuthStateChange skips its fetch
      eagerProfileSetRef.current = true;
      setSession(confirmedSession);
      setUser(confirmedSession.user);
      setProfile(fullProfileData as Profile);
    }

    return { error: null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    roomNumber?: string,
    hostelName?: string,
    jntuNumber?: string,
    branch?: string,
    year?: string
  ) => {
    const redirectUrl = `${window.location.origin}/`;

    let data, error;
    try {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });
      data = result.data;
      error = result.error;
    } catch (fetchError: any) {
      // Network errors / rate limit errors that throw instead of returning
      return { error: new Error(fetchError?.message || "Network error. Please check your connection and try again.") };
    }

    if (error) return { error };

    // Supabase returns a user with empty identities when email confirmation is
    // enabled and the email is already taken (to avoid leaking user existence).
    // Also catches rate-limited signup where no real user is created.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { error: new Error("This email is already registered or signup is rate-limited. Please try logging in or wait a few minutes.") };
    }

    // Create profile for the new user
    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").insert({
        user_id: data.user.id,
        email,
        full_name: fullName,
        role: role || "student",
        room_number: roomNumber || null,
        hostel_name: hostelName || null,
        jntu_number: jntuNumber || null,
        branch: branch || null,
        year: year || null,
      });

      if (profileError) {
        console.error("Error creating profile:", profileError);
        return { error: profileError as unknown as Error };
      }
    }

    return { error: null };
  };


  const signOut = async () => {
    // 1. Clear all auth state immediately
    setProfile(null);
    setUser(null);
    setSession(null);
    setLoading(false);

    // 2. Destroy the Supabase session
    await supabase.auth.signOut();

    // 3. Explicitly clear sessionStorage to remove any residual tokens
    sessionStorage.clear();

    // 4. Wipe the entire browser history stack and hard-navigate to home.
    //    window.location.replace replaces the CURRENT entry and clears forward history.
    //    Combined with sessionStorage.clear(), any back/forward to a protected route
    //    will be caught by ProtectedRoute's synchronous hasSessionTokens() check.
    window.location.replace("/");
  };

  // isReady = initial boot complete AND no profile fetch in flight
  const isReady = !loading && !profileLoading;

  const value = {
    user,
    session,
    profile,
    loading,
    isReady,
    signIn,
    signInWithRole,
    signUp,
    signOut,
    isAdmin: profile?.role === "admin",
    isStudent: profile?.role === "student",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
