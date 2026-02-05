import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create service client for admin operations
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Check if any admin user already exists FIRST
    const { data: existingAdmins, error: checkError } = await serviceClient
      .from("user_roles")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (checkError) {
      throw new Error(`Failed to check existing admins: ${checkError.message}`);
    }

    // BOOTSTRAP MODE: No admins exist yet - allow unauthenticated access
    if (!existingAdmins || existingAdmins.length === 0) {
      console.log("Bootstrap mode: No admins exist, creating default admin");
      
      // Default admin credentials
      const defaultEmail = "admin@opentape.local";
      const defaultPassword = "admin123!";

      // Create the admin user using Supabase Admin API
      const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({
        email: defaultEmail,
        password: defaultPassword,
        email_confirm: true,
      });

      if (createError) {
        throw new Error(`Failed to create admin user: ${createError.message}`);
      }

      if (!userData.user) {
        throw new Error("User creation returned no user data");
      }

      // Assign admin role
      const { error: roleError } = await serviceClient
        .from("user_roles")
        .insert({ user_id: userData.user.id, role: "admin" });

      if (roleError) {
        throw new Error(`Failed to assign admin role: ${roleError.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Default admin user created successfully",
          credentials: {
            email: defaultEmail,
            password: defaultPassword,
            note: "Please change the password immediately after first login!"
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 201 }
      );
    }

    // NORMAL MODE: Admins exist - require authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Admin user already exists. Authentication required for this endpoint.",
          message: "The system has already been bootstrapped. Log in as an existing admin."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Verify the user's JWT
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);

    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const userId = claims.claims.sub;

    // Check if user has admin role
    const { data: roleData } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ success: false, error: "Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    // Admin exists and caller is authenticated admin
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "Admin user already exists. No action taken." 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error provisioning admin:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
