import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Check if any admin user already exists
    const { data: existingAdmins, error: checkError } = await serviceClient
      .from("user_roles")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (checkError) {
      throw new Error(`Failed to check existing admins: ${checkError.message}`);
    }

    if (existingAdmins && existingAdmins.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Admin user already exists. No action taken." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Default admin credentials
    const defaultEmail = "admin@opentape.local";
    const defaultPassword = "admin123!";

    // Create the admin user using Supabase Admin API
    const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({
      email: defaultEmail,
      password: defaultPassword,
      email_confirm: true, // Auto-confirm the email
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

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error provisioning admin:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
