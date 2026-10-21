import { NextRequest, NextResponse } from 'next/server'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { trackPackage, getCarrierById } from '@/lib/carriers'
import type { DeliveryTrackingStatus } from '@/types/database.types'
import type { Json } from '@/types/redesign.types'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createRedesignClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query = supabase
      .from('delivery_trackings')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (status === 'IN_PROGRESS') {
      query = query.eq('status', 'IN_PROGRESS')
    } else if (status === 'DELIVERED') {
      query = query.eq('status', 'DELIVERED')
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ trackings: data })
  } catch (error) {
    console.error('Delivery tracking error:', error)
    return NextResponse.json(
      { error: '배송 조회 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRedesignClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { carrierId, trackingNumber, memo } = body

    if (!carrierId || !trackingNumber) {
      return NextResponse.json(
        { error: 'carrierId and trackingNumber are required' },
        { status: 400 }
      )
    }

    const result = await trackPackage(carrierId, trackingNumber)
    const carrier = getCarrierById(carrierId)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const latestEvent = result.events.length > 0 ? result.events[result.events.length - 1] : null
    const isDelivered = latestEvent?.status.code === 'DELIVERED'
    const status: DeliveryTrackingStatus = isDelivered ? 'DELIVERED' : 'IN_PROGRESS'

    const trackingData = {
      user_id: user.id,
      carrier_id: carrierId as string,
      carrier_name: carrier?.displayName || result.carrier.name,
      tracking_number: trackingNumber as string,
      status,
      latest_event_status: latestEvent?.status.code || null,
      latest_event_time: latestEvent?.time || null,
      latest_event_description: latestEvent?.description || latestEvent?.status.name || null,
      sender_name: result.sender?.name || null,
      sender_address: result.sender?.address || null,
      recipient_name: result.recipient?.name || null,
      recipient_address: result.recipient?.address || null,
      product_name: result.productName || null,
      memo: memo || null,
      events: result.events as unknown as Json,
      completed_at: isDelivered ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('delivery_trackings')
      .upsert(trackingData, {
        onConflict: 'user_id,carrier_id,tracking_number',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ tracking: data, trackInfo: result })
  } catch (error) {
    console.error('Delivery tracking error:', error)
    return NextResponse.json(
      { error: '배송 조회 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createRedesignClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('delivery_trackings')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delivery tracking error:', error)
    return NextResponse.json(
      { error: '배송 조회 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    )
  }
}
