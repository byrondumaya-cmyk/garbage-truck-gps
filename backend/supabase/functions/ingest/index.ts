import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const deviceIdHeader = req.headers.get('X-Device-ID')
  const apiKeyHeader = req.headers.get('X-API-Key')

  if (!deviceIdHeader || !apiKeyHeader) {
    return new Response(JSON.stringify({ error: 'Missing authentication headers' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Validate device
  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, api_key, is_active')
    .eq('device_id', deviceIdHeader)
    .single()

  if (deviceError || !device || !device.is_active || device.api_key !== apiKeyHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const records = body.records || []

    if (!Array.isArray(records) || records.length === 0) {
      return new Response(JSON.stringify({ error: 'No records provided' }), { status: 400 })
    }

    // Map device_id to the UUID format and prepare PostGIS point
    const formattedRecords = records.map((record: any) => ({
      ...record,
      device_id: device.id,
      location: `SRID=4326;POINT(${record.lon} ${record.lat})`
    }))

    const { error: insertError } = await supabase
      .from('gps_records')
      .insert(formattedRecords)

    if (insertError) {
      console.error('Insert error:', insertError)
      return new Response(JSON.stringify({ error: 'Failed to insert records' }), { status: 500 })
    }

    return new Response(JSON.stringify({ 
      status: 'ok', 
      accepted: formattedRecords.length,
      server_time: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Request parsing error:', error)
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400 })
  }
})
