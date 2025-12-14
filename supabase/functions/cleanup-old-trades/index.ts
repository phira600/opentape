import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    console.log('Starting cleanup of trades older than 30 days...')

    // Call the cleanup function
    const { data, error } = await supabase.rpc('cleanup_old_trades')

    if (error) {
      throw new Error(`Cleanup failed: ${error.message}`)
    }

    console.log(`Cleanup complete. Deleted ${data} trades.`)

    // Refresh the materialized view after cleanup
    await supabase.rpc('refresh_candles')

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Deleted ${data} old trades and refreshed candles view` 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Cleanup error: ${errorMessage}`)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
